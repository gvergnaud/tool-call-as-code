import z from "zod";
import { AssistantMessage, ClientMessage, ToolMessage } from "../types";
import { ToolWithOutput } from "../run-code-server/schema";

export class Agent {
  constructor(
    private systemPrompt: string,
    private tools: Record<
      string,
      {
        description: string;
        parameters: z.ZodType;
        returned: z.ZodType;
        implementation: (input: unknown) => Promise<unknown>;
      }
    >,
    private complete: (
      messages: ClientMessage[],
      tools: ToolWithOutput[]
    ) => Promise<ClientMessage[]>
  ) {}

  getToolDefinitions(): ToolWithOutput[] {
    return Object.entries(this.tools).map(([toolName, tool]) => ({
      type: "function",
      function: {
        name: toolName,
        parameters: z.toJSONSchema(tool.parameters),
        output: z.toJSONSchema(tool.returned),
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

      if (!assistantMessage.toolCalls?.length) {
        return messages;
      }

      const toolCalls = assistantMessage.toolCalls ?? [];

      const toolMessages = await Promise.all(
        toolCalls.map(async (toolCall): Promise<ToolMessage> => {
          const args = parseArguments(toolCall.function.arguments);
          const result =
            await this.tools[toolCall.function.name].implementation(args);
          return {
            role: "tool",
            content: JSON.stringify(result),
            toolCallId: toolCall.id!,
          };
        })
      );

      messages.push(...toolMessages);
    }
  }
}

const parseArguments = (args: string | Record<string, unknown>) => {
  if (typeof args === "string") {
    return JSON.parse(args);
  }
  return args;
};
