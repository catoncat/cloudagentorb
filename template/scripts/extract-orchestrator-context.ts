// Filter a cloud-agent transcript (written by cursor-cloud `batch-fetch-details`
// with includeTranscripts) into a digest small enough for a subagent to read.
//
// A full orchestrator transcript is ~0.5M tokens; subagents must never load it
// wholesale. This script keeps user messages (orchestrator-side user words, verbatim) and
// optionally matching assistant prose, and drops tool calls/results and
// thinking blocks entirely.
//
// Usage:
//   bun scripts/extract-orchestrator-context.ts <transcript.json|dir> [options]
//
// Modes / options:
//   --index              orientation mode: one line per user message (msg#, size, preview)
//   --last-user N        include the last N user messages verbatim (default 8; 0 disables)
//   --match <regex>      also include messages whose text matches (case-insensitive)
//   --roles a,b          roles searched by --match: user, assistant (default: user)
//   --around N           include N neighbouring user/assistant messages per match (default 0)
//   --msg N,M-K          include specific message indices (msg# from --index / digest output)
//   --max-chars N        output budget; oldest sections dropped first (default 32000)
//   --include-system     keep <system_notification>/<timestamp> user messages (skipped by default)
//
// Examples:
//   bun scripts/extract-orchestrator-context.ts /tmp/cursor/cloud-agent-transcripts/<ts>/<bcId> --index
//   bun scripts/extract-orchestrator-context.ts <dir> --last-user 8 --match "TICKET-12|milestone"
//   bun scripts/extract-orchestrator-context.ts <dir> --msg 1140,1173-1175

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface TranscriptMessage {
  role: string;
  text?: string;
  thinking?: string;
}

interface Section {
  index: number;
  role: string;
  reasons: Set<string>;
  text: string;
}

const DEFAULT_LAST_USER = 8;
const DEFAULT_MAX_CHARS = 32_000;
const INDEX_PREVIEW_CHARS = 100;

// User-role messages injected by the platform, not typed by a human.
const SYSTEM_MESSAGE_PREFIX = /^\s*<(?:system_notification|system_reminder|timestamp)\b/;

function fail(message: string): never {
  console.error(`extract-orchestrator-context: ${message}`);
  process.exit(1);
}

function resolveTranscriptPath(input: string): string {
  if (!existsSync(input)) fail(`path not found: ${input}`);
  if (statSync(input).isDirectory()) {
    const nested = join(input, "transcript.json");
    if (!existsSync(nested)) fail(`no transcript.json inside directory: ${input}`);
    return nested;
  }
  return input;
}

function parseIndices(spec: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range?.[1]) fail(`invalid --msg spec '${part}' (use N or N-M)`);
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : start;
    if (end < start) fail(`invalid --msg range '${part}'`);
    for (let i = start; i <= end && i < max; i++) out.add(i);
  }
  return [...out];
}

interface Options {
  path: string;
  index: boolean;
  lastUser: number;
  match: RegExp | null;
  matchRoles: Set<string>;
  around: number;
  explicit: string | null;
  maxChars: number;
  includeSystem: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    path: "",
    index: false,
    lastUser: DEFAULT_LAST_USER,
    match: null,
    matchRoles: new Set(["user"]),
    around: 0,
    explicit: null,
    maxChars: DEFAULT_MAX_CHARS,
    includeSystem: false,
  };
  const takeValue = (flag: string, value: string | undefined): string => {
    if (value === undefined) fail(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--index": options.index = true; break;
      case "--last-user": options.lastUser = Number(takeValue(arg, argv[++i])); break;
      case "--match": options.match = new RegExp(takeValue(arg, argv[++i]), "i"); break;
      case "--roles":
        options.matchRoles = new Set(takeValue(arg, argv[++i]).split(",").map((role) => role.trim()));
        for (const role of options.matchRoles) {
          if (role !== "user" && role !== "assistant") fail(`--roles only supports user, assistant (got '${role}')`);
        }
        break;
      case "--around": options.around = Number(takeValue(arg, argv[++i])); break;
      case "--msg": options.explicit = takeValue(arg, argv[++i]); break;
      case "--max-chars": options.maxChars = Number(takeValue(arg, argv[++i])); break;
      case "--include-system": options.includeSystem = true; break;
      default:
        if (arg.startsWith("--")) fail(`unknown option ${arg}`);
        if (options.path) fail(`unexpected extra argument '${arg}'`);
        options.path = arg;
    }
  }
  if (!options.path) fail("usage: bun scripts/extract-orchestrator-context.ts <transcript.json|dir> [options]");
  for (const [flag, value] of [["--last-user", options.lastUser], ["--around", options.around], ["--max-chars", options.maxChars]] as const) {
    if (!Number.isInteger(value) || value < 0) fail(`${flag} must be a non-negative integer`);
  }
  return options;
}

