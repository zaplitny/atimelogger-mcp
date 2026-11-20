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
  /** A copy of a company catalog node: the company decides its contents. */
  readOnly?: boolean;
}

export interface ResolveOptions {
  allowGroups?: boolean;
  /** Names match archived types instead of the active ones, and an id must be archived: the type to restore. */
  archived?: boolean;
  /**
   * Archived types match too (report filters: their history is kept). Without this or `archived`, only
   * active types do, so an archived one is never started, logged or used as a new type's group.
   */
  includeArchived?: boolean;
}

export interface TypesCache {
  getTypes(): Promise<ActivityTypeDto[]>;
  typeNameById(): Promise<Map<string, string>>;
  resolveTypeName(name: string, opts?: ResolveOptions): Promise<ActivityTypeDto>;
  resolveTypeById(id: string, opts?: ResolveOptions): Promise<ActivityTypeDto>;
  resolveTypeNames(names: string[] | undefined, opts?: ResolveOptions): Promise<string[] | undefined>;
  /** Drop the snapshot after a change, so the next lookup sees it. */
  invalidate(): void;
}

const TTL_MS = 60_000;

/** No type answers to that name or id, as opposed to one that is ambiguous, archived or a group. */
class NoSuchType extends UsageError {}

/**
 * A lookup that finds nothing in a list read longer ago than this reads the list again, once: the
 * user may have just added the type in the app, and the list is otherwise kept for TTL_MS.
 */
const RECHECK_AFTER_MS = 5_000;

function ambiguous(name: string, matches: ActivityTypeDto[]): Error {
  return new UsageError(
    `Activity type name "${name}" is ambiguous, matches: ${matches.map((t) => t.name).join(", ")}. Use a more specific name.`
  );
}

/** Each cache owns its own 60s snapshot, so separate clients never share state. */
export function createTypesCache(api: Api): TypesCache {
  // Deliberately no staleOnError: type ids drive filtering and writes, so an
  // auth or API failure must surface rather than be papered over with a
  // snapshot that may no longer be true. Archived types come too: reports name
  // them and they can be restored, but name lookups skip them unless asked.
  let readAt = 0;
  const getTypes = ttlCache(TTL_MS, async () => {
    const types = await api.get<ActivityTypeDto[]>("/api/types?includeArchived=true");
    readAt = Date.now();
    return types;
  });
  const withRecheck = async <T>(lookup: () => Promise<T>): Promise<T> => {
    try {
      return await lookup();
    } catch (e) {
      if (!(e instanceof NoSuchType) || Date.now() - readAt <= RECHECK_AFTER_MS) throw e;
      getTypes.clear();
      return lookup();
    }
  };

  const findByName = async (name: string, opts: ResolveOptions = {}): Promise<ActivityTypeDto> => {
    const all = (await getTypes()).filter(
      (t) => !t.deleted && (opts.includeArchived || Boolean(t.archived) === Boolean(opts.archived))
    );
    const candidates = opts.allowGroups ? all : all.filter((t) => !t.group);
    const needle = name.trim().toLowerCase();
    // with archived types in play, the one active type wins over its archived namesakes
    const preferActive = (matches: ActivityTypeDto[]) => {
      const active = matches.filter((t) => !t.archived);
      return opts.includeArchived && matches.length > 1 && active.length === 1 ? active : matches;
    };

    const exact = preferActive(candidates.filter((t) => t.name.toLowerCase() === needle));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) throw ambiguous(name, exact);

    const partial = preferActive(candidates.filter((t) => t.name.toLowerCase().includes(needle)));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw ambiguous(name, partial);

    const names = candidates.map((t) => t.name).slice(0, 30);
    throw new NoSuchType(
      `No ${opts.archived ? "archived " : ""}activity type matches "${name}". ` +
        `Available ${opts.archived ? "archived " : ""}types: ${names.join(", ") || "none"}` +
        (opts.allowGroups ? "" : " (groups excluded — a group cannot be started directly)")
    );
  };
  const resolveTypeName = (name: string, opts: ResolveOptions = {}) => withRecheck(() => findByName(name, opts));

  return {
    getTypes,
    invalidate: () => getTypes.clear(),
    resolveTypeName,
    typeNameById: async () => {
      const map = new Map<string, string>();
      for (const t of await getTypes()) map.set(t.id, t.name);
      return map;
    },
    resolveTypeById: (id: string, opts: ResolveOptions = {}) => withRecheck(async () => {
      const match = (await getTypes()).find((t) => t.id === id && !t.deleted);
      if (!match) {
        throw new NoSuchType(`No activity type with id "${id}" — call list_activity_types for current ids.`);
      }
      if (opts.archived && !match.archived) {
        throw new UsageError(`"${match.name}" is not archived.`);
      }
      if (match.archived && !opts.archived && !opts.includeArchived) {
        throw new UsageError(`"${match.name}" is archived: it cannot be used until it is restored.`);
      }
      if (!opts.allowGroups && match.group) {
        throw new UsageError(`"${match.name}" is a group and cannot be started or logged directly.`);
      }
      return match;
    }),
    resolveTypeNames: async (names: string[] | undefined, opts: ResolveOptions = {}) => {
      if (!names || names.length === 0) return undefined;
      const resolved = await Promise.all(names.map((n) => resolveTypeName(n, opts)));
      return resolved.map((t) => t.id);
    },
  };
}

/** Cache bound to the environment-driven client (MCP server, CLI). */
export const defaultTypesCache: TypesCache = createTypesCache(envApi);
