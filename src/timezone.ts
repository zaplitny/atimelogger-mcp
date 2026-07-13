import { api } from "./client.js";

interface UserDto {
  timeZone?: string;
}

let cached: string | null = null;

function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Timezone used for interpreting and displaying times:
 * explicit override > ATimeLogger profile timezone > this machine's timezone.
 * The profile field is often empty (the app never forces it), and the MCP runs
 * on the user's own machine — so the system timezone beats a UTC fallback.
 */
export async function effectiveTimezone(override?: string): Promise<string> {
  if (override) return override;
  if (!cached) {
    try {
      const user = await api.get<UserDto>("/api/users/me");
      cached = user.timeZone || systemTimezone();
    } catch {
      cached = systemTimezone();
    }
  }
  return cached;
}
