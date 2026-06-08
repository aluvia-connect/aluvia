#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as tools from "./mcp-tools.js";

type SessionStartArgs = {
  url: string;
  connectionId?: number;
  headful?: boolean;
  browserSession?: string;
  autoUnblock?: boolean;
  disableBlockDetection?: boolean;
};

const server = new McpServer({
  name: "aluvia",
  version: "1.2.0",
});

// Type assertion avoids TS2589 (excessively deep instantiation) from MCP SDK + Zod generics
const tool = server.tool.bind(server) as (...args: unknown[]) => void;

// --- Session tools ---

tool(
  "session_start",
  "Start a browser session with Aluvia smart proxy. Spawns a headless browser connected through Aluvia gateway. Returns session details including CDP URL for remote debugging.",
  {
    url: z.string().describe("URL to open in the browser"),
    connectionId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Use a specific Aluvia connection ID"),
    headful: z
      .boolean()
      .optional()
      .describe("Run browser in headful mode (default: headless)"),
    browserSession: z
      .string()
      .optional()
      .describe("Custom session name (auto-generated if omitted)"),
    autoUnblock: z
      .boolean()
      .optional()
      .describe("Auto-detect blocks and reload through Aluvia proxy"),
    disableBlockDetection: z
      .boolean()
      .optional()
      .describe("Disable block detection entirely"),
  },
  async (args: SessionStartArgs) => {
    const result = await tools.sessionStart(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

type SessionCloseArgs = { browserSession?: string; all?: boolean };

tool(
  "session_close",
  "Close one or all running browser sessions. Sends SIGTERM for graceful shutdown, then SIGKILL if needed.",
  {
    browserSession: z
      .string()
      .optional()
      .describe("Name of session to close (auto-selects if only one)"),
    all: z.boolean().optional().describe("Close all sessions"),
  },
  async (args: SessionCloseArgs) => {
    const result = await tools.sessionClose(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

tool(
  "session_list",
  "List all active browser sessions with their PIDs, URLs, and proxy configuration.",
  async () => {
    const result = await tools.sessionList();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

tool(
  "session_get",
  "Get detailed information about a running session including proxy URLs, connection data, and block detection state.",
  {
    browserSession: z
      .string()
      .optional()
      .describe("Name of session (auto-selects if only one)"),
  },
  async (args: { browserSession?: string }) => {
    const result = await tools.sessionGet(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

tool(
  "session_rotate_ip",
  "Rotate the IP address for a running session by generating a new session ID on the Aluvia connection.",
  {
    browserSession: z
      .string()
      .optional()
      .describe("Name of session (auto-selects if only one)"),
  },
  async (args: { browserSession?: string }) => {
    const result = await tools.sessionRotateIp(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

tool(
  "session_set_geo",
  "Set or clear the target geographic region for a running session. Affects which mobile IP pool is used.",
  {
    geo: z.string().optional().describe('Geo code to set (e.g. "US", "GB")'),
    clear: z
      .boolean()
      .optional()
      .describe("Clear the target geo instead of setting one"),
    browserSession: z
      .string()
      .optional()
      .describe("Name of session (auto-selects if only one)"),
  },
  async (args: { geo?: string; clear?: boolean; browserSession?: string }) => {
    const result = await tools.sessionSetGeo(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

tool(
  "session_set_rules",
  'Append or remove proxy routing rules for a running session. Rules are hostname patterns (e.g. "example.com", "*.google.com").',
  {
    rules: z
      .string()
      .optional()
      .describe('Comma-separated rules to append (e.g. "a.com,b.com")'),
    remove: z
      .string()
      .optional()
      .describe("Comma-separated rules to remove instead of appending"),
    browserSession: z
      .string()
      .optional()
      .describe("Name of session (auto-selects if only one)"),
  },
  async (args: {
    rules?: string;
    remove?: string;
    browserSession?: string;
  }) => {
    const result = await tools.sessionSetRules(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

// --- Account tools ---

tool(
  "account_get",
  "Get Aluvia account information including plan details and current balance.",
  async () => {
    const result = await tools.accountGet();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

tool(
  "account_usage",
  "Get Aluvia account usage statistics for a date range.",
  {
    start: z
      .string()
      .optional()
      .describe(
        'Start date filter (ISO8601 format, e.g. "2024-01-01T00:00:00Z")',
      ),
    end: z.string().optional().describe("End date filter (ISO8601 format)"),
  },
  async (args: { start?: string; end?: string }) => {
    const result = await tools.accountUsage(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

// --- Geo tools ---

tool(
  "geos_list",
  "List all available geographic regions for proxy targeting.",
  async () => {
    const result = await tools.geosList();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
      isError: result.isError,
    };
  },
);

// --- Start server ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Aluvia MCP server running on stdio");
}

// Only run when executed directly (not when imported for testing).
// Resolve process.argv[1] through any symlinks (e.g. npm's global bin -> dist/esm/mcp-server.js)
// and compare to this module's URL. This is symlink-safe, unlike a filename regex which
// fails when launched via the extension-less `aluvia-mcp` bin symlink.
const entry = process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "";
// @ts-ignore - import.meta.url exists at runtime in ESM (the only build the bin/main uses)
const isMcpServer = entry === import.meta.url;
if (isMcpServer) {
  main().catch((err) => {
    console.error("Fatal error in MCP server:", err);
    process.exit(1);
  });
}
