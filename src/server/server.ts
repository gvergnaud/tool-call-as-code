import { compile } from "json-schema-to-typescript";
import { findLastIndex, indexBy, capitalize } from "remeda";
import {
  AssistantMessage,
  ClientMessage,
  CodeMessage,
  CodeResultMessage,
  RunTypeScriptToolCall,
  ServerAssistantMessage,
  ServerMessage,
  StandardMessage,
  SystemMessage,
  ToolMessage,
  ToolWithOutput,
} from "../types";
import { PartialEvaluation, runToolCode, ToolState } from "./run-tool-code";
import { match, P } from "ts-pattern";
import { Tool, ToolCall } from "@mistralai/mistralai/models/components";
import { complete } from "./llm";

/**
 * There are two types of message histories:
 *  - the client side history that contains multiple tool calls for back and forths with the model,
 *  - private server side history, that contains a single run_typescript tool and its result.
 *
 * This function takes a client side history.
 */

/**
 * We add a code and a code_result message to the protocol
 * - "code" contains the code to execute and has an id
 * - "code_result" the final result, whether it's a success or not.
 * - all messages in between will be assistant messages with only tool calls,
 *   and tool messages for their results.
 *
 * On the server side, we transform this list into regular messages,
 * where the only tool call available is run_typescript.
 * If there's a CodeMessage without a result, we are in tool call execution mode:
 * - We turn the open code execution messages into an execution context.
 * - We evaluate the code, and if we get new messages, we append them
 * - if we get an output, we make a CodeResult message and and switch to LLM mode
 *
 * Before sending anything to the LLM we:
 * - Turn tools into typescript types
 * - We append a `run_typescript` tool that has a description with these types.
 * - We convert the history into a `run_typescript` history by matching code and
 *   code results and removing anything in between.
 *
 * Before sending the everything back to the user, we reformat the run_typescript
 * history into ClientMessages
 */

