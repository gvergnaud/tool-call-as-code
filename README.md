# Tool Calls as Code POC

This proof of concept explores whether Cloudflare's “code mode” idea—where an LLM emits TypeScript that calls tools as ordinary async functions—can stay stateless while letting the **client** own the tool implementations. The repository shows how to keep the server authoritative over execution yet defer individual tool invocations to a remote client, avoiding the usual requirement that every runtime host all tool code locally [^1].

[^1]: Cloudflare, “Code Mode: the better way to use MCP,” https://blog.cloudflare.com/code-mode/

---

## Why this exists

- **Code mode recap.** Cloudflare’s code mode wraps MCP tools in a TypeScript API. The model writes code once, and the runtime executes it, dramatically improving multi-tool workflows compared with classical tool-calling [^1].
- **The gap.** In typical code mode deployments, whoever executes the generated code must also ship every tool implementation. That breaks separation of concerns when clients want to keep proprietary tools local, or when the server can’t spin up a sandbox that ships the same tool surface.
- **Experiment goal.** Keep code invokation entirely server-side, keep the client-server API stateless, yet forward each tool invocation to the client so it can execute the logic it owns. The client stays source of truth for tool behaviour while the server owns executing the generated code.

---

## High-level architecture

- **New message types.** The protocol introduces `CodeMessage` and `CodeResultMessage` (see `src/types.ts`). They bracket each execution attempt so the client can persist and resend the execution state without leaking intermediate tool exchanges back to the model.
- **Server (`src/server/server.ts`).**
  - Accepts a messages history including `CodeMessage` and `CodeResultMessage`, and projects (potentially partial) code execution slices into a "run_typescript" tool call and result to the model.
  - When a code evaluation is pending in the history (a `CodeMessage` doesn't have its corresponding `CodeResultMessage`), the server build an **evaluation context** that's passed to a sandbox runner.
  - The evaluation context is composed of the TypeScript code, as well as a list of tool function results.
- **Sandbox runner (`src/server/run-tool-code.ts`).** Replays the emitted TypeScript inside an isolate. Tool functions are stubbed so that:
  - If the isolate needs a new tool result, the stub rejects with a sentinel object. The server records the pending call and stops execution.
  - If a tool result is already known, the stub resolves immediately with the cached value.
  - All asynchronous behaviour is re-run from the top every time, keeping the server stateless.
- **Type-aware prompt.** Before consulting the LLM, the server converts tool schemas into TypeScript type definitions with `json-schema-to-typescript`. These declarations are embedded in a system prompt that documents the single `run_typescript` tool and the available tool functions.

---

## End-to-end flow

1. **Client call.** `CodeModeAgent` sends the accumulated messages plus local tool definitions to the server.
2. **Prompt shaping.** The server turns tool schemas into TypeScript declarations, injects them into the system message, and offers only the `run_typescript` tool to the LLM.
3. **Model output.** The LLM emits a `run_typescript` tool call whose argument is a TypeScript program containing an `async function main()`.
4. **Code message.** The server translates the tool call into a `CodeMessage` and attempts to execute the code in the isolate.
5. **Tool interception.** Whenever `main()` calls a tool (e.g., `webSearch`), the stub either:
   - Resolves with a previously supplied result, or
   - Rejects with a `newToolCall` sentinel, signalling that the client must execute the tool.
6. **Pending calls surfaced.** Rejected sentinels become an assistant message with OpenAI-compatible tool calls. The client sees this, executes its local tool functions, and replies with standard tool messages.
7. **Replay with results.** The server reruns the TypeScript from scratch, this time seeding the tool stubs with the freshly returned values. Additional tool calls loop through steps 5–7.
8. **Completion.** When `main()` resolves, the server emits a `CodeResultMessage`, maps it back to a synthetic `run_typescript` tool response for the LLM transcript, and the conversation continues with ordinary assistant messages.

## The whole loop keeps the server stateless—every run depends solely on the deterministic code string and the ordered list of tool results.

## Running the demo

```bash
npm install
export MISTRAL_API_KEY=sk-your-key
npm start
```

- The demo client asks for “sport news and international affaires news,” provoking parallel tool calls.
- Tool outputs are mocked inside the client `implementation` functions; replace them with real logic to integrate live APIs.

To run the sandbox tests:

```bash
npm test
```

Vitest verifies that pending tool calls are surfaced, replayed with resolved results, and that parallel `Promise.all` usage yields multiple pending calls in one pass.

---

## Current limitations & next steps

- **Sandbox scope.** The isolate only exposes standard ECMAScript features; Node and browser APIs are unavailable by design. Providing whitelisted bindings (timers, logging, etc.) would require extra plumbing.
- **Error propagation.** Tool errors surface as rejected tool states but the story for non-tool runtime errors is minimal—improving developer feedback would matter for production.

---

This POC shows that code-mode style tool orchestration can keep the server stateless and still delegate execution to client-owned implementations, preserving the benefits of Cloudflare’s approach while loosening its deployment constraints.

## Example client conversation

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
