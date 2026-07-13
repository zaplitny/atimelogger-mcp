import { api } from "./client.js";

export interface ActivityTypeDto {
  id: string;
  name: string;
  group: boolean;
  color: number;
  imageId: string;
  parentId: string | null;
  order: number;
  deleted: boolean;
  archived: boolean;
  occurrence: boolean;
}

let cache: { types: ActivityTypeDto[]; at: number } | null = null;
const TTL_MS = 60_000;

export async function getTypes(): Promise<ActivityTypeDto[]> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { types: await api.get<ActivityTypeDto[]>("/api/types"), at: Date.now() };
  }
  return cache.types;
}

export async function typeNameById(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const t of await getTypes()) map.set(t.id, t.name);
  return map;
}

export interface ResolveOptions {
  allowGroups?: boolean;
}

export async function resolveTypeName(name: string, opts: ResolveOptions = {}): Promise<ActivityTypeDto> {
  const all = (await getTypes()).filter((t) => !t.deleted && !t.archived);
  const candidates = opts.allowGroups ? all : all.filter((t) => !t.group);
  const needle = name.trim().toLowerCase();

  const exact = candidates.filter((t) => t.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous(name, exact);

  const partial = candidates.filter((t) => t.name.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw ambiguous(name, partial);

  const names = candidates.map((t) => t.name).slice(0, 30);
  throw new Error(
    `No activity type matches "${name}". Available types: ${names.join(", ")}` +
      (opts.allowGroups ? "" : " (groups excluded — a group cannot be started directly)")
  );
}

export async function resolveTypeById(id: string, opts: ResolveOptions = {}): Promise<ActivityTypeDto> {
  const match = (await getTypes()).find((t) => t.id === id && !t.deleted);
  if (!match) {
    throw new Error(`No activity type with id "${id}" — call list_activity_types for current ids.`);
  }
  if (!opts.allowGroups && match.group) {
    throw new Error(`"${match.name}" is a group and cannot be started or logged directly.`);
  }
  return match;
}

function ambiguous(name: string, matches: ActivityTypeDto[]): Error {
  return new Error(
    `Activity type name "${name}" is ambiguous, matches: ${matches.map((t) => t.name).join(", ")}. Use a more specific name.`
  );
}

export async function resolveTypeNames(names: string[] | undefined, opts: ResolveOptions = {}): Promise<string[] | undefined> {
  if (!names || names.length === 0) return undefined;
  const resolved = await Promise.all(names.map((n) => resolveTypeName(n, opts)));
  return resolved.map((t) => t.id);
}
