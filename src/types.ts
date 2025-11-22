import type {
  AssistantMessage as AssistantMessage_,
  SystemMessage as SystemMessage_,
  ToolMessage as ToolMessage_,
  UserMessage as UserMessage_,
  ChatCompletionStreamRequest,
} from "@mistralai/mistralai/models/components";

export type Message = ChatCompletionStreamRequest["messages"][number];

export type AssistantMessage = AssistantMessage_ & { role: "assistant" };

export type SystemMessage = SystemMessage_ & { role: "system" };

export type ToolMessage = ToolMessage_ & { role: "tool" };

export type UserMessage = UserMessage_ & { role: "user" };

export type RunTypeScriptToolCall = {
  id: string;
  function: {
    name: "run_typescript";
    code: string;
  };
};

export type ServerAssistantMessage = AssistantMessage & {
  role: "assistant";
  toolCalls: RunTypeScriptToolCall[];
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

export type ClientMessage = Message | CodeMessage | CodeResultMessage;
