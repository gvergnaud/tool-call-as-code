import { Tool } from "@mistralai/mistralai/models/components";
import { Isolate } from "isolated-vm";
import { isMatching, match, P } from "ts-pattern";
import { PartialEvaluation, ToolState, RunToolCodeResult } from "../types";
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
): Promise<RunToolCodeResult> {
  const isolate = new Isolate({ memoryLimit: 8 });

  try {
    const context = await isolate.createContext();

    await context.global.set("global", context.global.derefInto());

    const toolStatesOutput: ToolState[] = [];

    const toolCallImplementations = createToolCallImplementation(
      partialEvaluation.toolState,
      toolStatesOutput
    );

    let collectedOutput: Result<unknown, unknown> | undefined;
    const collectOutput = (output: Result<unknown, unknown>) => {
      collectedOutput = output;
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

    try {
      await script.run(context);
    } catch (error) {
      collectedOutput = { type: "error", error: tryJSONStringify(error) };
    }

    return match(collectedOutput)
      .returnType<RunToolCodeResult>()
      .with(undefined, () => {
        return {
          type: "error",
          error: tryJSONStringify(new Error("No output collected")),
        };
      })
      .with({ type: "success" }, (result) => {
        return { type: "code_result", result };
      })
      .with({ type: "error", error: P.when(isNewToolCall) }, (result) => {
        return {
          type: "partial_evaluation",
          partialEvaluation: {
            code: partialEvaluation.code,
            toolState: toolStatesOutput,
          },
        };
      })
      .with({ type: "error" }, (result) => {
        return { type: "code_result", result: Result.error(result.error) };
      })
      .exhaustive();
  } catch (error) {
    console.error("Unexpected error", error);
    return { type: "error", error: tryJSONStringify(error) };
  } finally {
    isolate.dispose();
  }
}

const tryJSONStringify = (value: unknown) => {
  if (value instanceof Error) {
    return JSON.stringify({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};
