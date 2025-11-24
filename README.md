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

We introduce two new types to the completion API: `CodeMessage` and `CodeResultMessage`.

```ts
type CodeMessage = {
  role: "code";
  id: string;
  code: string;
};

type CodeResultMessage = {
  role: "code_result";
  id: string;
  result:
    | { status: "success"; data: unknown }
    | { status: "error"; error: unknown };
};
```

They deliminate **a code evaluation block** in the message history. In between, we only allow `AssistantMessage`s containing tool calls, and `ToolMessage`s containing results.

#### Here is a first example showcasing **parallel tool calls**:

```ts
const messageHistoryExample [
  System,
  User(message: "Compare news in france and in the us today"),

  // The model wants to execute this code:
  Code(id: "code_1", code: `
    const [usNews, frenchNews] = await Promise.all([
      webSearch("news US today"),
      webSearch("actualités en france aujourd'hui")
    ]);

    return { usNews, frenchNews };
  `),
  // It runs server side, but the code block is exposed
  // so the API remains stateless.

  // Each function call is then turned into a tool call object:
  Assistant(message: "", tool_calls: [
    { id: "tc_1", function: { name: "webSearch", arguments: { query: "news US today" } } },
    { id: "tc_2", function: { name: "webSearch", arguments: { query: "actualités en france aujourd'hui" } } },
  ]),
  Tool(id: "tc_1", content: "[...]"),
  Tool(id: "tc_2", content: "[...]"),
  // This is possible here because the two webSearch run in parallel.
  // If the model had output sequential code, we would have needed
  // two round trips.

  // The returned value of the codeblock is exposed as a code result:
  CodeResult(id: "code_1", content: "{ usNews, frenchNews }"),
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

  Code(id: "code_1", code: `
    const usNews = await webSearch("news US today");
    const frenchNews = await webSearch("actualités en france aujourd'hui");

    return { usNews, frenchNews };
  `),

  // First tool call roundtrip:
  Assistant(message: "", tool_calls: [
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
  CodeResult(id: "code_1", content: "{ usNews, frenchNews }"),
  Assistant(message: "Here are the highlights of US and French news ...")
]
```

#### Tool calling data flow


