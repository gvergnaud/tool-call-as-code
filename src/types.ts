import type {
  AssistantMessage as AssistantMessage_,
  SystemMessage as SystemMessage_,
  ToolMessage as ToolMessage_,
  UserMessage as UserMessage_,
  ChatCompletionStreamRequest,
  Tool,
} from "@mistralai/mistralai/models/components";
import { P } from "ts-pattern";
import { Result } from "./utils";

/**
 * Standard messages, compliant to the tool calling protocol.
 */

export type StandardMessage =
  | AssistantMessage
  | SystemMessage
  | ToolMessage
  | UserMessage;

export type AssistantMessage = AssistantMessage_ & { role: "assistant" };

export type SystemMessage = SystemMessage_ & { role: "system" };

export type ToolMessage = ToolMessage_ & { role: "tool"; toolCallId: string };

export type UserMessage = UserMessage_ & { role: "user" };

/**
 * Server messages are regular messages, but the only allowed
 * tool call is `run_typescript`.
 */

export const RunTypeScriptToolCall = {
  id: P.string,
  function: {
    name: "run_typescript",
    arguments: P.string, // { code: P.string },
  },
} as const satisfies P.Pattern;

export type RunTypeScriptToolCall = P.infer<typeof RunTypeScriptToolCall>;

export type ServerAssistantMessage = AssistantMessage & {
  role: "assistant";
  toolCalls?: RunTypeScriptToolCall[] | null;
};
export type ServerMessage =
  | ServerAssistantMessage
  | UserMessage
  | SystemMessage
  | ToolMessage;

/**
 * Client messages have CodeMessage and CodeResultMessage
 * in addition to standard messages.
 */

export type CodeMessage = {
  role: "code";
  id: string;
  code: string;
};

export type CodeResultMessage = {
  role: "code_result";
  id: string;
  result:
    | { status: "success"; data: unknown }
    | { status: "error"; error: unknown };
};

export type ClientMessage = StandardMessage | CodeMessage | CodeResultMessage;

/**
 * ToolWithOutput is a tool definition with a returned schema,
 * used to generate the TypeScript type declarations for the system message.
 */
export type ToolWithOutput = Tool & {
  function: {
    returnSchema?: Record<string, any>;
  };
};

/**
 * PartialEvaluation represents the state of a code execution
 * with intercepted tool calls.
 */
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

export type RunToolCodeResult =
  | {
      type: "code_result";
      result: Result<unknown, unknown>;
    }
  | {
      type: "partial_evaluation";
      partialEvaluation: PartialEvaluation;
    }
  | {
      type: "error";
      error: unknown;
    };
