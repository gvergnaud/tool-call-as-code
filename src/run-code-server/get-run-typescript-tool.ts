import { Tool } from "@mistralai/mistralai/models/components";
import { compile, Options } from "json-schema-to-typescript";
import { capitalize } from "remeda";
import { SystemMessage, ToolWithOutput } from "../types";

const compileOptions: Partial<Options> = {
  bannerComment: "",
  additionalProperties: false,
};

const toolDefinitionsToTypeScriptTypes = async (
  tools: readonly ToolWithOutput[]
): Promise<string> => {
  const tsDeclarations = await Promise.all(
    tools.map(async (tool) => {
      const argTypeName = `${capitalize(tool.function.name)}Arg`;
      const returnTypeName = `${capitalize(tool.function.name)}Returned`;
      const argsTs = await compile(
        tool.function.parameters as any,
        argTypeName,
        compileOptions
      );

      const outputTs = tool.function.returnSchema
        ? await compile(
            tool.function.returnSchema,
            returnTypeName,
            compileOptions
          )
        : `type ${returnTypeName} = unknown;`;

      const functionComment = tool.function.description
        ? `/**\n ${tool.function.description
            .split("\n")
            .map((line) => ` * ${line}`)
            .join("\n")}\n */`
        : "";

      const functionTs = `declare async function ${tool.function.name}(arg: ${argTypeName}): Promise<${returnTypeName}>`;

      return `${argsTs}\n\n${outputTs}\n\n${functionComment}\n${functionTs}`;
    })
  );

  return tsDeclarations.join("\n\n");
};

export const getRunTypescriptToolAndSystemMessage = async (
  tools: readonly ToolWithOutput[]
): Promise<{ runTypescriptTool: Tool; systemMessage: SystemMessage }> => {
  const tsDeclarations = await toolDefinitionsToTypeScriptTypes(tools);

  const runTypescriptTool: Tool = {
    type: "function",
    function: {
      name: "run_typescript",
      description:
        "Enables running TypeScript code in a sandbox environment.\n\nAlways define a `main` async function, and don't call it yourself. The sandbox expects this `main` function to be defined and calls it automatically.",
      parameters: {
        type: "object",
        properties: { code: { type: "string" } },
        required: ["code"],
      },
      strict: true,
    },
  };

  const toolNames = tools.map((t) => `\`${t.function.name}\``).join(", ");

  const systemMessage: SystemMessage = {
    role: "system",
    content: `
## How to use tools

You have access to a single \`run_typescript\` tool that enables you to run
TypeScript code in a sandbox environment. This sandbox has access to ES2015 - ES2022
language features, but doesn't have access to NodeJS or Browser API features.

**IMPORTANT:**
You might not see tools like ${toolNames} in your list of available tools.
However, you **DO HAVE ACCESS** to them as functions inside the \`run_typescript\` sandbox.
You SHOULD use these functions to answer user requests.
To use them, simply write a TypeScript script that calls these functions and execute it using the \`run_typescript\` tool.

### The \`main\` function

The sandboxed environment expects a \`main\` async function, and will run this function
automatically. You MUST generate all of your code in this \`async function main()\` block,
otherwise the call will fail. You don't need to call main, as the sandbox will do it for you.

### Available tool functions

In your \`main\` function, you can write arbitrary snippets of TypeScript code, as long as it only uses standard EcmaScript features, or one or several of the available tool functions defined below:

Tool functions:
\`\`\`ts
${tsDeclarations}
\`\`\`

Anytime you want to call one of these, you should call the \`run_typescript\` tool and write 
TypeScript code that uses the tool function.

The \`run_typescript\` tool result will be the returned value from your main function.

### Example

1. Assuming you have the following available functions:

\`\`\`ts
type GetArticlesArg = { query: string };

type GetArticlesReturned = { title: string, description: string }[];

declare function getArticles(arg: GetArticlesArg): Promise<GetArticlesReturned>;
\`\`\`

2. And the user query is "find articles about sport news, and only include articles with the word 'basketball' in the title."

3. You should call \`run_typescript\` with the following arguments:

\`\`\`json
{
  "code": "async function main() {\\n  const results = await getArticles({ query: \\"sport news\\" });\\n  return results.filter((result) => result.title.includes(\\"basketball\\"));\\n}"
}
\`\`\`

Rationale: 
- You use the \`getArticles\` function to get relevant articles, and then filter the result as instructed by the user query.
- You don't need to call main because the sandbox does it for you.

`.trim(),
  };
  return { runTypescriptTool, systemMessage };
};
