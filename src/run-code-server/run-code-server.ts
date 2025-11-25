import express from "express";
import { z } from "zod";
import { runToolCode } from "./run-tool-code";
import { PartialEvaluationSchema, ToolWithOutputSchema } from "./schema";
import { toolDefinitionsToTypeScriptTypes } from "./tools-to-typescript";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.post("/convert-tools", async (req, res) => {
  try {
    const tools = z.array(ToolWithOutputSchema).parse(req.body);
    const result = await toolDefinitionsToTypeScriptTypes(tools);
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
        tools: z.array(ToolWithOutputSchema),
      })
      .parse(req.body);

    const result = await runToolCode(partialEvaluation, tools);
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
