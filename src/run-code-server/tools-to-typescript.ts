import { compile, Options } from "json-schema-to-typescript";
import { capitalize } from "remeda";
import { ToolWithOutput } from "./schema";

const compileOptions: Partial<Options> = {
  bannerComment: "",
  additionalProperties: false,
};

type ToolNameString = string;
type TypeScriptTypeString = string;

export const toolDefinitionsToTypeScriptTypes = async (
  tools: readonly ToolWithOutput[]
): Promise<Record<ToolNameString, TypeScriptTypeString>> => {
  const tsDeclarations = await Promise.all(
    tools.map(
      async (tool): Promise<[TypeScriptTypeString, TypeScriptTypeString]> => {
        const argTypeName = `${capitalize(tool.function.name)}Arg`;
        const returnTypeName = `${capitalize(tool.function.name)}Returned`;
        const [argsTs, outputTs] = await Promise.all([
          compile(tool.function.parameters as any, argTypeName, compileOptions),
          tool.function.outputSchema
            ? compile(
                tool.function.outputSchema,
                returnTypeName,
                compileOptions
              )
            : `type ${returnTypeName} = unknown;`,
        ]);

        const functionComment = tool.function.description
          ? `/**\n ${tool.function.description
              .split("\n")
              .map((line) => ` * ${line}`)
              .join("\n")}\n */`
          : "";

        const functionTs = `declare async function ${tool.function.name}(arg: ${argTypeName}): Promise<${returnTypeName}>`;

        return [
          argTypeName,
          `${argsTs}\n\n${outputTs}\n\n${functionComment}\n${functionTs}`,
        ];
      }
    )
  );
  return Object.fromEntries(tsDeclarations);
};
