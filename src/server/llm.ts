import { Mistral } from "@mistralai/mistralai";
import {
  ChatCompletionChoice,
  Tool,
  ToolMessage,
} from "@mistralai/mistralai/models/components";
import z from "zod";
import { StandardMessage } from "../types";

// Initialize the Mistral client
const mistral = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY,
});

export async function complete(
  messages: StandardMessage[],
  tools: Tool[]
): Promise<ChatCompletionChoice> {
  console.log("Sent To LLM", JSON.stringify({ messages, tools }, null, 2));

  const result = await mistral.chat.complete({
    model: "mistral-medium-latest",
    messages: messages,
    tools,
  });

  console.log("RESULT", JSON.stringify(result, null, 2));

  return result.choices[0];
}
