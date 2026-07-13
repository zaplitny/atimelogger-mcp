/**
 * Register the MCP server with a Personal Access Token.
 * Generate the token in the ATimeLogger web app first:
 *   Settings -> API Tokens -> Generate token  (the value is shown only once)
 * Usage: npm run setup  (or: tsx scripts/setup.ts [--url http://host:port])
 */
import * as readline from "node:readline";
import { stdin, stdout, argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const PAT_PREFIX = "atl_pat_";

function ask(question: string, mask = false): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
  if (mask) {
    const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
    anyRl._writeToOutput = (s: string) => {
      // Echo the prompt itself, mask typed characters.
      stdout.write(s.includes(question) ? s : "*");
    };
  }
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      if (mask) stdout.write("\n");
      res(answer.trim());
    });
  });
}

const PROD_URL = "https://app.atimelogger.pro";

// Production by default; override implicitly via --url or the ATL_BASE_URL env var.
const urlFlag = argv.indexOf("--url");
const baseUrl = (urlFlag > -1 ? argv[urlFlag + 1] : env.ATL_BASE_URL ?? PROD_URL).replace(/\/+$/, "");
const isDefaultUrl = baseUrl === PROD_URL;

if (!isDefaultUrl) {
  console.log(`Server: ${baseUrl}`);
}
console.log("Generate a Personal Access Token in the ATimeLogger web app: Settings -> API Tokens.\n");

const token = await ask("Paste your Personal Access Token: ", true);

if (!token) {
  console.error("No token entered.");
  exit(1);
}
if (!token.startsWith(PAT_PREFIX)) {
  console.warn(`\nWarning: the token does not start with "${PAT_PREFIX}" — it may be a legacy JWT. Continuing anyway.`);
}

let res: Response;
try {
  res = await fetch(`${baseUrl}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
} catch (e) {
  console.error(`\nCannot reach ATimeLogger at ${baseUrl} — is the server running? (${(e as Error).message})`);
  exit(1);
}

if (res.status === 401 || res.status === 403) {
  console.error("\nThe token was rejected (invalid, expired, or revoked). Generate a new one in Settings -> API Tokens and try again.");
  exit(1);
}
if (!res.ok) {
  console.error(`\nUnexpected response from the server (HTTP ${res.status}).`);
  exit(1);
}

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

const desktopConfigPath =
  process.platform === "win32"
    ? "%APPDATA%\\Claude\\claude_desktop_config.json"
    : "~/Library/Application Support/Claude/claude_desktop_config.json";

// The server itself defaults to production, so only surface ATL_BASE_URL on overrides.
const desktopEntry = {
  mcpServers: {
    atl: {
      command: "node",
      args: [serverEntry],
      env: {
        ...(isDefaultUrl ? {} : { ATL_BASE_URL: baseUrl }),
        ATL_TOKEN: token,
      },
    },
  },
};

const baseUrlArg = isDefaultUrl ? "" : `-e ATL_BASE_URL=${baseUrl} `;

console.log("\nToken verified.\n");
console.log("── Claude Code ─────────────────────────────────────────────\n");
console.log(`  claude mcp add atl ${baseUrlArg}-e ATL_TOKEN=${token} -- node ${serverEntry}`);
console.log("\n── Claude Desktop ──────────────────────────────────────────\n");
console.log(`Add this to ${desktopConfigPath}`);
console.log("(merge the \"atl\" entry into \"mcpServers\" if the file already has one), then restart Claude Desktop:\n");
console.log(
  JSON.stringify(desktopEntry, null, 2)
    .split("\n")
    .map((line) => "  " + line)
    .join("\n")
);
console.log("\nYou can revoke this token at any time in Settings -> API Tokens.");
