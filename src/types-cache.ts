import { api as envApi, type Api } from "./client.js";

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

export interface ResolveOptions {
  allowGroups?: boolean;
}

export interface TypesCache {
  getTypes(): Promise<ActivityTypeDto[]>;
  typeNameById(): Promise<Map<string, string>>;
  resolveTypeName(name: string, opts?: ResolveOptions): Promise<ActivityTypeDto>;
  resolveTypeById(id: string, opts?: ResolveOptions): Promise<ActivityTypeDto>;
  resolveTypeNames(names: string[] | undefined, opts?: ResolveOptions): Promise<string[] | undefined>;
}

const TTL_MS = 60_000;

function ambiguous(name: string, matches: ActivityTypeDto[]): Error {
  return new Error(
    `Activity type name "${name}" is ambiguous, matches: ${matches.map((t) => t.name).join(", ")}. Use a more specific name.`
  );
}

/** Each cache owns its own 60s snapshot, so separate clients never share state. */
export function createTypesCache(api: Api): TypesCache {
  let cache: { types: ActivityTypeDto[]; at: number } | null = null;

  const getTypes = async (): Promise<ActivityTypeDto[]> => {
    if (!cache || Date.now() - cache.at > TTL_MS) {
      cache = { types: await api.get<ActivityTypeDto[]>("/api/types"), at: Date.now() };
    }
    return cache.types;
  };

  const resolveTypeName = async (name: string, opts: ResolveOptions = {}): Promise<ActivityTypeDto> => {
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
  };

  return {
    getTypes,
    resolveTypeName,
    typeNameById: async () => {
      const map = new Map<string, string>();
      for (const t of await getTypes()) map.set(t.id, t.name);
      return map;
    },
    resolveTypeById: async (id: string, opts: ResolveOptions = {}) => {
      const match = (await getTypes()).find((t) => t.id === id && !t.deleted);
      if (!match) {
        throw new Error(`No activity type with id "${id}" — call list_activity_types for current ids.`);
      }
      if (!opts.allowGroups && match.group) {
        throw new Error(`"${match.name}" is a group and cannot be started or logged directly.`);
      }
      return match;
    },
    resolveTypeNames: async (names: string[] | undefined, opts: ResolveOptions = {}) => {
      if (!names || names.length === 0) return undefined;
      const resolved = await Promise.all(names.map((n) => resolveTypeName(n, opts)));
      return resolved.map((t) => t.id);
    },
  };
}

/** Cache bound to the environment-driven client (MCP server, CLI). */
export const defaultTypesCache: TypesCache = createTypesCache(envApi);

export const { getTypes, typeNameById, resolveTypeName, resolveTypeById, resolveTypeNames } = defaultTypesCache;
