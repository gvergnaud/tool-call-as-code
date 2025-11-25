import { z } from "zod";

export const FunctionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()),
  strict: z.boolean().optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});

export type Function = z.infer<typeof FunctionSchema>;

export const ToolWithOutputSchema = z.object({
  type: z.literal("function").optional(),
  function: FunctionSchema,
});

export type ToolWithOutput = z.infer<typeof ToolWithOutputSchema>;

export const PendingToolSchema = z.object({
  type: z.literal("pendingTool"),
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
});

export type PendingTool = z.infer<typeof PendingToolSchema>;

export const ResolvedToolSchema = z.object({
  type: z.literal("resolvedTool"),
  id: z.string(),
  result: z.unknown(),
});

export type ResolvedTool = z.infer<typeof ResolvedToolSchema>;

export const RejectedToolSchema = z.object({
  type: z.literal("rejectedTool"),
  id: z.string(),
  error: z.unknown(),
});

export type RejectedTool = z.infer<typeof RejectedToolSchema>;

export const ToolStateSchema = z.union([
  PendingToolSchema,
  ResolvedToolSchema,
  RejectedToolSchema,
]);

export type ToolState = z.infer<typeof ToolStateSchema>;

export const PartialEvaluationSchema = z.object({
  code: z.string(),
  toolState: z.array(ToolStateSchema),
});

export type PartialEvaluation = z.infer<typeof PartialEvaluationSchema>;

/**
 * PartialEvaluation represents the state of a code execution
 * with intercepted tool calls.
 */

export const RunToolCodeResultSchema = z.union([
  z.object({
    type: z.literal("code_result"),
    result: z.union([
      z.object({
        type: z.literal("success"),
        value: z.unknown(),
      }),
      z.object({
        type: z.literal("error"),
        error: z.unknown(),
      }),
    ]),
  }),
  z.object({
    type: z.literal("partial_evaluation"),
    partialEvaluation: PartialEvaluationSchema,
  }),
  z.object({
    type: z.literal("error"),
    error: z.string(),
  }),
]);

export type RunToolCodeResult = z.infer<typeof RunToolCodeResultSchema>;

export type Result<A, B> =
  | {
      type: "success";
      value: A;
    }
  | {
      type: "error";
      error: B;
    };
