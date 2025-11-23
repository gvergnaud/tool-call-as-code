import { Tool } from "@mistralai/mistralai/models/components";
import { Isolate } from "isolated-vm";
import { Result } from "../utils";
import { isMatching, match, P } from "ts-pattern";

const NewToolCall = {
  type: "newToolCall",
  name: P.string,
  args: P.record(P.string, P.unknown),
};

const MismatchedToolCall = {
  type: "mismatchedToolCall",
  expected: P.string,
  actual: P.string,
  index: P.number,
};

const UnexpectedPendingTool = {
  type: "unexpectedPendingTool",
  name: P.string,
  args: P.record(P.string, P.unknown),
};

type NewToolCall = P.infer<typeof NewToolCall>;
type MismatchedToolCall = P.infer<typeof MismatchedToolCall>;
type UnexpectedPendingTool = P.infer<typeof UnexpectedPendingTool>;

const isNewToolCall = isMatching(NewToolCall);
const isMismatchedToolCall = isMatching(MismatchedToolCall);
const isUnexpectedPendingTool = isMatching(UnexpectedPendingTool);

type PromiseInstruction<A, B> =
  | {
      type: "resolve";
      value: A;
    }
  | {
      type: "reject";
      value: B;
    };

/**
 * - tools are implemented as a promise that either rejects a:
 *   - newToolCall message, containing name and args
 *   - A mismatched tool call message (when the toolcall executed doesn’t match the current stack)
 * - Or returns the value from the stack
 *
 * If a tool call isn't present on the stack, we mutate the second parameter
 * and append a pending tool call to the list.
 */
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
    NewToolCall | MismatchedToolCall | UnexpectedPendingTool | Error
  > => {
    const currentItem = toolStates.at(index);
    const returned = match(currentItem)
      .returnType<
        PromiseInstruction<
          unknown,
          NewToolCall | MismatchedToolCall | UnexpectedPendingTool | Error
        >
      >()
      // should never happen. It should be
      // either undefined, resolved, or rejected.
      // We return an error just in case the
      // implementation is not correct.
      .with({ type: "pendingTool" }, (item) => {
        return {
          type: "reject",
          value: {
            type: "unexpectedPendingTool",
            name: toolName,
            args: toolArgs,
          } satisfies NewToolCall,
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

        return {
          type: "reject",
          value: {
            type: "newToolCall",
            name: toolName,
            args: toolArgs,
          } satisfies NewToolCall,
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
          value: item.error,
        };
      })
      .exhaustive();
    return returned;
  };
};

export type PartialEvaluation = {
  code: string;
  toolState: ToolState[];
};

export type ToolState = PendingTool | ResolvedTool | RejectedTool;

export type PendingTool = {
  type: "pendingTool";
  id: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type ResolvedTool = {
  type: "resolvedTool";
  id: string;
  result: unknown;
};

export type RejectedTool = {
  type: "rejectedTool";
  id: string;
  error: Error;
};

// - The run_code function can either return
//   - a PartialEvaluation object with { code: string, toolState: (PendingTool | ResolvedTool | RejectedTool)[] }
//   - A result object, contain the final result of run_typescript
export async function runToolCode(
  partialEvaluation: PartialEvaluation,
  tools: readonly Tool[]
): Promise<Result<unknown, PartialEvaluation>> {
  const isolate = new Isolate({ memoryLimit: 8 });

  try {
    const context = await isolate.createContext();

    await context.global.set("global", context.global.derefInto());

    // Mutable reference, used to collect tool calls
    // the code needs to execute.
    const toolStatesOutput: ToolState[] = [];

    const toolCallImplementations = createToolCallImplementation(
      partialEvaluation.toolState,
      toolStatesOutput
    );

    // We collect the return value or error from the
    // main function here.
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

    // tools are added in scope here.
    // There are some bindings to turn
    // `PromiseInstruction` object into
    // actual promises, because we can
    // only pass serializable values to the isolate.
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
      return Result.success(success[0]?.value) ?? null;
    }

    const newToolCalls = errors.map((x) => x.error).filter(isNewToolCall);

    if (newToolCalls.length !== errors.length) {
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