export const server = async (
  messages: ClientMessage[],
  tools: ToolWithOutput[]
): Promise<ClientMessage[]> => {
  const parsed = parseClientMessages(messages);

  switch (parsed.mode) {
    case "code": {
      const result = await runToolCode(
        {
          code: parsed.code,
          toolState: parsed.partialEvaluation.toolState,
        },
        tools
      );
      switch (result.type) {
        case "success": {
          const codeResultMessage = {
            role: "code_result" as const,
            id: parsed.id,
            result: {
              status: "success",
              data: result.value,
            },
          } satisfies CodeResultMessage;

          return server([...messages, codeResultMessage], tools);
        }
        case "error": {
          const partialEvaluation = result.error;
          const assistantMessage =
            partialEvaluationToAssistantMessage(partialEvaluation);

          return [...messages, assistantMessage];
        }
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
    case "llm": {
      const assistantMessage = await sendToLLM(parsed.messages, tools);
      if (assistantMessage.toolCalls?.length) {
        return server(
          [
            ...messages,
            ...serverAssistantMessageToClientMessages(assistantMessage),
          ],
          tools
        );
      }

      return [
        ...messages,
        ...serverAssistantMessageToClientMessages(assistantMessage),
      ];
    }
    case "error": {
      throw new Error(`Unexpected error: ${parsed.errorType}`);
    }

    default: {
      const exhaustive: never = parsed;
      return exhaustive;
    }
  }
};

/**
 * Takes a list of client messages and:
 * - if there a CodeMessage without a corresponding CodeResultMessage
 *   at the end of the history, we are in "code" mode. We need to extract
 *   the code block from the last CodeMessage, and compute an partialEvaluation
 *   from the list of messages since the CodeMessage (should only be Assistant and Tool messages).
 * - otherwise we are in "llm" mode. We loop over the list of client messages, and turn
 *   CodeMessage ... CodeResultMessage pairs into a run_typescript tool_call and a tool message with
 *   the result, and send that to the LLM.
 */
function parseClientMessages(messages: ClientMessage[]):
  | {
      mode: "code";
      code: string;
      id: string;
      partialEvaluation: PartialEvaluation;
    }
  | {
      mode: "llm";
      messages: ServerMessage[];
    }
  | {
      mode: "error";
      errorType:
        | "result_with_no_code_block"
        | "code_slice_containing_unexpected_messages";
    } {
  const lastCodeIndex = findLastIndex(messages, (x) => x.role === "code");
  const lastCodeResultIndex = findLastIndex(
    messages,
    (x) => x.role === "code_result"
  );

  if (lastCodeIndex === -1 && lastCodeResultIndex === -1) {
    return {
      mode: "llm",
      messages: clientToServerMessages(messages),
    };
  }

  if (lastCodeIndex === -1)
    return { mode: "error", errorType: "result_with_no_code_block" };

  const isCodeMode = lastCodeIndex > lastCodeResultIndex;

  if (isCodeMode) {
    const codeMessage = messages[lastCodeIndex] as CodeMessage;
    const currentCodeEvaluationSlice = messages.slice(lastCodeIndex + 1);

    if (
      !currentCodeEvaluationSlice.every(
        (x): x is AssistantMessage | ToolMessage =>
          x.role === "assistant" || x.role === "tool"
      )
    ) {
      return {
        mode: "error",
        errorType: "code_slice_containing_unexpected_messages",
      };
    }

    const partialEvaluation: PartialEvaluation = {
      code: codeMessage.code,
      toolState: messagesToToolState(currentCodeEvaluationSlice),
    };
    return {
      mode: "code",
      code: codeMessage.code,
      id: codeMessage.id,
      partialEvaluation,
    };
  }

  return {
    mode: "llm",
    messages: clientToServerMessages(messages),
  };
}

const clientToServerMessages = (messages: ClientMessage[]): ServerMessage[] => {
  type Acc = {
    ctx: { type: "code"; id: string } | { type: "normal" };
    messages: ServerMessage[];
  };
  return messages.reduce<Acc>(
    (acc, message) => {
      return match(acc)
        .returnType<Acc>()
        .with({ ctx: { type: "normal" } }, ({ messages }) => {
          return (
            match(message)
              .returnType<Acc>()
              // transition to code context
              .with({ role: "code" }, (message) => ({
                ctx: { type: "code", id: message.id },
                messages: messages.concat([
                  {
                    role: "assistant",
                    content: "",
                    toolCalls: [
                      {
                        id: message.id,
                        function: {
                          name: "run_typescript",
                          arguments: JSON.stringify({ code: message.code }),
                        },
                      },
                    ],
                  },
                ]),
              }))
              .with({ role: P.union("system", "user") }, (message) => ({
                ctx: { type: "normal" },
                messages: messages.concat([message]),
              }))
              .with(
                {
                  role: "assistant",
                  toolCalls: P.union(
                    P.array(RunTypeScriptToolCall),
                    P.nullish
                  ).optional(),
                },
                (message) => ({
                  ctx: { type: "normal" },
                  messages: messages.concat([message]),
                })
              )
              // error cases: code_result before a code message
              .with({ role: "code_result" }, () => {
                throw new Error(
                  "Unexected code_result message without a code message"
                );
              })
              // error case: a tool result outside of code messages.
              .with({ role: "tool" }, () => {
                throw new Error(
                  "With code mode enabled, tool messages are only expected in between a code and a code_result message"
                );
              })
              // invalid tool call
              .with({ role: "assistant" }, () => {
                throw new Error(
                  "Assistant message containing an non `run_typescript` tool call"
                );
              })
              .exhaustive()
          );
        })
        .with({ ctx: { type: "code" } }, ({ ctx, messages }) => {
          return (
            match(message)
              .returnType<Acc>()
              // Transition back to normal
              .with({ role: "code_result", id: ctx.id }, ({ result }) => {
                return {
                  ctx: { type: "normal" },
                  messages: messages.concat([
                    {
                      role: "tool",
                      toolCallId: ctx.id,
                      content: JSON.stringify(result),
                    },
                  ]),
                };
              })
              .with({ role: "code_result" }, ({ id }) => {
                throw new Error(
                  `Wrong code result id. Expected '${ctx.id}' and received '${id}'.`
                );
              })
              .with({ role: P.union("assistant", "tool") }, () => ({
                ctx,
                messages,
              }))
              .with({ role: "code" }, () => {
                throw new Error(
                  "Unexpected 'code' message following an unclosed 'code' message."
                );
              })
              .with({ role: P.union("system", "user") }, ({ role }) => {
                throw new Error(
                  `Unexpected '${role}' message in a 'code' context.`
                );
              })
              .exhaustive()
          );
        })
        .exhaustive();
    },
    { ctx: { type: "normal" }, messages: [] }
  ).messages;
};

/**
 * - Finds the last assistant message without tool calls in the history
 * - find all assistant messages with tool calls starting after this message
 * - match tool calls with tool message in the history
 * - turn these tool_call / tool message pairs into tool states
 * - return the tool states
 */
const messagesToToolState = (history: StandardMessage[]): ToolState[] => {
  let lastAssistantMessageWithoutToolCallsIndex = findLastIndex(
    history,
    (message) => message.role === "assistant" && !message.toolCalls?.length
  );

  const historySlice =
    lastAssistantMessageWithoutToolCallsIndex === -1
      ? history
      : history.slice(lastAssistantMessageWithoutToolCallsIndex + 1);

  const toolCalls = historySlice.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : []
  );

  const toolMessageById = indexBy(
    historySlice.filter((message) => message.role === "tool"),
    (message) => message.toolCallId!
  );

  const toolStates = toolCalls.map((toolCall): ToolState => {
    const toolMessage = toolMessageById[toolCall.id!];
    if (!toolMessage) {
      return {
        type: "pendingTool",
        id: toolCall.id!,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments as Record<string, unknown>,
        },
      };
    }

    if (typeof toolMessage.content !== "string") {
      throw new Error(
        "Tool message content is not a JSON string: " +
          JSON.stringify(toolMessage.content)
      );
    }

    let result: unknown;
    try {
      result = JSON.parse(toolMessage.content);
    } catch (error) {
      throw new Error(
        "Failed to parse tool message content as JSON: " + toolMessage.content
      );
    }

    return {
      id: toolCall.id!,
      type: "resolvedTool",
      result,
    };
  });

  return toolStates;
};

