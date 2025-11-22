import z from "zod";
import { server } from "./server/server";
import { AssistantMessage, ClientMessage, ToolMessage } from "./types";
import { Tool } from "@mistralai/mistralai/models/components";

export async function client() {
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
        toolCalls.map(async (toolCall): Promise<ToolMessage> => {
          const args = parseArguments(toolCall.function.arguments);
          const result =
            await this.tools[toolCall.function.name].implementation(args);
          return {
            role: "tool",
            content: JSON.stringify(result),
            toolCallId: toolCall.id,
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
