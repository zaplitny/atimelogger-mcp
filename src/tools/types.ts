import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ActivityTypeDto } from "../types-cache.js";
import { defaultContext, type Ctx } from "../context.js";
import { textResult, withErrors } from "../errors.js";

export interface TypeNode {
  name: string;
  id: string;
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
    const node: TypeNode = { name: t.name, id: t.id };
    if (t.archived) node.archived = true;
    const children = byParent.get(t.id);
    if (children?.length) node.children = children.map(toNode);
    return node;
  };
  return (byParent.get(null) ?? []).map(toNode);
}

export async function listTypes(
  includeArchived: boolean,
  ctx: Ctx = defaultContext()
): Promise<{ types: TypeNode[] }> {
  return { types: buildTree(await ctx.types.getTypes(), includeArchived) };
}

export function registerTypeTools(server: McpServer): void {
  server.registerTool(
    "list_activity_types",
    {
      description:
        "List the user's activity types as a tree (groups contain children): names plus internal ids. " +
        "Use the names when talking to the user; use the ids for exact targeting in other tools.",
      inputSchema: {
        include_archived: z.boolean().optional().describe("Include archived types (default false)"),
      },
    },
    withErrors(async ({ include_archived }) => {
      return textResult(await listTypes(include_archived ?? false));
    })
  );
}
