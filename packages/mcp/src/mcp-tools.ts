/**
 * MCP tool implementations.
 *
 * Each tool wraps the corresponding CLI handler via captureOutput(),
 * converting the handler's JSON output into MCP tool results.
 */

import {
  handleSession,
  handleAccount,
  handleGeos,
  handleOpen,
  captureOutput,
} from "aluvia";

type ToolResult = { data: Record<string, unknown>; isError: boolean };

export async function sessionStart(args: {
  url: string;
  connectionId?: number;
  headful?: boolean;
  browserSession?: string;
  autoUnblock?: boolean;
  disableBlockDetection?: boolean;
}): Promise<ToolResult> {
  return captureOutput(() =>
    handleOpen({
      url: args.url,
      connectionId: args.connectionId,
      headless: !args.headful,
      sessionName: args.browserSession,
      autoUnblock: args.autoUnblock,
      disableBlockDetection: args.disableBlockDetection,
    }),
  );
}

export async function sessionClose(args: {
  browserSession?: string;
  all?: boolean;
}): Promise<ToolResult> {
  const cliArgs = ["close"];
  if (args.browserSession)
    cliArgs.push("--browser-session", args.browserSession);
  if (args.all) cliArgs.push("--all");
  return captureOutput(() => handleSession(cliArgs));
}

export async function sessionList(): Promise<ToolResult> {
  return captureOutput(() => handleSession(["list"]));
}

export async function sessionGet(args: {
  browserSession?: string;
}): Promise<ToolResult> {
  const cliArgs = ["get"];
  if (args.browserSession)
    cliArgs.push("--browser-session", args.browserSession);
  return captureOutput(() => handleSession(cliArgs));
}

export async function sessionRotateIp(args: {
  browserSession?: string;
}): Promise<ToolResult> {
  const cliArgs = ["rotate-ip"];
  if (args.browserSession)
    cliArgs.push("--browser-session", args.browserSession);
  return captureOutput(() => handleSession(cliArgs));
}

export async function sessionSetGeo(args: {
  geo?: string;
  clear?: boolean;
  browserSession?: string;
}): Promise<ToolResult> {
  const cliArgs = ["set-geo"];
  if (args.geo) cliArgs.push(args.geo);
  if (args.clear) cliArgs.push("--clear");
  if (args.browserSession)
    cliArgs.push("--browser-session", args.browserSession);
  return captureOutput(() => handleSession(cliArgs));
}

export async function sessionSetRules(args: {
  rules?: string;
  remove?: string;
  browserSession?: string;
}): Promise<ToolResult> {
  const cliArgs = ["set-rules"];
  if (args.rules) cliArgs.push(args.rules);
  if (args.remove) cliArgs.push("--remove", args.remove);
  if (args.browserSession)
    cliArgs.push("--browser-session", args.browserSession);
  return captureOutput(() => handleSession(cliArgs));
}

export async function accountGet(): Promise<ToolResult> {
  return captureOutput(() => handleAccount([]));
}

export async function accountUsage(args: {
  start?: string;
  end?: string;
}): Promise<ToolResult> {
  const cliArgs = ["usage"];
  if (args.start) cliArgs.push("--start", args.start);
  if (args.end) cliArgs.push("--end", args.end);
  return captureOutput(() => handleAccount(cliArgs));
}

export async function geosList(): Promise<ToolResult> {
  return captureOutput(() => handleGeos());
}
