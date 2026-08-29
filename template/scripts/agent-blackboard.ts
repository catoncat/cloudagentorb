// Shared blackboard for concurrent Cursor cloud agents (zero-dep, run with bun).
//
// Every cloud agent of the same Cursor user boots with the SAME user store
// mounted at /cursor/stores/user (FUSE; cross-agent propagation ~10-30s;
// `flock` works there). /workspace and /cursor/stores/self are per-pod /
// per-conversation and are NOT shared. This script maintains the shared layout
// under <root> = $BLACKBOARD_ROOT or /cursor/stores/user/shared-state:
//
//   roster.json          who is alive (multi-writer -> every rewrite under flock)
//   tasks/<bcId>.json    one file per task, written ONLY by that task (no lock needed)
//   bus/events.jsonl     append-only facts, one JSON object per line
//
// Usage:
//   bun scripts/agent-blackboard.ts whoami
//   bun scripts/agent-blackboard.ts register --role worker --goal "..." [--parent bc-...] [--note "..."]
//   bun scripts/agent-blackboard.ts set status=working branch=cursor/x pr=https://...
//   bun scripts/agent-blackboard.ts post "one-line progress fact"        (or a JSON object)
//   bun scripts/agent-blackboard.ts read [--events 20]
//   bun scripts/agent-blackboard.ts wait --match <regex> [--timeout 600] [--interval 5]
//
// Identity is auto-detected from the pod metadata socket (/run/cursor/api.sock);
// override with --bc bc-... if needed.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_ROOT = "/cursor/stores/user/shared-state";
const IMDS_SOCKET = "/run/cursor/api.sock";

function fail(message: string): never {
  console.error(`agent-blackboard: ${message}`);
  process.exit(1);
}

function root(): string {
  const r = process.env["BLACKBOARD_ROOT"] ?? DEFAULT_ROOT;
  if (r === DEFAULT_ROOT && !existsSync("/cursor/stores/user")) {
    fail("/cursor/stores/user is not mounted on this pod; no shared blackboard here. Fall back to git branches + PR comments for coordination.");
  }
  return r;
}

const rosterPath = (): string => join(root(), "roster.json");
const tasksDir = (): string => join(root(), "tasks");
const busPath = (): string => join(root(), "bus", "events.jsonl");

function imds(key: string): string {
  const proc = Bun.spawnSync(["curl", "-s", "--max-time", "5", "--unix-socket", IMDS_SOCKET, `http://localhost/v1/meta-data/${key}`]);
  if (proc.exitCode !== 0) fail(`cannot read pod metadata '${key}' from ${IMDS_SOCKET}; pass --bc bc-... explicitly`);
  return proc.stdout.toString().trim();
}

interface Identity {
  bcId: string;
  name: string;
  source: string;
}

function detectIdentity(bcOverride: string | null): Identity {
  if (bcOverride) return { bcId: bcOverride, name: "", source: "" };
  const bcId = imds("agent/id");
  if (!bcId.startsWith("bc-")) fail(`unexpected agent id '${bcId}' from pod metadata; pass --bc bc-... explicitly`);
  return { bcId, name: imds("agent/name"), source: imds("agent/source") };
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (raw === "") return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail(`${path}: expected a JSON object`);
  return { ...parsed };
}

// Multi-writer roster.json: every read-modify-write happens inside `flock`
// (re-exec this script under the lock so concurrent agents cannot interleave).
function mergeRosterEntry(bcId: string, entry: Record<string, unknown>): void {
  mkdirSync(root(), { recursive: true });
  const patch = JSON.stringify({ bcId, entry });
  const proc = Bun.spawnSync(
    ["flock", "-w", "30", rosterPath(), "bun", import.meta.path, "__roster-merge", patch],
    { stdout: "inherit", stderr: "inherit", env: { ...process.env } },
  );
  if (proc.exitCode !== 0) fail("roster update failed (flock timeout or merge error)");
}

function rosterMergeLocked(patchRaw: string): void {
  const parsed: unknown = JSON.parse(patchRaw);
  if (typeof parsed !== "object" || parsed === null) fail("__roster-merge: bad patch");
  const { bcId, entry } = { bcId: null as unknown, entry: null as unknown, ...parsed };
  if (typeof bcId !== "string" || typeof entry !== "object" || entry === null) fail("__roster-merge: bad patch shape");
  const roster = readJsonObject(rosterPath());
  const agentsRaw = roster["agents"];
  const agents = typeof agentsRaw === "object" && agentsRaw !== null && !Array.isArray(agentsRaw) ? { ...agentsRaw } : {};
  const existingRaw: unknown = Reflect.get(agents, bcId);
  const existing = typeof existingRaw === "object" && existingRaw !== null ? { ...existingRaw } : {};
  Reflect.set(agents, bcId, { ...existing, ...entry });
  writeFileSync(rosterPath(), `${JSON.stringify({ ...roster, path: root(), updatedAt: nowIso(), agents }, null, 2)}\n`);
}

