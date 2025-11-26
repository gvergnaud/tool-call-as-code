# Tool Calls as Code POC

**TL;DR**: Tool call as code becomes an implementation details. We can retain the standard completion API while using code under the hood.

This proof of concept adds onto Cloudflare's "code mode" idea [^1]. Can an LLM emit TypeScript code instead of tool calls, but **stay stateless**, and still let **the client own the tools**?

The server runs the code but forwards each tool call to the remote client, so clients don't have to run their own TypeScript isolate or worker, and we can keep a separation of concerns between tool orchestration and tool implementation.

[^1]: Cloudflare, “Code Mode: the better way to use MCP,” https://blog.cloudflare.com/code-mode/

## Why this exists

- **Code mode recap.** Cloudflare’s code mode wraps MCP tools in a TypeScript API. The model writes code once, and the runtime executes it, improving the performance of multi-tool workflows compared with classical tool-calling [^1].
- **The gap.** In typical code mode as described by the article, whoever executes the generated code must also calls third party MCPs:
  - If the model API runs the code, then it must own connected MCP servers, and store authentication credentials on behalf of the API user, etc.
  - If the client runs the code, then it needs a solution for running TypeScript safely, which isn't always easy depending on their stack.
- **Experiment goal.** Keep code invokation entirely server-side, keep the client-server API stateless, yet forward each tool invocation to the client. The server owns the orchestration, the client owns the execution.

## High-level design

We introduce a new ToolCall type to the completion API: `ToolCallCode`.

```ts
type ToolCallCode = {
  type: "code";
  id: string;
  code: string;
};
```

A server message containing a code tool call and its result will deliminate **a code evaluation block** in the message history. In between, we only allow `AssistantMessage`s containing non-code tool calls, and `ToolMessage`s containing their results.

#### Here is a first example showcasing **parallel tool calls**:

```ts
const messageHistoryExample [
  System,
  User(message: "Compare news in france and in the us today"),

  Assistant(message: "", tool_calls: [
    // The model wants to execute this code:
    // It runs server side, but the code block is exposed
    // so the API remains stateless.
    { id: "code_1", type: "code", code: `
      const [usNews, frenchNews] = await Promise.all([
        webSearch("news US today"),
        webSearch("actualités en france aujourd'hui")
      ]);

      return { usNews, frenchNews };
    ` },
    // Each function call is then turned into a tool call object:
    { id: "tc_1", type: "function", function: { name: "webSearch", arguments: { query: "news US today" } } },
    { id: "tc_2", type: "function", function: { name: "webSearch", arguments: { query: "actualités en france aujourd'hui" } } },
  ]),
  Tool(id: "tc_1", content: "[...]"),
  Tool(id: "tc_2", content: "[...]"),
  // This is possible here because the two webSearch run in parallel.
  // If the model had output sequential code, we would have needed
  // two round trips.

  // The returned value of the codeblock is exposed as a code result:
  Too(id: "code_1", content: "{ usNews, frenchNews }"),
  // It's forwarded to the model as the only tool result it sees,
  // and it ouputs an assistant message:
  Assistant(message: "Here are the highlights of US and French news ...")
]
```

#### And another example with **sequential tool calls**:

```ts
const messageHistoryExample [
  System,
  User(message: "Compare news in france and in the us today"),

  Assistant(message: "", tool_calls: [
    { id: "code_1", type: "code", code: `
      const usNews = await webSearch("news US today");
      const frenchNews = await webSearch("actualités en france aujourd'hui");

      return { usNews, frenchNews };
    ` },
    // First tool call roundtrip:
    { id: "tc_1", function: { name: "webSearch", arguments: { query: "news US today" } } },
  ]),
  Tool(id: "tc_1", content: "[...]"),

  // Second tool call roundtrip:
  Assistant(message: "", tool_calls: [
    { id: "tc_2", function: { name: "webSearch", arguments: { query: "actualités en france aujourd'hui" } } },
  ]),
  Tool(id: "tc_2", content: "[...]"),
  // Note that the LLM isn't called in this case, this is all deterministic.

  // The rest is the same as in the parallel example:
  Tool(id: "code_1", content: "{ usNews, frenchNews }"),
  Assistant(message: "Here are the highlights of US and French news ...")
]
```

