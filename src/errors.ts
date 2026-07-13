export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export function textResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }],
  };
}

export function withErrors<A extends unknown[]>(
  fn: (...args: A) => Promise<ToolResult>
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return {
        content: [{ type: "text", text: (e as Error).message }],
        isError: true,
      };
    }
  };
}
