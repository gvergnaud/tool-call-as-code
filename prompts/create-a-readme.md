Look extensively at the implementation of this repository, and make a README for it, explaining the goal of the proof of concept, and how it works.

Here are some information to get you started:

- This repo is an experiment to check if we could implement tool calls as code, while preserving statelessness and preserving a client side tool call execution.
- Tool code as code (or code mode) is an idea introduced by cloudflare in this article (go read it for details) https://blog.cloudflare.com/code-mode/
- The main drawback is that you need to have access to all implementations of tool calls in the machine running the code. Either the client needs to be able to spine up a TypeScript isolated runtime, or you need the server to have the implementation of all tools.
- We want to preserve the ability for the server to run the generated code, while enabling the client to own the implementation of these tools, and call them itself. This is what this experiment implements.
- The way it works is by introducing two new message types in the LLM completion API: CodeMessage and CodeResultMessage, to store the execution context state. These messages are sent to the client, and delimitate a succession of assistant messages and tool results for the current code evalution block.
- The model generates code for a run_typescript tool that only exists server-side.
- This code can call functions that are in fact tools defined by the client.
- On the server, we try running the code, and every-time the code invokes a tool, we collect the arguments, and return a rejecting promise.
- We then send these tool calls to the client as standard ToolCall objects (as defined by the tool calling protocol of openai https://platform.openai.com/docs/guides/function-calling)
- The client can execute these tools and send their results
- When the server receives these results, it re-runs the TypeScript code from the start, but swaps the tool call implementation with a function that returns a Resolved promise containing the result provided by the client.
- The code continues to run, and might get stuck on a new tool call later. If the happens, the same process happens once again, until we have tool results for all tool calls in the code.
- If we had all tool results when running the code, we evaluate the code until completion, and get the result and create a CodeResultMessage.
- Internally, the model sees CodeMessage as run_typescript tool calls, and CodeResultMessage as regular "tool" messages with the result for run_typescript. All messages in between are removed from the context, since they only exist to ask the client for intermediate tool results during a code execution.
