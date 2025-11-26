import { findLastIndex, indexBy } from "remeda";
import {
  AssistantMessage,
  ClientAssistantMessage,
  ClientMessage,
  RunTypeScriptToolCall,
  ServerAssistantMessage,
  ServerMessage,
  StandardMessage,
  ToolCallCode,
  ToolMessage,
} from "../types";
import { match, P } from "ts-pattern";
import { ToolCall } from "@mistralai/mistralai/models/components";
import { PartialEvaluation, ToolState } from "../run-code-server/schema";

export type ParseClientMessagesResult =
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
export function parseClientMessages(
  messages: ClientMessage[]
): ParseClientMessagesResult {
  const lastCodeIndex = findLastIndex(
    messages,
    (x) =>
      x.role === "assistant" &&
      (x.toolCalls ?? [])?.some((toolCall) => toolCall.type === "code")
  );
  const lastToolCallCode =
    lastCodeIndex !== -1
      ? (
          messages[lastCodeIndex] as ClientAssistantMessage
        )?.toolCalls?.findLast(
          (toolCall): toolCall is ToolCallCode => toolCall.type === "code"
        )
      : undefined;

  const lastCodeResultIndex = lastToolCallCode
    ? findLastIndex(
        messages,
        (x) => x.role === "tool" && x.toolCallId === lastToolCallCode?.id
      )
    : -1;

  if (
    (lastCodeIndex === -1 && lastCodeResultIndex === -1) ||
    !lastToolCallCode
  ) {
    return {
      mode: "llm",
      messages: clientToServerMessages(messages),
    };
  }

  if (lastCodeIndex === -1)
    return { mode: "error", errorType: "result_with_no_code_block" };

  const isCodeMode = lastCodeIndex > lastCodeResultIndex;

  if (isCodeMode) {
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
      code: lastToolCallCode.code,
      toolState: messagesToToolState(currentCodeEvaluationSlice),
    };
    return {
      mode: "code",
      code: lastToolCallCode.code,
      id: lastToolCallCode.id,
      partialEvaluation,
    };
  }

  return {
    mode: "llm",
    messages: clientToServerMessages(messages),
  };
}

/**
 * Folds code execution history slices into `run_typescript` tool calls and tool messages.
 */
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
              .with(
                {
                  role: "assistant",
                  toolCalls: P.when(
                    (toolCalls): toolCalls is NonNullable<typeof toolCalls> =>
                      !!toolCalls?.some(
                        (toolCall): toolCall is ToolCallCode =>
                          toolCall.type === "code"
                      )
                  ),
                },
                (message) => {
                  const toolCallCode = message.toolCalls.findLast(
                    (toolCall): toolCall is ToolCallCode =>
                      toolCall.type === "code"
                  )!;
                  return {
                    ctx: { type: "code", id: toolCallCode.id },
                    messages: messages.concat([
                      {
                        role: "assistant",
                        content: "",
                        toolCalls: [
                          {
                            id: toolCallCode.id,
                            function: {
                              name: "run_typescript",
                              arguments: JSON.stringify({
                                code: toolCallCode.code,
                              }),
                            },
                          },
                        ],
                      },
                    ]),
                  };
                }
              )
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
              .with({ role: "tool", toolCallId: ctx.id }, ({ content }) => {
                return {
                  ctx: { type: "normal" },
                  messages: messages.concat([
                    {
                      role: "tool",
                      toolCallId: ctx.id,
                      content,
                    },
                  ]),
                };
              })
              .with({ role: P.union("assistant", "tool") }, () => ({
                ctx,
                messages,
              }))
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
 * Turns a code execution slice of history into a list of tool states,
 * to later compute a partial evaluation object.
 *
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

/**
 * If the assistant message contains a run_typescript tool call,
 * turn it into a code message.
 */
export const serverAssistantMessageToClientMessages = (
  message: ServerAssistantMessage
): ClientMessage[] => {
  const toolCall = message.toolCalls?.[0];
  return toolCall
    ? [
        {
          role: "assistant",
          toolCalls: [
            {
              type: "code",
              id: toolCall.id,
              code: JSON.parse(toolCall.function.arguments).code,
            },
          ],
        },
      ]
    : [{ role: "assistant", content: message.content, toolCalls: [] }];
};

/**
 * create an assistant message with tool calls from pending
 * tool states.
 */
export const toolStatesToAssistantMessage = (
  toolStates: ToolState[]
): ClientAssistantMessage => {
  return {
    role: "assistant",
    content: "",
    toolCalls: toolStates.flatMap((toolState, index): ToolCall | [] =>
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
