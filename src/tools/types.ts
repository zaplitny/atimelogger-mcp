import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTypes, type ActivityTypeDto } from "../types-cache.js";
import { textResult, withErrors } from "../errors.js";

interface TypeNode {
  name: string;
  archived?: boolean;
  children?: TypeNode[];
}

function buildTree(types: ActivityTypeDto[], includeArchived: boolean): TypeNode[] {
  const visible = types.filter((t) => !t.deleted && (includeArchived || !t.archived));
  const byParent = new Map<string | null, ActivityTypeDto[]>();
  const ids = new Set(visible.map((t) => t.id));
  for (const t of visible) {
    const parent = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(t);
    byParent.set(parent, list);
  }
  const toNode = (t: ActivityTypeDto): TypeNode => {
    const node: TypeNode = { name: t.name };
    if (t.archived) node.archived = true;
    const children = byParent.get(t.id);
    if (children?.length) node.children = children.map(toNode);
    return node;
  };
  return (byParent.get(null) ?? []).map(toNode);
}

export function registerTypeTools(server: McpServer): void {
  server.registerTool(
    "list_activity_types",
    {
      description:
        "List the user's activity type names as a tree (groups contain children). " +
        "Use these names for start_activity, log_interval, and report filters.",
      inputSchema: {
        include_archived: z.boolean().optional().describe("Include archived types (default false)"),
      },
    },
    withErrors(async ({ include_archived }) => {
      const tree = buildTree(await getTypes(), include_archived ?? false);
      return textResult({ types: tree });
    })
  );
}
