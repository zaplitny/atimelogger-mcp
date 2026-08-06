/** Bad caller input (usage mistake), as opposed to a runtime/API failure. The
 * MCP path treats it like any error; the CLI maps it to exit code 2. */
export class UsageError extends Error {}

/** The request never reached the server (DNS, refused connection, timeout).
 * Distinct from ApiError, which means the server answered with a failure. */
export class NetworkError extends Error {}

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
