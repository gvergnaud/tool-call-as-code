import express from "express";
import { z } from "zod";
import { Tool } from "@mistralai/mistralai/models/components";
import { PartialEvaluation, ToolWithOutput } from "../types";
import { getRunTypescriptToolAndSystemMessage } from "./get-run-typescript-tool";
import { runToolCode } from "./run-tool-code";

const app = express();
app.use(express.json({ limit: "50mb" }));

// --- Types & Schemas ---

const FunctionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional().nullable(),
  strict: z.boolean().optional(),
  returnSchema: z.record(z.string(), z.unknown()).optional(),
});

const ToolWithOutputSchema = z.object({
  type: z.literal("function"),
  function: FunctionSchema,
});

const PendingToolSchema = z.object({
  type: z.literal("pendingTool"),
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
});

const ResolvedToolSchema = z.object({
  type: z.literal("resolvedTool"),
  id: z.string(),
  result: z.unknown(),
});

const RejectedToolSchema = z.object({
  type: z.literal("rejectedTool"),
  id: z.string(),
  error: z.unknown(),
});

const ToolStateSchema = z.union([
  PendingToolSchema,
  ResolvedToolSchema,
  RejectedToolSchema,
]);

const PartialEvaluationSchema = z.object({
  code: z.string(),
  toolState: z.array(ToolStateSchema),
});

const ToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional().nullable(),
    strict: z.boolean().optional(),
  }),
});

// --- Endpoints ---

app.post("/convert-tools", async (req, res) => {
  try {
    const tools = z.array(ToolWithOutputSchema).parse(req.body);
    const result = await getRunTypescriptToolAndSystemMessage(
      tools as ToolWithOutput[]
    );
    res.json(result);
  } catch (error) {
    console.error(error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", issues: error.issues });
      return;
    }
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/evaluate", async (req, res) => {
  try {
    const { partialEvaluation, tools } = z
      .object({
        partialEvaluation: PartialEvaluationSchema,
        tools: z.array(ToolSchema),
      })
      .parse(req.body);

    const result = await runToolCode(
      partialEvaluation as PartialEvaluation,
      tools as Tool[]
    );
    res.json(result);
  } catch (error) {
    console.error(error);
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Validation error", issues: error.issues });
      return;
    }
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
