import { api as envApi, type Api } from "./client.js";
import { ttlCache } from "./ttl-cache.js";

interface UserDto {
  timeZone?: string;
}

export interface TimezoneResolver {
  effectiveTimezone(override?: string): Promise<string>;
}

/** Longer than the 60s types TTL — a profile timezone rarely changes, but a
 * long-lived embedded client must not pin it (or a fallback) forever. */
const TTL_MS = 60 * 60_000;

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Timezone used for interpreting and displaying times:
 * explicit override > ATimeLogger profile timezone > this machine's timezone.
 * The profile field is often empty (the app never forces it), and the MCP runs
 * on the user's own machine — so the system timezone beats a UTC fallback.
 */
export function createTimezone(api: Api): TimezoneResolver {
  // staleOnError: a failed refresh must never replace a zone we already
  // resolved. A wrong timezone is silent — it shifts day boundaries and the
  // wall-clock times of written intervals rather than raising anything. With
  // nothing cached yet there is nothing to keep, so the machine's zone stands
  // in and the next call retries.
  const profileTimezone = ttlCache(
    TTL_MS,
    async () => (await api.get<UserDto>("/api/users/me")).timeZone || systemTimezone(),
    { staleOnError: true }
  );
  return {
    effectiveTimezone: async (override?: string): Promise<string> => {
      if (override) return override;
      try {
        return await profileTimezone();
      } catch {
        return systemTimezone();
      }
    },
  };
}

/** Resolver bound to the environment-driven client (MCP server, CLI). */
export const defaultTimezone: TimezoneResolver = createTimezone(envApi);

export const { effectiveTimezone } = defaultTimezone;
