import { findLastIndex, indexBy } from "remeda";
import {
  ClientMessage,
  CodeResultMessage,
  Message,
  ServerAssistantMessage,
  ServerMessage,
} from "./types";
import { PartialEvaluation, runToolCode, ToolState } from "./run-tool-code";
import { match } from "ts-pattern";
import { Tool } from "@mistralai/mistralai/models/components";
import { CodeModeAgent } from "./llm";
import z from "zod";

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

const TODO = new Error("TODO");

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
      messages: ClientMessage[];
    } {
  throw TODO;
}

/**
 * - Finds the last assistant message without tool calls in the history
 * - find all assistant messages with tool calls starting after this message
 * - match tool calls with tool message in the history
 * - turn these tool_call / tool message pairs into tool states
 * - return the tool states
 */
const messagesToToolState = (history: Message[]): ToolState[] => {
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
 * Before sending anything to the LLM we:
 * - Turn tools into typescript types
 * - We replace tools with a `run_typescript` tool that has a description with these types.
 */
function sendToLLM(
  messages: ServerMessage[],
  tools: Tool[]
): Promise<ServerAssistantMessage> {
  const toolDefinitions = tools.map((tool) => ({
    type: "function",
    function: tool,
  }));

  const runTypescriptTool = {
    type: "function",
    function: {
      name: "run_typescript",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
    },
  };

  throw TODO;
}

const clientMessagesToServerMessages = (
  messages: ClientMessage[]
): ServerMessage[] => {
  const runTypescriptHistory = messages.reduce<ServerMessage[]>(
    (acc, message) => {
      // TODO
      return acc;
    },
    []
  );
  throw TODO;
};

const server = async (
  messages: ClientMessage[],
  tools: Tool[]
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
          return [
            ...messages,
            ...partialEvaluationToMessages(partialEvaluation),
          ];
        }
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
    case "llm": {
      const assistantMessage = await sendToLLM(
        clientMessagesToServerMessages(parsed.messages),
        tools
      );

      return server([...messages, assistantMessage], tools);
    }
    default: {
      const exhaustive: never = parsed;
      return exhaustive;
    }
  }
};

const partialEvaluationToMessages = (
  partialEvaluation: PartialEvaluation
): Message[] => {
  return partialEvaluation.toolState.map(
    (toolState): Message =>
      match(toolState)
        .returnType<Message>()
        .with({ type: "pendingTool" }, (toolState) => ({
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: toolState.id,
              function: toolState.function,
            },
          ],
        }))
        .with({ type: "resolvedTool" }, (toolState) => ({
          role: "tool",
          content:
            typeof toolState.result === "string"
              ? toolState.result
              : JSON.stringify(toolState.result),
        }))
        .with({ type: "rejectedTool" }, (toolState) => ({
          role: "tool",
          content: toolState.error.message,
        }))
        .exhaustive()
  );
};

async function client() {
  const agent = new CodeModeAgent(
    "You are a helpful assistant that can search the web.",
    {
      webSearch: {
        description: "Search the web for information",
        parameters: z.object({ query: z.string() }),
        implementation: async () => {
          return [
            { title: "news today", url: "https://www.google.com" },
            { title: "news this week", url: "https://www.google.com" },
            { title: "not relevant", url: "https://www.google.com" },
          ];
        },
      },
    },
    (messages, tools) => {
      return server(messages, tools);
    }
  );
  const result = await agent.run([
    { role: "user", content: "What is the news today?" },
  ]);

  console.log(result);
}

client().catch(console.error);
