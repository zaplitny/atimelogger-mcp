import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ActivityTypeDto } from "../types-cache.js";
import { defaultContext, type Ctx } from "../context.js";
import { textResult, withErrors, UsageError } from "../errors.js";
import { READS, TOGGLES } from "./annotations.js";

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

export interface ArchiveTypeArgs {
  /** Name of the type or group (fuzzy matched) ... */
  type?: string;
  /** ... or its id from list_activity_types. */
  type_id?: string;
  /** Bring an archived type back instead of archiving it. */
  restore?: boolean;
}

export interface ArchivedType {
  name: string;
  id: string;
  group: boolean;
  archived: boolean;
}

/**
 * Archives a type or group, or with `restore` brings an archived one back. Only that node changes,
 * as when the apps archive it: what is inside a group stays as it is.
 */
export async function archiveType(args: ArchiveTypeArgs, ctx: Ctx = defaultContext()): Promise<ArchivedType> {
  const restore = args.restore ?? false;
  // archiving one that already is changes nothing, as in atl; restoring looks among the archived ones
  const opts = restore ? { allowGroups: true, archived: true } : { allowGroups: true, includeArchived: true };
  let type: ActivityTypeDto;
  if (args.type_id) {
    type = await ctx.types.resolveTypeById(args.type_id, opts);
  } else if (args.type?.trim()) {
    type = await ctx.types.resolveTypeName(args.type, opts);
  } else {
    throw new UsageError("Name the type or group to archive (type), or pass its type_id.");
  }
  if (type.readOnly) {
    throw new UsageError(`"${type.name}" is a category of the user's company: only the company can archive it.`);
  }
  await ctx.api.patch(`/api/types/${type.id}/archived`, { archived: !restore });
  ctx.types.invalidate();
  return { name: type.name, id: type.id, group: type.group, archived: !restore };
}

/** list_activity_types, plus archive_activity_type unless `write` is false. */
export function registerTypeTools(
  server: McpServer,
  ctx: Ctx = defaultContext(),
  { write = true }: { write?: boolean } = {}
): void {
  server.registerTool(
    "list_activity_types",
    {
      title: "Activity types",
      description:
        "List the user's activity types as a tree (groups contain children): names plus internal ids. " +
        "Use the names when talking to the user; use the ids for exact targeting in other tools.",
      inputSchema: {
        include_archived: z.boolean().optional().describe("Include archived types (default false)"),
      },
      annotations: READS,
    },
    withErrors(async ({ include_archived }) => textResult(await listTypes(include_archived ?? false, ctx)))
  );
  if (!write) return;

  server.registerTool(
    "archive_activity_type",
    {
      title: "Archive or restore activity type",
      description:
        "Archive an activity type or group the user no longer uses, or bring an archived one back (restore=true). " +
        "Only when the user asks for it. Archived types leave the type lists and cannot be started or logged; their " +
        "history is kept and still counts in reports. Archiving a group leaves the types inside it as they are. " +
        "list_activity_types with include_archived=true shows the archived ones.",
      inputSchema: {
        type: z.string().optional().describe("Name of the type or group, e.g. \"Guitar\""),
        type_id: z
          .string()
          .optional()
          .describe("Exact id from list_activity_types, instead of type (internal — never show ids to the user)"),
        restore: z.boolean().optional().describe("Bring an archived type back instead of archiving (default false)"),
      },
      annotations: TOGGLES,
    },
    withErrors(async (args) => {
      const t = await archiveType(args, ctx);
      return textResult({ [t.archived ? "archived" : "restored"]: t.name, kind: t.group ? "group" : "activity type", id: t.id });
    })
  );
}
