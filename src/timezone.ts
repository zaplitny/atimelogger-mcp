import { api as envApi, type Api } from "./client.js";

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
  let cached: { tz: string; at: number } | null = null;
  return {
    effectiveTimezone: async (override?: string): Promise<string> => {
      if (override) return override;
      if (!cached || Date.now() - cached.at > TTL_MS) {
        try {
          const user = await api.get<UserDto>("/api/users/me");
          cached = { tz: user.timeZone || systemTimezone(), at: Date.now() };
        } catch {
          cached = { tz: systemTimezone(), at: Date.now() };
        }
      }
      return cached.tz;
    },
  };
}

/** Resolver bound to the environment-driven client (MCP server, CLI). */
export const defaultTimezone: TimezoneResolver = createTimezone(envApi);

export const { effectiveTimezone } = defaultTimezone;
