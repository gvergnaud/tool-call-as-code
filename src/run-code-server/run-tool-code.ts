import { Tool } from "@mistralai/mistralai/models/components";
import { Isolate } from "isolated-vm";
import { isMatching, match, P } from "ts-pattern";
import { PartialEvaluation, ToolState } from "../types";
import { Result } from "../utils";

type NewToolCallInternal = {
  type: "newToolCall";
  name: string;
  args: Record<string, unknown>;
};
type MismatchedToolCall = {
  type: "mismatchedToolCall";
  expected: string;
  actual: string;
  index: number;
};
type UnexpectedPendingToolInternal = {
  type: "unexpectedPendingTool";
  name: string;
  args: Record<string, unknown>;
};

const NewToolCallPattern = {
  type: "newToolCall",
  name: P.string,
  args: P.record(P.string, P.unknown),
};

const isNewToolCall = isMatching(NewToolCallPattern);

type PromiseInstruction<A, B> =
  | {
      type: "resolve";
      value: A;
    }
  | {
      type: "reject";
      value: B;
    };

const createToolCallImplementation = (
  toolStates: readonly ToolState[],
  mutableToolStatesOutput: ToolState[]
) => {
  let index = 0;

  return (
    toolName: string,
    toolArgs: Record<string, unknown>
  ): PromiseInstruction<
    unknown,
    | NewToolCallInternal
    | MismatchedToolCall
    | UnexpectedPendingToolInternal
    | Error
  > => {
    const currentItem = toolStates.at(index);
    const returned = match(currentItem)
      .returnType<
        PromiseInstruction<
          unknown,
          | NewToolCallInternal
          | MismatchedToolCall
          | UnexpectedPendingToolInternal
          | Error
        >
      >()
      .with({ type: "pendingTool" }, (item) => {
        return {
          type: "reject",
          value: {
            type: "unexpectedPendingTool",
            name: toolName,
            args: toolArgs,
          } satisfies UnexpectedPendingToolInternal,
        };
      })
      .with(undefined, () => {
        mutableToolStatesOutput.push({
          id: crypto.randomUUID(),
          type: "pendingTool",
          function: {
            name: toolName,
            arguments: toolArgs,
          },
        });
        index++;

        return {
          type: "reject",
          value: {
            type: "newToolCall",
            name: toolName,
            args: toolArgs,
          } satisfies NewToolCallInternal,
        };
      })
      .with({ type: "resolvedTool" }, (item) => {
        mutableToolStatesOutput.push({
          id: item.id,
          type: "resolvedTool",
          result: item.result,
        });
        index++;
        return {
          type: "resolve",
          value: item.result,
        };
      })
      .with({ type: "rejectedTool" }, (item) => {
        mutableToolStatesOutput.push({
          id: item.id,
          type: "rejectedTool",
          error: item.error,
        });
        index++;
        return {
          type: "reject",
          value: item.error as Error,
        };
      })
      .exhaustive();
    return returned;
  };
};

export async function runToolCode(
  partialEvaluation: PartialEvaluation,
  tools: readonly Tool[]
): Promise<Result<unknown, PartialEvaluation>> {
  const isolate = new Isolate({ memoryLimit: 8 });

  try {
    const context = await isolate.createContext();

    await context.global.set("global", context.global.derefInto());

    const toolStatesOutput: ToolState[] = [];

    const toolCallImplementations = createToolCallImplementation(
      partialEvaluation.toolState,
      toolStatesOutput
    );

    let collectedOutput: Result<unknown, unknown>[] = [];
    const collectOutput = (output: Result<unknown, unknown>) => {
      collectedOutput.push(output);
    };
    await context.global.set(`$collectOutput`, collectOutput);

    for (const tool of tools) {
      await context.global.set(
        `$_${tool.function.name}`,
        (input: Record<string, unknown>) =>
          toolCallImplementations(tool.function.name, input)
      );
    }

    const addedFunctions = tools
      .map((tool) =>
        `
function ${tool.function.name}(...args) {
  const result = $_${tool.function.name}(...args);
  if (result.type === "resolve") {
    return Promise.resolve(result.value);
  } else if (result.type === "reject") {
    return Promise.reject(result.value);
  }
  throw new Error("Unexpected result type: " + JSON.stringify(result));
}
`.trim()
      )
      .join("\n\n");

    const script = await isolate.compileScript(
      `
${addedFunctions}

${partialEvaluation.code}

main().then(
  (result) => {
    $collectOutput({ type: "success", value: result });
    return null;
  },
  (error) => {
    $collectOutput({ type: "error", error });
    return null;
  }
);

    `.trim()
    );

    await script.run(context);

    const errors = collectedOutput.filter((output) => output.type === "error");
    const success = collectedOutput.filter(
      (output) => output.type === "success"
    );

    if (!errors.length) {
      return Result.success(success[0]?.value ?? null);
    }

    const newToolCalls = errors
      .map((x) => (x as any).error)
      .filter(isNewToolCall);

    if (newToolCalls.length !== errors.length) {
      // If it's not a NewToolCall, it's a real error
      // For serialization purposes we might want to check what it is
    }

    // If we have errors, check if they are just new tool calls
    if (newToolCalls.length === errors.length && newToolCalls.length > 0) {
      return Result.error({
        code: partialEvaluation.code,
        toolState: toolStatesOutput,
      });
    }

    // If there are other errors, or mixed?
    // The original logic:
    /*
    const newToolCalls = errors.map((x) => x.error).filter(isNewToolCall);
    if (newToolCalls.length !== errors.length) {
       throw new Error(...)
    }
    return Result.error({...})
    */

    // The original logic threw an error if there were errors that were NOT new tool calls.
    // But wait, `collectedOutput` contains `Result` objects.
    // If script fails with a random error, it is caught in `.catch` and pushed as `{ type: "error", error }`.

    // If it is not a tool call signal, it is a runtime error in the script.
    // The original code re-throws unexpected errors.

    if (newToolCalls.length !== errors.length) {
      // We found some errors that are NOT new tool calls.
      // We should probably return the error result from the script execution?
      // But runToolCode return signature is Result<unknown, PartialEvaluation>.
      // This implies success is `unknown` (the result), error is `PartialEvaluation` (more steps needed).
      // If the script throws a Runtime Error, that's technically a "Success" in that the evaluation finished (with an error).
      // Or is it?
      // The existing implementation throws if "Unexpected error: some errors are not new tool calls".
      // So it seems runtime errors in the user script are treated as System Errors?
      // Or maybe they should be returned as the result of the execution?

      // Let's look closer at run-tool-code.ts
      /*
             if (newToolCalls.length !== errors.length) {
                throw new Error(
                    "Unexpected error: some errors are not new tool calls:" +
                    JSON.stringify(errors, null, 2)
                );
             }
         */
      // So yes, it throws. I will replicate this behavior.
      throw new Error(
        "Unexpected error: some errors are not new tool calls:" +
          JSON.stringify(errors, null, 2)
      );
    }

    return Result.error({
      code: partialEvaluation.code,
      toolState: toolStatesOutput,
    });
  } catch (error) {
    console.error("Unexpected error", error);
    throw error;
  } finally {
    isolate.dispose();
  }
}