#### Tool calling data flow

<img width="2664" height="2218" alt="image" src="https://github.com/user-attachments/assets/34b54646-f790-4d63-b870-8592f4ac96bd" />

### How does it work?

1. Tool calls are initially implemented as functions returning rejecting promises. When executed, we capture their arguments to create a tool call object.
2. After executing the code up until it fails, we send an assistant message with tool calls to the client.
3. The client answers with tool results.
4. We rerun the code from the start, but replace stub implementations with their corresponding value, until it needs to execute more tool calls or complete.

The whole loop keeps the server stateless. Every run depends solely on the deterministic code string and the ordered list of tool results.

## Running the demo

```bash
npm install
export MISTRAL_API_KEY=sk-your-key
npm start
```

To run tests:

```bash
npm test
```

## Current limitations & next steps

- **Sandbox scope.** The isolate only exposes standard ECMAScript features; Node and browser APIs are unavailable by design. Providing whitelisted bindings (timers, logging, etc.) would require extra plumbing.
- **Error propagation.** Tool errors surface as rejected tool states but the story for non-tool runtime errors is minimal—improving developer feedback would matter for production.

This POC shows that code-mode style tool orchestration can keep the server stateless and still delegate execution to client-owned implementations, preserving the benefits of Cloudflare’s approach while loosening its deployment constraints.

## Example conversations

<details>
  <summary>Parallel tool call example</summary>
  
  ```json
  [
    {
      "role": "user",
      "content": "Look for sport news and international affaires news in parallel and give me all results."
    },
    {
      "role": "code",
      "code": "async function main() {\n    const [sportNews, internationalAffairesNews] = await Promise.all([\n        webSearch({ query: \"sport news\" }),\n        webSearch({ query: \"international affaires news\" }),\n    ]);\n\n    return {\n        sportNews,\n        internationalAffairesNews,\n    };\n}",
      "id": "JZsSpZjh0"
    },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {
          "type": "function",
          "function": {
            "name": "web_search",
            "arguments": "{\"query\":\"sport news\"}"
          },
          "id": "cff9ca16-a01c-47f5-9970-1a367476ed23"
        },
        {
          "type": "function",
          "function": {
            "name": "web_search",
            "arguments": "{\"query\":\"international affaires news\"}"
          },
          "id": "75614ff9-ce14-4d97-8433-28e0bb7a08ed"
        }
      ]
    },
    {
      "role": "tool",
      "content": "[{\"title\":\"UEFA Champions League: Real Madrid advances to semifinals\",\"url\":\"https://www.example.com/sport/real-madrid-semifinals\"},{\"title\":\"NBA: Lakers secure playoff spot with win over Warriors\",\"url\":\"https://www.example.com/sport/lakers-playoffs\"},{\"title\":\"Tennis: French Open set to begin next week\",\"url\":\"https://www.example.com/sport/french-open-preview\"}]",
      "toolCallId": "cff9ca16-a01c-47f5-9970-1a367476ed23"
    },
    {
      "role": "tool",
      "content": "[{\"title\":\"UN calls for ceasefire in Middle East amid escalating tensions\",\"url\":\"https://www.example.com/world/un-ceasefire-middle-east\"},{\"title\":\"EU leaders meet to discuss climate policy reforms\",\"url\":\"https://www.example.com/world/eu-climate-policy\"},{\"title\":\"US-China trade talks resume in Geneva\",\"url\":\"https://www.example.com/world/us-china-trade-talks\"}]",
      "toolCallId": "75614ff9-ce14-4d97-8433-28e0bb7a08ed"
    },
    {
      "role": "code_result",
      "id": "JZsSpZjh0",
      "result": {
        "status": "success",
        "data": {}
      }
    },
    {
      "role": "assistant",
      "content": "Here are the latest **sport news** and **international affairs news**:\n\n### Sport News\n\n- [UEFA Champions League: Real Madrid advances to semifinals](https://www.example.com/sport/real-madrid-semifinals)\n- [NBA: Lakers secure playoff spot with win over Warriors](https://www.example.com/sport/lakers-playoffs)\n- [Tennis: French Open set to begin next week](https://www.example.com/sport/french-open-preview)\n\n### International Affairs News\n\n- [UN calls for ceasefire in Middle East amid escalating tensions](https://www.example.com/world/un-ceasefire-middle-east)\n- [EU leaders meet to discuss climate policy reforms](https://www.example.com/world/eu-climate-policy)\n- [US-China trade talks resume in Geneva](https://www.example.com/world/us-china-trade-talks)"
    }
  ]
  ```
