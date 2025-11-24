import { describe, it, expect } from "vitest";
import { runToolCode } from "./run-tool-code";
import { PartialEvaluation, RunToolCodeResult } from "../types";
import { Tool } from "@mistralai/mistralai/models/components";
import { Result } from "../utils";

const firstID = crypto.randomUUID();

const SIMPLE_WEB_SEARCH = `
async function main() {
  const results = await webSearch({ query: "news today" });
  return results.filter((result) => result.title.includes("news"));
}
`;

const DOUBLE_WEB_SEARCH = `
async function main() {
  const [sportNews, internationalAffairesNews] = await Promise.all([
      webSearch({ query: "sport news" }),
      webSearch({ query: "international affaires news" }),
  ]);

  return {
      sportNews,
      internationalAffairesNews,
  };
}
`;

const SEQUENTIAL_WEB_SEARCH = `
async function main() {
  const sportNews = await webSearch({ query: "sport news" });
  const internationalAffairesNews = await webSearch({ query: "international affaires news" });
  return {
    sportNews,
    internationalAffairesNews,
  };
}
`;

const LOOP_SEQUENTIAL = `
async function main() {
  const cities = ["Paris", "London", "New York"];
  const weatherReports = [];
  for (const city of cities) {
    const report = await getWeather({ location: city });
    weatherReports.push(report);
  }
  return weatherReports;
}
`;

const CHAINED_CALLS = `
async function main() {
  const searchResults = await webSearch({ query: "quantum computing breakthrough" });
  const summary = await summarize({ text: searchResults[0].content });
  const translation = await translate({ text: summary, targetLanguage: "French" });
  return translation;
}
`;

const MIXED_PARALLEL_SEQUENTIAL = `
async function main() {
  const [techNews, financeNews] = await Promise.all([
    webSearch({ query: "latest tech news" }),
    webSearch({ query: "latest finance news" })
  ]);
  
  const techSummary = await summarize({ text: techNews[0].content });
  const financeSummary = await summarize({ text: financeNews[0].content });
  
  return { techSummary, financeSummary };
}
`;

