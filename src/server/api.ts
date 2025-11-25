import {
  PartialEvaluation,
  RunToolCodeResult,
  ToolWithOutput,
} from "../run-code-server/schema";

const CODE_SERVER_URL = "http://localhost:3001";

export async function convertTools(
  tools: readonly ToolWithOutput[]
): Promise<Record<string, string>> {
  const response = await fetch(`${CODE_SERVER_URL}/convert-tools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tools),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to convert tools: ${response.status} ${response.statusText} - ${text}`
    );
  }

  return (await response.json()) as Record<string, string>;
}

export async function runToolCode(
  partialEvaluation: PartialEvaluation,
  tools: readonly ToolWithOutput[]
): Promise<RunToolCodeResult> {
  const response = await fetch(`${CODE_SERVER_URL}/evaluate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partialEvaluation, tools }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to evaluate code: ${response.status} ${response.statusText} - ${text}`
    );
  }

  return (await response.json()) as RunToolCodeResult;
}
