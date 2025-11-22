import { Mistral } from "@mistralai/mistralai";
import {
  ChatCompletionChoice,
  Tool,
  ToolMessage,
} from "@mistralai/mistralai/models/components";
import z from "zod";
import { Message } from "../types";

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
