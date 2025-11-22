import { Mistral } from "@mistralai/mistralai";
import {
  ChatCompletionChoice,
  Tool,
  ToolMessage,
} from "@mistralai/mistralai/models/components";
import z from "zod";
import {
  AssistantMessage,
  ClientMessage,
  CodeMessage,
  CodeResultMessage,
  Message,
} from "./types";

// Initialize the Mistral client
const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

export async function complete(
  messages: Message[],
  tools: Tool[]
): Promise<ChatCompletionChoice> {
  const result = await mistral.chat.complete({
    model: "mistral-medium-latest",
    messages: messages,
    tools,
  });

  return result.choices[0];
}

const parseArguments = (args: string | Record<string, unknown>) => {
  if (typeof args === "string") {
    return JSON.parse(args);
  }
  return args;
};

export class CodeModeAgent {
  constructor(
    private systemPrompt: string,
    private tools: Record<
      string,
      {
        description: string;
        parameters: z.ZodType;
        implementation: (input: unknown) => Promise<unknown>;
      }
    >,
    private complete: (
      messages: ClientMessage[],
      tools: Tool[]
    ) => Promise<ClientMessage[]>
  ) {}

  getToolDefinitions(): Tool[] {
    return Object.entries(this.tools).map(([toolName, tool]) => ({
      type: "function",
      function: {
        name: toolName,
        parameters: z.toJSONSchema(tool.parameters),
        description: tool.description,
        strict: true,
      },
    }));
  }

  async run(messagesProp: ClientMessage[]): Promise<ClientMessage[]> {
    const messages: ClientMessage[] = messagesProp;

    const toolDefinitions = this.getToolDefinitions();

    while (true) {
      const newMessages = await this.complete(
        [
          { role: "system", content: this.systemPrompt },
          ...messages,
        ] satisfies ClientMessage[],
        toolDefinitions
      );

      messages.push(...newMessages);

      const assistantMessage = newMessages.at(-1)! as AssistantMessage;

      if (!assistantMessage.toolCalls) {
        return messages;
      }

      const toolCalls = assistantMessage.toolCalls ?? [];

      const toolMessages = await Promise.all(
        toolCalls.map(
          async (toolCall): Promise<ToolMessage & { role: "tool" }> => {
            const args = parseArguments(toolCall.function.arguments);
            const result =
              await this.tools[toolCall.function.name].implementation(args);
            return {
              role: "tool",
              content: JSON.stringify(result),
              toolCallId: toolCall.id,
            };
          }
        )
      );

      messages.push(...toolMessages);
    }
  }
}
