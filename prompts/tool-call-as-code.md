Toolcalls as code

- tools are formatted as typescript types in the system prompt
- A single run_typescript function exposed to the model
- When executing run_typescript, spawn an isolate
- tools are implemented as a promise that either rejects a:
  - newToolCall message, containing name and args
  - A mismatched tool call message (when the toolcall executed doesn’t match the current stack)
- Or returns the value from the stack
- The run_code function can either return
  - a PartialEvaluation object with { code: string, toolState: (PendingTool | ResolvedTool | RejectedTool)[] }
  - A result object, contain the final result of run_typescript
- The client is sent the execution context, and needs to replace pending tool calls with resolve or rejected