const serverAssistantMessageToClientMessages = (
  message: ServerAssistantMessage
): ClientMessage[] => {
  const toolCall = message.toolCalls?.[0];
  return toolCall
    ? [
        {
          role: "code",
          code: JSON.parse(toolCall.function.arguments).code,
          id: toolCall.id,
        },
      ]
    : [{ role: "assistant", content: message.content }];
};

/**
 * Before sending anything to the LLM we:
 * - Turn tools into typescript types
 * - We replace tools with a `run_typescript` tool that has a description with these types.
 */
async function sendToLLM(
  messages: ServerMessage[],
  tools: ToolWithOutput[]
): Promise<ServerAssistantMessage> {
  const runTypescriptTool: Tool = {
    type: "function",
    function: {
      name: "run_typescript",
      description:
        "Enables running TypeScript code in a sandbox environment.\n\nAlways define a `main` async function, and don't call it yourself. The sandbox expects this `main` function to be defined and calls it automatically.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
      strict: true,
    },
  };

  const tsDeclarations = await Promise.all(
    tools.map(async (tool) => {
      const argTypeName = `${capitalize(tool.function.name)}Arg`;
      const returnTypeName = `${capitalize(tool.function.name)}Returned`;
      const argsTs = await compile(tool.function.parameters, argTypeName, {
        bannerComment: "",
      });

      const outputTs = tool.function.returnSchema
        ? await compile(tool.function.returnSchema, returnTypeName, {
            bannerComment: "",
          })
        : `type ${returnTypeName} = unknown;`;

      const functionTs = `declare async function ${tool.function.name}(arg: ${argTypeName}): Promise<${returnTypeName}>`;

      return `${argsTs}\n\n${outputTs}\n\n${functionTs}`;
    })
  );

  const toolSystemMessage: SystemMessage = {
    role: "system",
    content: `
## How to use tools

You have access to a single \`run_typescript\` tool that enables you to run
TypeScript code in a sandbox environment. This sandbox has access to ES2015 - ES2022
language features, but doesn't have access to NodeJS or Browser API features.

### The \`main\` function

The sandboxed environment expects a \`main\` async function, and will run this function
automatically. You MUST generate all of your code in this \`async function main()\` block,
otherwise the call will fail. You don't need to call main, as the sandbox will do it for you.

### Available tool functions

In your \`main\` function, you can write arbitrary snippets of TypeScript code, as long as it only uses standard EcmaScript features, or one or several of the available tool functions defined below:

Tool functions:
\`\`\`ts
${tsDeclarations.join("\n\n")}
\`\`\`

Anytime you want to call one of these, you should call the \`run_typescript\` tool and write 
TypeScript code that uses the tool function.

The \`run_typescript\` tool result will be the returned value from your main function.

### Example

1. Assuming you have the following available functions:

\`\`\`ts
type GetArticlesArg = { query: string };

type GetArticlesReturned = { title: string, description: string }[];

declare function getArticles(arg: GetArticlesArg): Promise<GetArticlesReturned>;
\`\`\`

2. And the user query is "find articles about sport news, and only include articles with the word 'basketball' in the title."

3. You should call \`run_typescript\` with the following "code" parameter:

\`\`\`ts
const runTypeScriptArguments = {
  code: \`
  async function main() {
    const results = await getArticles({ query: "sport news" });
    return results.filter((result) => result.title.includes("basketball"));
  }
  \`
}
\`\`\`

Rational: 
- You use the \`getArticles\` function to get relevant articles, and then filter the result as instructed by the user query.
- You don't need to call main because the sandbox does it for you.

`.trim(),
  };

  return (await complete([toolSystemMessage, ...messages], [runTypescriptTool]))
    .message as ServerAssistantMessage;
}

const partialEvaluationToAssistantMessage = (
  partialEvaluation: PartialEvaluation
): AssistantMessage => {
  return {
    role: "assistant",
    content: "",
    toolCalls: partialEvaluation.toolState.flatMap(
      (toolState, index): ToolCall | [] =>
        match(toolState)
          .returnType<ToolCall | []>()
          .with({ type: "pendingTool" }, (toolState) => ({
            type: "function",
            id: toolState.id,
            index,
            function: toolState.function,
          }))
          .with({ type: "resolvedTool" }, (toolState) => [])
          .with({ type: "rejectedTool" }, (toolState) => [])
          .exhaustive()
    ),
  };
};
