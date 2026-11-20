#!/usr/bin/env node
import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createAtlServer } from "./server.js";

loadConfig(); // warns on stderr if ATL_TOKEN is missing (docs-only mode: only app_help works)

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = createAtlServer({ version });

const transport = new StdioServerTransport();
await server.connect(transport);