function writeOwnTask(bcId: string, patch: Record<string, unknown>): Record<string, unknown> {
  mkdirSync(tasksDir(), { recursive: true });
  const path = join(tasksDir(), `${bcId}.json`);
  const merged = { bcId, ...readJsonObject(path), ...patch, lastUpdate: nowIso() };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

function postEvent(bcId: string, body: string): void {
  mkdirSync(join(root(), "bus"), { recursive: true });
  let payload: Record<string, unknown> = { note: body };
  if (body.trimStart().startsWith("{")) {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = { ...parsed };
  }
  appendFileSync(busPath(), `${JSON.stringify({ ts: nowIso(), from: bcId, ...payload })}\n`);
}

function takeFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  const value = args[i + 1];
  if (value === undefined) fail(`${flag} needs a value`);
  args.splice(i, 2);
  return value;
}

function cmdRegister(identity: Identity, args: string[]): void {
  const role = takeFlag(args, "--role") ?? "worker";
  const goal = takeFlag(args, "--goal") ?? "";
  const parent = takeFlag(args, "--parent");
  const note = takeFlag(args, "--note") ?? "";
  mergeRosterEntry(identity.bcId, {
    role,
    name: identity.name,
    source: identity.source,
    status: "RUNNING",
    ...(parent ? { parent } : {}),
    lastUpdate: nowIso(),
    ...(note ? { note } : {}),
  });
  writeOwnTask(identity.bcId, { role, goal, status: "RUNNING", ...(parent ? { parent } : {}) });
  postEvent(identity.bcId, JSON.stringify({ type: "register", role, goal }));
  console.log(`registered ${identity.bcId} (${role}) at ${root()}`);
}

function cmdSet(identity: Identity, args: string[]): void {
  const patch: Record<string, unknown> = {};
  for (const pair of args) {
    const eq = pair.indexOf("=");
    if (eq <= 0) fail(`set expects key=value pairs, got '${pair}'`);
    patch[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  if (Object.keys(patch).length === 0) fail("set: nothing to set");
  const merged = writeOwnTask(identity.bcId, patch);
  const statusValue = merged["status"];
  mergeRosterEntry(identity.bcId, { lastUpdate: nowIso(), ...(typeof statusValue === "string" ? { status: statusValue } : {}) });
  console.log(JSON.stringify(merged, null, 2));
}

function cmdRead(args: string[]): void {
  const eventCount = Number(takeFlag(args, "--events") ?? "20");
  console.log(`# blackboard @ ${root()}\n\n## roster.json`);
  console.log(existsSync(rosterPath()) ? readFileSync(rosterPath(), "utf8").trim() : "(missing)");
  console.log("\n## tasks/");
  const dir = tasksDir();
  for (const file of existsSync(dir) ? readdirSync(dir).sort() : []) {
    console.log(`\n### ${file}`);
    console.log(readFileSync(join(dir, file), "utf8").trim());
  }
  console.log(`\n## bus/events.jsonl (last ${eventCount})`);
  const lines = existsSync(busPath()) ? readFileSync(busPath(), "utf8").trim().split("\n") : [];
  for (const line of lines.slice(-eventCount)) console.log(line);
}

async function cmdWait(args: string[]): Promise<void> {
  const matchRaw = takeFlag(args, "--match");
  if (!matchRaw) fail("wait requires --match <regex>");
  const match = new RegExp(matchRaw, "i");
  const timeoutSec = Number(takeFlag(args, "--timeout") ?? "600");
  const intervalSec = Number(takeFlag(args, "--interval") ?? "5");
  const deadline = Date.now() + timeoutSec * 1000;
  // FUSE propagation is ~10-30s; a tight loop buys nothing.
  while (Date.now() < deadline) {
    const lines = existsSync(busPath()) ? readFileSync(busPath(), "utf8").trim().split("\n") : [];
    const hit = lines.find((line) => match.test(line));
    if (hit !== undefined) {
      console.log(hit);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
  }
  fail(`wait: no bus event matched /${matchRaw}/i within ${timeoutSec}s`);
}

function cmdInit(): void {
  mkdirSync(tasksDir(), { recursive: true });
  mkdirSync(join(root(), "bus"), { recursive: true });
  const readme = join(root(), "README.txt");
  if (!existsSync(readme)) {
    writeFileSync(readme, [
      "Shared blackboard for this Cursor user's concurrent cloud agents.",
      "Layout: roster.json (flock-guarded), tasks/<bcId>.json (single writer), bus/events.jsonl (append-only).",
      "Managed by scripts/agent-blackboard.ts. FUSE propagation across agents is ~10-30s.",
      "",
    ].join("\n"));
  }
  console.log(`initialized ${root()}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "__roster-merge") {
    const patch = args[0];
    if (patch === undefined) fail("__roster-merge needs a patch argument");
    rosterMergeLocked(patch);
    return;
  }
  const bcOverride = takeFlag(args, "--bc");
  switch (command) {
    case "whoami": {
      const identity = detectIdentity(bcOverride);
      console.log(JSON.stringify(identity, null, 2));
      return;
    }
    case "init": cmdInit(); return;
    case "register": cmdRegister(detectIdentity(bcOverride), args); return;
    case "set": cmdSet(detectIdentity(bcOverride), args); return;
    case "post": {
      const body = args.join(" ").trim();
      if (body === "") fail("post: empty event");
      postEvent(detectIdentity(bcOverride).bcId, body);
      console.log("posted");
      return;
    }
    case "read": cmdRead(args); return;
    case "wait": await cmdWait(args); return;
    default:
      fail("usage: bun scripts/agent-blackboard.ts <whoami|init|register|set|post|read|wait> [options]");
  }
}

if (import.meta.main) await main();