const POST_PROCESSING = `
async function main() {
  const searchResults = await webSearch({ query: "healthy recipes" });
  const vegetarianRecipes = searchResults.filter(r => r.tags.includes("vegetarian"));
  const summaries = await Promise.all(
    vegetarianRecipes.map(r => summarize({ text: r.content }))
  );
  return summaries;
}
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

const summarizeTool = {
  type: "function",
  function: {
    name: "summarize",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
      },
      required: ["text"],
    },
  },
} satisfies Tool;

const translateTool = {
  type: "function",
  function: {
    name: "translate",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        targetLanguage: { type: "string" },
      },
      required: ["text", "targetLanguage"],
    },
  },
} satisfies Tool;

const getWeatherTool = {
  type: "function",
  function: {
    name: "getWeather",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string" },
      },
      required: ["location"],
    },
  },
} satisfies Tool;

describe("runToolCode", () => {
  it("should return tool calls when some tools are pending", async () => {
    const result = await runToolCode(
      {
        code: SIMPLE_WEB_SEARCH,
        toolState: [],
      },
      [webSearchTool]
    );

    expect(result).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: SIMPLE_WEB_SEARCH,
        toolState: [
          {
            type: "pendingTool",
            id: expect.any(String),
            function: { name: "webSearch", arguments: { query: "news today" } },
          },
        ],
      },
    } satisfies RunToolCodeResult);
  });

  it("should return a result when all tools are resolved", async () => {
    const result = await runToolCode(
      {
        code: SIMPLE_WEB_SEARCH,
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
      type: "code_result",
      result: {
        type: "success",
        value: [
          { title: "news today", url: "https://www.google.com" },
          { title: "news this week", url: "https://www.google.com" },
        ],
      },
    } satisfies RunToolCodeResult);
  });

  it("If the code contains multiple parallel tool calls, it should return all of them", async () => {
    const result = await runToolCode(
      {
        code: DOUBLE_WEB_SEARCH,
        toolState: [],
      },
      [webSearchTool]
    );

    expect(result).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: DOUBLE_WEB_SEARCH,
        toolState: [
          {
            type: "pendingTool",
            id: expect.any(String),
            function: { name: "webSearch", arguments: { query: "sport news" } },
          },
          {
            type: "pendingTool",
            id: expect.any(String),
            function: {
              name: "webSearch",
              arguments: { query: "international affaires news" },
            },
          },
        ],
      },
    } satisfies RunToolCodeResult);
  });

  it("should support sequential tool calls", async () => {
    const result = await runToolCode(
      {
        code: SEQUENTIAL_WEB_SEARCH,
        toolState: [],
      },
      [webSearchTool]
    );

    expect(result).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: SEQUENTIAL_WEB_SEARCH,
        toolState: [
          {
            type: "pendingTool",
            id: expect.any(String),
            function: { name: "webSearch", arguments: { query: "sport news" } },
          },
        ],
      },
    } satisfies RunToolCodeResult);

    const result2 = await runToolCode(
      {
        code: SEQUENTIAL_WEB_SEARCH,
        toolState: [
          {
            type: "resolvedTool",
            id: (
              result as Extract<typeof result, { type: "partial_evaluation" }>
            ).partialEvaluation.toolState[0].id,
            result: [{ title: "sport news", url: "https://www.google.com" }],
          },
        ],
      },
      [webSearchTool]
    );

    const firstId = (
      result as Extract<typeof result, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[0].id;

    expect(result2).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: SEQUENTIAL_WEB_SEARCH,
        toolState: [
          {
            type: "resolvedTool",
            id: firstId,
            result: [{ title: "sport news", url: "https://www.google.com" }],
          },
          {
            type: "pendingTool",
            id: expect.any(String),
            function: {
              name: "webSearch",
              arguments: { query: "international affaires news" },
            },
          },
        ],
      },
    } satisfies RunToolCodeResult);

    const secondId = (
      result2 as Extract<typeof result2, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[1].id;

    const result3 = await runToolCode(
      {
        code: SEQUENTIAL_WEB_SEARCH,
        toolState: [
          {
            type: "resolvedTool",
            id: firstID,
            result: [{ title: "sport news", url: "https://www.google.com" }],
          },
          {
            type: "resolvedTool",
            id: secondId,
            result: [
              {
                title: "international affaires news",
                url: "https://www.google.com",
              },
            ],
          },
        ],
      },
      [webSearchTool]
    );

    expect(result3).toEqual({
      type: "code_result",
      result: {
        type: "success",
        value: {
          sportNews: [{ title: "sport news", url: "https://www.google.com" }],
          internationalAffairesNews: [
            {
              title: "international affaires news",
              url: "https://www.google.com",
            },
          ],
        },
      },
    } satisfies RunToolCodeResult);
  });

  it("should handle sequential loop tool calls", async () => {
    // Step 1: First call for Paris
    const result1 = await runToolCode(
      { code: LOOP_SEQUENTIAL, toolState: [] },
      [getWeatherTool]
    );

    expect(result1).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: LOOP_SEQUENTIAL,
        toolState: [
          {
            type: "pendingTool",
            id: expect.any(String),
            function: { name: "getWeather", arguments: { location: "Paris" } },
          },
        ],
      },
    } satisfies RunToolCodeResult);

    const id1 = (
      result1 as Extract<typeof result1, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[0].id;

    // Step 2: Resolve Paris, expect London
    const result2 = await runToolCode(
      {
        code: LOOP_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: "Sunny in Paris" },
        ],
      },
      [getWeatherTool]
    );

    expect(result2).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: LOOP_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: "Sunny in Paris" },
          {
            type: "pendingTool",
            id: expect.any(String),
            function: { name: "getWeather", arguments: { location: "London" } },
          },
        ],
      },
    } satisfies RunToolCodeResult);

    const id2 = (
      result2 as Extract<typeof result2, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[1].id;

    // Step 3: Resolve London, expect New York
    const result3 = await runToolCode(
      {
        code: LOOP_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: "Sunny in Paris" },
          { type: "resolvedTool", id: id2, result: "Rainy in London" },
        ],
      },
      [getWeatherTool]
    );

    expect(result3).toEqual({
      type: "partial_evaluation",
      partialEvaluation: {
        code: LOOP_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: "Sunny in Paris" },
          { type: "resolvedTool", id: id2, result: "Rainy in London" },
          {
            type: "pendingTool",
            id: expect.any(String),
            function: {
              name: "getWeather",
              arguments: { location: "New York" },
            },
          },
        ],
      },
    } satisfies RunToolCodeResult);

    const id3 = (
      result3 as Extract<typeof result3, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[2].id;

    // Step 4: Resolve New York, expect success
    const result4 = await runToolCode(
      {
        code: LOOP_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: "Sunny in Paris" },
          { type: "resolvedTool", id: id2, result: "Rainy in London" },
          { type: "resolvedTool", id: id3, result: "Cloudy in NY" },
        ],
      },
      [getWeatherTool]
    );

    expect(result4).toEqual({
      type: "code_result",
      result: {
        type: "success",
        value: ["Sunny in Paris", "Rainy in London", "Cloudy in NY"],
      },
    } satisfies RunToolCodeResult);
  });

  it("should handle chained tool calls where output passes to next input", async () => {
    // Step 1: webSearch
    const result1 = await runToolCode({ code: CHAINED_CALLS, toolState: [] }, [
      webSearchTool,
      summarizeTool,
      translateTool,
    ]);

    expect(result1).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          {
            type: "pendingTool",
            function: {
              name: "webSearch",
              arguments: { query: "quantum computing breakthrough" },
            },
          },
        ],
      },
    });

    const id1 = (
      result1 as Extract<typeof result1, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[0].id;
    const searchResult = [{ content: "Quantum computing is super fast..." }];

    // Step 2: summarize
    const result2 = await runToolCode(
      {
        code: CHAINED_CALLS,
        toolState: [{ type: "resolvedTool", id: id1, result: searchResult }],
      },
      [webSearchTool, summarizeTool, translateTool]
    );

    expect(result2).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          { type: "resolvedTool", id: id1 },
          {
            type: "pendingTool",
            function: {
              name: "summarize",
              arguments: { text: "Quantum computing is super fast..." },
            },
          },
        ],
      },
    });

    const id2 = (
      result2 as Extract<typeof result2, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[1].id;
    const summaryResult = "Quantum fast";

    // Step 3: translate
    const result3 = await runToolCode(
      {
        code: CHAINED_CALLS,
        toolState: [
          { type: "resolvedTool", id: id1, result: searchResult },
          { type: "resolvedTool", id: id2, result: summaryResult },
        ],
      },
      [webSearchTool, summarizeTool, translateTool]
    );

    expect(result3).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          { type: "resolvedTool", id: id1 },
          { type: "resolvedTool", id: id2 },
          {
            type: "pendingTool",
            function: {
              name: "translate",
              arguments: { text: "Quantum fast", targetLanguage: "French" },
            },
          },
        ],
      },
    });

    const id3 = (
      result3 as Extract<typeof result3, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[2].id;
    const translationResult = "Quantique rapide";

    // Step 4: Success
    const result4 = await runToolCode(
      {
        code: CHAINED_CALLS,
        toolState: [
          { type: "resolvedTool", id: id1, result: searchResult },
          { type: "resolvedTool", id: id2, result: summaryResult },
          { type: "resolvedTool", id: id3, result: translationResult },
        ],
      },
      [webSearchTool, summarizeTool, translateTool]
    );

    expect(result4).toEqual({
      type: "code_result",
      result: {
        type: "success",
        value: "Quantique rapide",
      },
    } satisfies RunToolCodeResult);
  });

  it("should handle mixed parallel and sequential calls", async () => {
    // Step 1: Parallel web searches
    const result1 = await runToolCode(
      { code: MIXED_PARALLEL_SEQUENTIAL, toolState: [] },
      [webSearchTool, summarizeTool]
    );

    expect(result1).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          {
            type: "pendingTool",
            function: {
              name: "webSearch",
              arguments: { query: "latest tech news" },
            },
          },
          {
            type: "pendingTool",
            function: {
              name: "webSearch",
              arguments: { query: "latest finance news" },
            },
          },
        ],
      },
    });

    const id1 = (
      result1 as Extract<typeof result1, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[0].id;
    const id2 = (
      result1 as Extract<typeof result1, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[1].id;
    const techResult = [{ content: "New iPhone released" }];
    const financeResult = [{ content: "Stocks are up" }];

    // Step 2: First summary (tech)
    const result2 = await runToolCode(
      {
        code: MIXED_PARALLEL_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: techResult },
          { type: "resolvedTool", id: id2, result: financeResult },
        ],
      },
      [webSearchTool, summarizeTool]
    );

    expect(result2).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          { type: "resolvedTool", id: id1 },
          { type: "resolvedTool", id: id2 },
          {
            type: "pendingTool",
            function: {
              name: "summarize",
              arguments: { text: "New iPhone released" },
            },
          },
        ],
      },
    });

    const id3 = (
      result2 as Extract<typeof result2, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[2].id;
    const techSummary = "iPhone new";

    // Step 3: Second summary (finance)
    const result3 = await runToolCode(
      {
        code: MIXED_PARALLEL_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: techResult },
          { type: "resolvedTool", id: id2, result: financeResult },
          { type: "resolvedTool", id: id3, result: techSummary },
        ],
      },
      [webSearchTool, summarizeTool]
    );

    expect(result3).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          { type: "resolvedTool", id: id1 },
          { type: "resolvedTool", id: id2 },
          { type: "resolvedTool", id: id3 },
          {
            type: "pendingTool",
            function: {
              name: "summarize",
              arguments: { text: "Stocks are up" },
            },
          },
        ],
      },
    });

    const id4 = (
      result3 as Extract<typeof result3, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[3].id;
    const financeSummary = "Stocks up";

    // Step 4: Success
    const result4 = await runToolCode(
      {
        code: MIXED_PARALLEL_SEQUENTIAL,
        toolState: [
          { type: "resolvedTool", id: id1, result: techResult },
          { type: "resolvedTool", id: id2, result: financeResult },
          { type: "resolvedTool", id: id3, result: techSummary },
          { type: "resolvedTool", id: id4, result: financeSummary },
        ],
      },
      [webSearchTool, summarizeTool]
    );

    expect(result4).toEqual({
      type: "code_result",
      result: {
        type: "success",
        value: { techSummary, financeSummary },
      },
    } satisfies RunToolCodeResult);
  });

  it("should handle data post-processing and filtering before next tool", async () => {
    // Step 1: Web search
    const result1 = await runToolCode(
      { code: POST_PROCESSING, toolState: [] },
      [webSearchTool, summarizeTool]
    );

    expect(result1).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          {
            type: "pendingTool",
            function: {
              name: "webSearch",
              arguments: { query: "healthy recipes" },
            },
          },
        ],
      },
    });

    const id1 = (
      result1 as Extract<typeof result1, { type: "partial_evaluation" }>
    ).partialEvaluation.toolState[0].id;
    const searchResults = [
      { content: "Burger recipe", tags: ["meat"] },
      { content: "Salad recipe", tags: ["vegetarian"] },
      { content: "Tofu stir fry", tags: ["vegetarian"] },
    ];

    // Step 2: Summarize filtered results (2 parallel calls expected)
    const result2 = await runToolCode(
      {
        code: POST_PROCESSING,
        toolState: [{ type: "resolvedTool", id: id1, result: searchResults }],
      },
      [webSearchTool, summarizeTool]
    );

    expect(result2).toMatchObject({
      type: "partial_evaluation",
      partialEvaluation: {
        toolState: [
          { type: "resolvedTool", id: id1 },
          {
            type: "pendingTool",
            function: {
              name: "summarize",
              arguments: { text: "Salad recipe" },
            },
          },
          {
            type: "pendingTool",
            function: {
              name: "summarize",
              arguments: { text: "Tofu stir fry" },
            },
          },
        ],
      },
    });

    // Check parallel structure in toolState
    const errorState = (
      result2 as Extract<typeof result2, { type: "partial_evaluation" }>
    ).partialEvaluation;
    expect(errorState.toolState).toHaveLength(3);
    const id2 = errorState.toolState[1].id;
    const id3 = errorState.toolState[2].id;

    // Step 3: Success
    const result3 = await runToolCode(
      {
        code: POST_PROCESSING,
        toolState: [
          { type: "resolvedTool", id: id1, result: searchResults },
          { type: "resolvedTool", id: id2, result: "Tasty salad" },
          { type: "resolvedTool", id: id3, result: "Good tofu" },
        ],
      },
      [webSearchTool, summarizeTool]
    );

    expect(result3).toEqual({
      type: "code_result",
      result: {
        type: "success",
        value: ["Tasty salad", "Good tofu"],
      },
    } satisfies RunToolCodeResult);
  });
});
