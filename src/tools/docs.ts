import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textResult, withErrors } from "../errors.js";

// Public help site — unauthenticated, a different host than the API (ATL_BASE_URL).
const docsUrl = (process.env.ATL_DOCS_URL ?? "https://atimelogger.pro/docs/").replace(/\/*$/, "/");

export interface HelpPage {
  slug: string;
  title: string;
  summary: string;
}

export interface HelpIndex {
  note?: string;
  pages: HelpPage[];
}

const TTL_MS = 3_600_000;
let indexCache: { index: HelpIndex; at: number } | null = null;
const pageCache = new Map<string, { text: string; at: number }>();

async function fetchDocs(path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${docsUrl}${path}`);
  } catch (e) {
    throw new Error(unavailable((e as Error).message));
  }
  if (!res.ok) throw new Error(unavailable(`HTTP ${res.status} on ${path}`));
  return res.text();
}

function unavailable(detail: string): string {
  return `ATimeLogger documentation is temporarily unavailable (${detail}) — point the user to ${docsUrl} instead.`;
}

export async function helpIndex(): Promise<HelpIndex> {
  if (!indexCache || Date.now() - indexCache.at > TTL_MS) {
    const parsed = JSON.parse(await fetchDocs("help-index.json")) as HelpIndex;
    indexCache = { index: parsed, at: Date.now() };
  }
  return indexCache.index;
}

// Screenshots and layout markup mean nothing over MCP — keep only the text.
function normalize(md: string): string {
  return md
    .replace(/<figure>[\s\S]*?<\/figure>/g, "")
    .replace(/&#x20;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function helpPage(slug: string): Promise<string> {
  const cached = pageCache.get(slug);
  if (cached && Date.now() - cached.at <= TTL_MS) return cached.text;
  const text = normalize(await fetchDocs(`${slug}.md`));
  pageCache.set(slug, { text, at: Date.now() });
  return text;
}

function resolveTopic(topic: string, pages: HelpPage[]): HelpPage {
  const needle = topic.trim().toLowerCase().replace(/\.md$/, "");
  const exact = pages.find((p) => p.slug === needle);
  if (exact) return exact;
  const partial = pages.filter(
    (p) => p.slug.includes(needle) || p.title.toLowerCase().includes(needle)
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(
      `Help topic "${topic}" is ambiguous, matches: ${partial.map((p) => p.slug).join(", ")}. Use an exact slug.`
    );
  }
  throw new Error(
    `No help topic matches "${topic}". Available topics: ${pages.map((p) => p.slug).join(", ")}`
  );
}

export async function helpPages(topics: string[]): Promise<string> {
  const { pages } = await helpIndex();
  const resolved = topics.map((t) => resolveTopic(t, pages));
  const sections = await Promise.all(resolved.map((p) => helpPage(p.slug)));
  return sections.join("\n\n---\n\n");
}

export function registerDocTools(server: McpServer): void {
  server.registerTool(
    "app_help",
    {
      description:
        "Official ATimeLogger app documentation. Use it to answer any question about how the app works, " +
        "or how to do in the app what these tools cannot (edit entry times, delete records, goals, widgets, " +
        "CSV export, sync, backups, Pomodoro, Premium features). Call with no arguments for the table of " +
        "contents, then again with `topics` to fetch the relevant pages — answer from the docs, not from " +
        "memory. Cross-references like `sync.md` inside a page point to the topic with that slug. " +
        "The documentation describes the iOS app: most features also exist on Android/web, but menu paths " +
        "and UI details may differ — caveat this when the user is on another platform.",
      inputSchema: {
        topics: z
          .array(z.string())
          .optional()
          .describe(
            "Topic slugs from the table of contents (fuzzy matched against slug and title). Omit to get the table of contents."
          ),
      },
    },
    withErrors(async ({ topics }) => {
      if (!topics || topics.length === 0) {
        const { note, pages } = await helpIndex();
        return textResult({ note, help_topics: pages });
      }
      return textResult(await helpPages(topics));
    })
  );
}
