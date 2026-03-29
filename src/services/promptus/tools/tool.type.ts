export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface FunctionCallResult {
  message: string;
  name: string;
}

export interface ToolHandler {
  name: string;
  execute(args: unknown): Promise<FunctionCallResult>;
}
