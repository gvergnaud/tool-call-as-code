import type {
  AssistantMessage as AssistantMessage_,
  SystemMessage as SystemMessage_,
  ToolMessage as ToolMessage_,
  UserMessage as UserMessage_,
} from "@mistralai/mistralai/models/components";
import { P } from "ts-pattern";

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

type ToolExecution = {
  id: string;
  name: string; // module name / var name
  code: string;
};

type CodeResult = {
  id: string;
  result:
    | { status: "success"; data: unknown }
    | { status: "error"; error: unknown };
};

export type ClientAssistantMessage = AssistantMessage & {
  role: "assistant";
  code_executions?: ToolExecution[];
  code_results?: CodeResult[];
};

export type ClientMessage = StandardMessage | CodeMessage | CodeResultMessage;