function loadMessages(path: string): TranscriptMessage[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { messages?: TranscriptMessage[] };
  if (!Array.isArray(parsed.messages)) fail(`${path}: expected {"messages": [...]} transcript shape`);
  return parsed.messages;
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function isSystemInjected(message: TranscriptMessage): boolean {
  return typeof message.text === "string" && SYSTEM_MESSAGE_PREFIX.test(message.text);
}

function printIndex(messages: TranscriptMessage[], options: Options): void {
  console.log(`# User-message index (${messages.length} messages total)`);
  console.log("# msg# | chars | preview — fetch bodies with --msg N or --msg N-M");
  let skipped = 0;
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user" || typeof message.text !== "string") continue;
    if (!options.includeSystem && isSystemInjected(message)) { skipped++; continue; }
    const preview = oneLine(message.text).slice(0, INDEX_PREVIEW_CHARS);
    console.log(`msg#${index} | ${message.text.length} | ${preview}`);
  }
  if (skipped > 0) console.log(`# (${skipped} system-injected user message(s) hidden — re-run with --include-system to list them)`);
}

function collectSections(messages: TranscriptMessage[], options: Options): Section[] {
  const sections = new Map<number, Section>();
  const add = (index: number, reason: string, force = false): void => {
    const message = messages[index];
    // Only prose carries dispatch context; tool traffic and thinking stay out of digests.
    if (!message || typeof message.text !== "string" || (message.role !== "user" && message.role !== "assistant")) return;
    if (!force && !options.includeSystem && isSystemInjected(message)) return;
    const existing = sections.get(index);
    if (existing) existing.reasons.add(reason);
    else sections.set(index, { index, role: message.role, reasons: new Set([reason]), text: message.text });
  };

  // Explicitly requested indices are always honored, even system-injected ones.
  if (options.explicit) for (const index of parseIndices(options.explicit, messages.length)) add(index, "requested", true);

  if (options.match) {
    for (const [index, message] of messages.entries()) {
      if (!options.matchRoles.has(message.role) || typeof message.text !== "string") continue;
      if (!options.includeSystem && isSystemInjected(message)) continue;
      if (!options.match.test(message.text)) continue;
      add(index, "match");
      for (let d = 1; d <= options.around; d++) {
        add(index - d, "context");
        add(index + d, "context");
      }
    }
  }

  if (options.lastUser > 0) {
    let remaining = options.lastUser;
    for (let index = messages.length - 1; index >= 0 && remaining > 0; index--) {
      const message = messages[index]!;
      if (message.role !== "user") continue;
      if (!options.includeSystem && isSystemInjected(message)) continue;
      add(index, "recent-user");
      remaining--;
    }
  }

  return [...sections.values()].sort((a, b) => a.index - b.index);
}

function renderDigest(sections: Section[], messages: TranscriptMessage[], options: Options): void {
  const filters = [
    options.lastUser > 0 ? `last-user=${options.lastUser}` : null,
    options.match ? `match=/${options.match.source}/i roles=${[...options.matchRoles].join(",")}` : null,
    options.explicit ? `msg=${options.explicit}` : null,
  ].filter(Boolean).join(" ");

  const header = [
    "# Orchestrator context digest",
    `Source: ${options.path} (${messages.length} messages)`,
    `Filters: ${filters || "(none)"} · budget ${options.maxChars} chars`,
    "Authority: user messages are verbatim orchestrator-side user words; assistant messages are paraphrase.",
    "",
  ].join("\n");

  // Enforce the budget by dropping oldest sections first: recent context wins.
  const kept: Section[] = [];
  let used = header.length;
  let dropped = 0;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i]!;
    const cost = section.text.length + 64;
    if (used + cost > options.maxChars && kept.length > 0) { dropped = i + 1; break; }
    used += cost;
    kept.unshift(section);
  }

  const parts = [header];
  if (dropped > 0) {
    const range = sections.slice(0, dropped).map((section) => `msg#${section.index}`);
    parts.push(`(budget: dropped ${dropped} older section(s): ${range.join(", ")} — re-run with --msg to fetch them individually)\n`);
  }
  for (const section of kept) {
    parts.push(`## msg#${section.index} [${section.role}] (${[...section.reasons].join("+")})`);
    parts.push(section.text.trim());
    parts.push("");
  }
  if (kept.length === 0) parts.push("(no messages matched the filters)");
  console.log(parts.join("\n"));
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  options.path = resolveTranscriptPath(options.path);
  const messages = loadMessages(options.path);
  if (options.index) {
    printIndex(messages, options);
    return;
  }
  renderDigest(collectSections(messages, options), messages, options);
}

if (import.meta.main) main();