</details>

<details>
  <summary>Sequential tool call example</summary>
  
  ```json
  [
    {
      "role": "user",
      "content": "Analyze Apple's (AAPL) stock performance based on recent news."
    },
    {
      "role": "assistant",
      "toolCalls": [
        {
          "type": "code",
          "id": "I1hOvzzEl",
          "code": "async function main() {\n  const stockPrice = await getStockPrice({ symbol: \"AAPL\" });\n  const companyNews = await getCompanyNews({ symbol: \"AAPL\" });\n\n  const positiveNews = companyNews.filter((news) => news.sentiment === \"positive\");\n  const negativeNews = companyNews.filter((news) => news.sentiment === \"negative\");\n\n  return {\n    stockPrice,\n    positiveNewsCount: positiveNews.length,\n    negativeNewsCount: negativeNews.length,\n    positiveNews,\n    negativeNews\n  };\n}"
        }
      ]
    },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {
          "type": "function",
          "id": "330472e1-288e-49e4-9bd6-3164583855fa",
          "index": 0,
          "function": {
            "name": "getStockPrice",
            "arguments": {
              "symbol": "AAPL"
            }
          }
        }
      ]
    },
    {
      "role": "tool",
      "content": "{\"symbol\":\"AAPL\",\"price\":150,\"currency\":\"USD\"}",
      "toolCallId": "330472e1-288e-49e4-9bd6-3164583855fa"
    },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {
          "type": "function",
          "id": "d48b47fd-ec0d-474f-862f-d0ba97d93b8e",
          "index": 0,
          "function": {
            "name": "getCompanyNews",
            "arguments": {
              "symbol": "AAPL"
            }
          }
        }
      ]
    },
    {
      "role": "tool",
      "content": "[{\"title\":\"AAPL releases new product\",\"sentiment\":\"positive\"},{\"title\":\"Analyst upgrades AAPL\",\"sentiment\":\"positive\"}]",
      "toolCallId": "d48b47fd-ec0d-474f-862f-d0ba97d93b8e"
    },
    {
      "role": "tool",
      "toolCallId": "I1hOvzzEl",
      "content": "{\"status\":\"success\",\"data\":{\"stockPrice\":{\"symbol\":\"AAPL\",\"price\":150,\"currency\":\"USD\"},\"positiveNewsCount\":2,\"negativeNewsCount\":0,\"positiveNews\":[{\"title\":\"AAPL releases new product\",\"sentiment\":\"positive\"},{\"title\":\"Analyst upgrades AAPL\",\"sentiment\":\"positive\"}],\"negativeNews\":[]}}"
    },
    {
      "role": "assistant",
      "content": "Based on the recent news analysis for Apple (AAPL), the stock price is currently at $150.00 USD. There have been 2 positive news articles and no negative news articles. The positive news includes:\n\n- \"AAPL releases new product\"\n- \"Analyst upgrades AAPL\"\n\nThis positive sentiment in the news may indicate a favorable outlook for Apple's stock performance. However, it's important to consider other factors and conduct further analysis before making any investment decisions.",
      "toolCalls": []
    }
  ]
  ```
</details>
