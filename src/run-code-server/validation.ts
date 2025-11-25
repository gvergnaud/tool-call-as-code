import { Ajv, ErrorObject } from "ajv";
import { ToolWithOutput } from "./schema";

const parametersSchemaToJSONSchema = (parameters: Record<string, unknown>) => {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: parameters.properties,
    required: parameters.required,
  };
};

const ajv = new Ajv();

export async function validateToolSchemas(
  tools: readonly ToolWithOutput[]
): Promise<
  | { isValid: true; errors: undefined }
  | { isValid: false; errors: ErrorObject[] }
> {
  for (const tool of tools) {
    const schema = parametersSchemaToJSONSchema(tool.function.parameters);
    const isValid = await ajv.validateSchema(schema);
    if (!isValid) {
      return { isValid: false, errors: ajv.errors ?? [] };
    }
  }
  return { isValid: true, errors: undefined };
}

export function validateParameters(
  parametersSchema: Record<string, unknown>,
  parameters: Record<string, unknown>
):
  | { isValid: true; errors: undefined }
  | { isValid: false; errors: ErrorObject[] } {
  const validator = ajv.compile(parametersSchemaToJSONSchema(parametersSchema));
  const isValid = validator(parameters);
  return isValid
    ? { isValid: true, errors: undefined }
    : { isValid: false, errors: validator.errors ?? [] };
}
