import { describe, it, expect } from "vitest";
import { PartialEvaluation, runToolCode } from "./run-tool-code";
import { Tool } from "@mistralai/mistralai/models/components";
import { Result } from "../utils";

const firstID = crypto.randomUUID();

const CODE = `
const results = await webSearch({ query: "news today" });
return results.filter((result) => result.title.includes("news"));
`;

const webSearchTool = {
  type: "function",
  function: {
    name: "webSearch",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
        },
      },
      required: ["query"],
    },
  },
} satisfies Tool;

describe("runToolCode", () => {
  it("should return tool calls when some tools are pending", async () => {
    const result = await runToolCode(
      {
        code: CODE,
        toolState: [],
      },
      [webSearchTool]
    );

    expect(result).toEqual({
      type: "error",
      error: {
        code: CODE,
        toolState: [
          {
            type: "pendingTool",
            id: expect.any(String),
            function: { name: "webSearch", arguments: { query: "news today" } },
          },
        ],
      },
    } satisfies Result<unknown, PartialEvaluation>);
  });

  it("should return a result when all tools are resolved", async () => {
    const result = await runToolCode(
      {
        code: CODE,
        toolState: [
          {
            type: "resolvedTool",
            id: firstID,
            result: [
              { title: "news today", url: "https://www.google.com" },
              { title: "news this week", url: "https://www.google.com" },
              { title: "not relevant", url: "https://www.google.com" },
            ],
          },
        ],
      },
      [webSearchTool]
    );

    expect(result).toEqual({
      type: "success",
      value: [
        { title: "news today", url: "https://www.google.com" },
        { title: "news this week", url: "https://www.google.com" },
      ],
    } satisfies Result<unknown, PartialEvaluation>);
  });
});
