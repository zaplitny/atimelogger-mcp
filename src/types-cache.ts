import { api as envApi, type Api } from "./client.js";
import { UsageError } from "./errors.js";
import { ttlCache } from "./ttl-cache.js";

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
  return new UsageError(
    `Activity type name "${name}" is ambiguous, matches: ${matches.map((t) => t.name).join(", ")}. Use a more specific name.`
  );
}

/** Each cache owns its own 60s snapshot, so separate clients never share state. */
export function createTypesCache(api: Api): TypesCache {
  // Deliberately no staleOnError: type ids drive filtering and writes, so an
  // auth or API failure must surface rather than be papered over with a
  // snapshot that may no longer be true.
  const getTypes = ttlCache(TTL_MS, () => api.get<ActivityTypeDto[]>("/api/types"));

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
    throw new UsageError(
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
        throw new UsageError(`No activity type with id "${id}" — call list_activity_types for current ids.`);
      }
      if (!opts.allowGroups && match.group) {
        throw new UsageError(`"${match.name}" is a group and cannot be started or logged directly.`);
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