<img width="2664" height="2218" alt="image" src="https://github.com/user-attachments/assets/349048f8-0f28-4e99-afb2-93544666eb30" />


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
      "content": "Compare news in france and in the us today"
    },
    {
      "role": "code",
      "code": "async function main() {\n  const resultsFrance = await webSearch({ query: \"news in France today\" });\n  const resultsUs = await webSearch({ query: \"news in US today\" });\n\n  return {\n    france: resultsFrance,\n    us: resultsUs\n  };\n}",
      "id": "UB4cbzkvQ"
    },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {
          "type": "function",
          "id": "3b3ca3ca-9d4a-43a1-8e63-e0785e421125",
          "index": 0,
          "function": {
            "name": "webSearch",
            "arguments": {
              "query": "news in France today"
            }
          }
        }
      ]
    },
    {
      "role": "tool",
      "content": "[{\"title\":\"Gouvernement annonce un plan de relance pour les énergies renouvelables\",\"description\":\"Le Premier ministre a dévoilé ce matin un plan de 10 milliards d'euros pour accélérer la transition énergétique, avec un focus sur l'éolien et le solaire. Les objectifs visent une réduction de 50 % des émissions de CO₂ d'ici 2030.\"},{\"title\":\"Ligue 1 : le PSG domine l'OM dans un Classique tendu\",\"description\":\"Le Paris Saint-Germain s'impose 3-2 face à l'Olympique de Marseille lors d'un match riche en rebondissements. Mbappé marque un doublé et confirme sa forme éclatante à quelques semaines de la Coupe du Monde des Clubs.\"},{\"title\":\"Grèves dans les transports : la SNCF et la RATP appellent au dialogue\",\"description\":\"Une nouvelle journée de grève perturbe les transports en Île-de-France ce lundi. Les syndicats réclament des hausses de salaire et de meilleures conditions de travail, tandis que le gouvernement propose une médiation.\"}]",
      "toolCallId": "3b3ca3ca-9d4a-43a1-8e63-e0785e421125"
    },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        {
          "type": "function",
          "id": "0634fade-b8ce-4740-8aad-a624d5b7634a",
          "index": 1,
          "function": {
            "name": "webSearch",
            "arguments": {
              "query": "news in US today"
            }
          }
        }
      ]
    },
    {
      "role": "tool",
      "content": "[{\"title\":\"Federal Reserve hints at interest rate cut amid economic slowdown\",\"description\":\"The Fed signaled a potential rate cut in December as inflation cools and unemployment rises. Analysts warn of a possible recession if consumer spending continues to decline.\"},{\"title\":\"NFL: Chiefs secure playoff spot with thrilling overtime win\",\"description\":\"Patrick Mahomes leads the Kansas City Chiefs to a 27-24 victory over the Ravens, securing their fifth consecutive playoff berth. The game-winning drive included a 45-yard pass to Travis Kelce.\"},{\"title\":\"California wildfires force thousands to evacuate\",\"description\":\"Dozens of homes have been destroyed as wildfires rage across Northern California. Firefighters battle extreme winds and dry conditions, with containment efforts expected to take weeks.\"}]",
      "toolCallId": "83258ebb-f59b-4f90-a419-6c101f95ced8"
    },
    {
      "role": "code_result",
      "id": "I43ZeAkkl",
      "result": {
        "status": "success",
        "data": {
          "frenchNews": [
            {
              "title": "Gouvernement annonce un plan de relance pour les énergies renouvelables",
              "description": "Le Premier ministre a dévoilé ce matin un plan de 10 milliards d'euros pour accélérer la transition énergétique, avec un focus sur l'éolien et le solaire. Les objectifs visent une réduction de 50 % des émissions de CO₂ d'ici 2030."
            },
            {
              "title": "Ligue 1 : le PSG domine l'OM dans un Classique tendu",
              "description": "Le Paris Saint-Germain s'impose 3-2 face à l'Olympique de Marseille lors d'un match riche en rebondissements. Mbappé marque un doublé et confirme sa forme éclatante à quelques semaines de la Coupe du Monde des Clubs."
            },
            {
              "title": "Grèves dans les transports : la SNCF et la RATP appellent au dialogue",
              "description": "Une nouvelle journée de grève perturbe les transports en Île-de-France ce lundi. Les syndicats réclament des hausses de salaire et de meilleures conditions de travail, tandis que le gouvernement propose une médiation."
            }
          ],
          "usNews": [
            {
              "title": "Federal Reserve hints at interest rate cut amid economic slowdown",
              "description": "The Fed signaled a potential rate cut in December as inflation cools and unemployment rises. Analysts warn of a possible recession if consumer spending continues to decline."
            },
            {
              "title": "NFL: Chiefs secure playoff spot with thrilling overtime win",
              "description": "Patrick Mahomes leads the Kansas City Chiefs to a 27-24 victory over the Ravens, securing their fifth consecutive playoff berth. The game-winning drive included a 45-yard pass to Travis Kelce."
            },
            {
              "title": "California wildfires force thousands to evacuate",
              "description": "Dozens of homes have been destroyed as wildfires rage across Northern California. Firefighters battle extreme winds and dry conditions, with containment efforts expected to take weeks."
            }
          ]
        }
      }
    },
    {
      "role": "assistant",
      "content": "Here is a comparison of the news in France and the US today:\n\n### France\n\n1. **Gouvernement annonce un plan de relance pour les énergies renouvelables**\n   - The French Prime Minister unveiled a 10 billion euro plan to accelerate the energy transition, focusing on wind and solar power. The goal is to reduce CO₂ emissions by 50% by 2030.\n\n2. **Ligue 1 : le PSG domine l'OM dans un Classique tendu**\n   - Paris Saint-Germain defeated Olympique de Marseille 3-2 in an intense match. Kylian Mbappé scored twice and is in excellent form ahead of the Club World Cup.\n\n3. **Grèves dans les transports : la SNCF et la RATP appellent au dialogue**\n   - A new strike day is disrupting transport in the Île-de-France region. Unions are demanding salary increases and better working conditions, while the government proposes mediation.\n\n### US\n\n1. **Federal Reserve hints at interest rate cut amid economic slowdown**\n   - The Federal Reserve signaled a potential interest rate cut in December due to cooling inflation and rising unemployment. Analysts warn of a possible recession if consumer spending continues to decline.\n\n2. **NFL: Chiefs secure playoff spot with thrilling overtime win**\n   - Patrick Mahomes led the Kansas City Chiefs to a 27-24 victory over the Ravens, securing their fifth consecutive playoff berth. The game-winning drive included a 45-yard pass to Travis Kelce.\n\n3. **California wildfires force thousands to evacuate**\n   - Dozens of homes have been destroyed as wildfires rage across Northern California. Firefighters are battling extreme winds and dry conditions, with containment efforts expected to take weeks."
    }
  ]
  ```
</details>
