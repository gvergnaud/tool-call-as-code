import type {
  AssistantMessage as AssistantMessage_,
  SystemMessage as SystemMessage_,
  ToolMessage as ToolMessage_,
  UserMessage as UserMessage_,
  ChatCompletionStreamRequest,
  Tool,
} from "@mistralai/mistralai/models/components";
import { P } from "ts-pattern";

export type StandardMessage =
  | AssistantMessage
  | SystemMessage
  | ToolMessage
  | UserMessage;

export type AssistantMessage = AssistantMessage_ & { role: "assistant" };

export type SystemMessage = SystemMessage_ & { role: "system" };

export type ToolMessage = ToolMessage_ & { role: "tool"; toolCallId: string };

export type UserMessage = UserMessage_ & { role: "user" };

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
  | (UserMessage & { role: "user" })
  | (SystemMessage & { role: "system" })
  | (ToolMessage & { role: "tool" });

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

export type ToolWithOutput = Tool & {
  function: {
    returnSchema?: Record<string, any>;
  };
};
