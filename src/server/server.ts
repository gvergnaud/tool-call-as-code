import {
  ClientMessage,
  CodeResultMessage,
  ServerAssistantMessage,
  ServerMessage,
  ToolWithOutput,
} from "../types";
import { runToolCode } from "./run-tool-code";
import { complete } from "./llm";
import {
  parseClientMessages,
  partialEvaluationToAssistantMessage,
  serverAssistantMessageToClientMessages,
} from "./type-conversion-helpers";
import { getRunTypescriptToolAndSystemMessage } from "./run-typescript-tool";

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
  inputMessages: readonly ClientMessage[],
  tools: readonly ToolWithOutput[],
  outputMessages: readonly ClientMessage[] = []
): Promise<ClientMessage[]> => {
  const parsed = parseClientMessages([...inputMessages, ...outputMessages]);

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

          // in case of success, recurse
          // so the we switch back to LLM mode
          // and the LLM get's called to
          // generate an assistant message.
          return server(inputMessages, tools, [
            ...outputMessages,
            codeResultMessage,
          ]);
        }
        case "error": {
          const partialEvaluation = result.error;
          const assistantMessage =
            partialEvaluationToAssistantMessage(partialEvaluation);

          return [...outputMessages, assistantMessage];
        }
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
    case "llm": {
      const assistantMessage = await sendToLLM(parsed.messages, tools);

      // recurse if there's a tool call,
      // so the run_typescript tool call
      // get executed and turned into
      // client messages.
      if (assistantMessage.toolCalls?.length) {
        const newClientMessages =
          serverAssistantMessageToClientMessages(assistantMessage);

        return server(inputMessages, tools, [
          ...outputMessages,
          ...newClientMessages,
        ]);
      }

      // otherwise return output messages with the assistant message.
      return [
        ...outputMessages,
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
 * Before sending anything to the LLM we:
 * - Turn tools into typescript types
 * - We replace tools with a `run_typescript` tool that has a description with these types.
 */
async function sendToLLM(
  messages: readonly ServerMessage[],
  tools: readonly ToolWithOutput[]
): Promise<ServerAssistantMessage> {
  const { runTypescriptTool, systemMessage } =
    await getRunTypescriptToolAndSystemMessage(tools);

  return (await complete([systemMessage, ...messages], [runTypescriptTool]))
    .message as ServerAssistantMessage;
}
