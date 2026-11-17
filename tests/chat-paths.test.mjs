import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

function load(file, names, globals = {}) {
  const source = readFileSync(new URL(`../mods/chat/${file}`, import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/export /g, "");
  return runInNewContext(`${source}\n({${names}})`, globals);
}
const env = { ...process.env, CLAUDE_CONFIG_DIR: "", CODEX_HOME: "" };
const execute = (environment) => async (command, args) => {
  const r = spawnSync(command, Array.from(args), { env: environment, encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const { createPathResolver } = load("paths.js", "createPathResolver", { exec: execute(env) });

test("path resolution uses explicit config, target environment, then defaults", async () => {
  const defaults = await createPathResolver(async () => null, execute(env))();
  assert.equal(defaults.claudeConfigDir, join(homedir(), ".claude"));
  assert.equal(defaults.codexHome, join(homedir(), ".codex"));
  const configured = await createPathResolver(async () => JSON.stringify({ local: { claudeConfigDir: "~/custom claude" } }),
    execute({ ...env, CLAUDE_CONFIG_DIR: "/ignored", CODEX_HOME: "/custom codex" }))();
  assert.equal(configured.claudeConfigDir, join(homedir(), "custom claude"));
  assert.equal(configured.codexHome, "/custom codex");
});

test("remote paths are isolated from local config and successful resolutions are shared", async () => {
  const calls = [];
  const resolve = createPathResolver(async () => JSON.stringify({
    local: { codexHome: "/local" }, machines: { mini: { claudeConfigDir: "/remote claude" } },
  }), async (command, args, options) => {
    calls.push(options.on);
    return execute({ ...env, CODEX_HOME: options.on ? "/remote codex" : "/env local" })(command, args);
  });
  const [local, remote, again, other] = await Promise.all([resolve(), resolve("mini"), resolve("mini"), resolve("other")]);
  assert.equal(local.codexHome, "/local");
  assert.equal(remote.codexHome, "/remote codex");
  assert.equal(remote.claudeConfigDir, "/remote claude");
  assert.equal(again, remote);
  assert.equal(other.codexHome, "/remote codex");
  assert.deepEqual(calls, [null, "mini", "other"]);
});

test("invalid paths and JSON fail visibly and failed resolutions can be retried", async () => {
  for (const config of ["{", "[]", '{"local":null}', '{"local":{"codexHome":42}}',
    JSON.stringify({ local: { codexHome: "bad\npath" } }), '{"local":{"codexHome":"relative"}}']) {
    await assert.rejects(createPathResolver(async () => config, execute(env))());
  }
  let config = "{";
  const resolve = createPathResolver(async () => config, execute(env));
  await assert.rejects(resolve());
  config = '{"local":{"codexHome":"/fixed"}}';
  assert.equal((await resolve()).codexHome, "/fixed");
});

test("helper processes and new launches preserve literal configured paths and remote options", async () => {
  const dir = "/tmp/chat [profile] ' $(echo nope)";
  const calls = [];
  const api = load("paths.js", "agentExec, agentLaunch", {
    appHome: () => "/app", readTextFile: async (path) => {
      assert.equal(path, "/app/data/chat-paths.json");
      return JSON.stringify({ machines: { mini: { claudeConfigDir: dir, codexHome: dir + "/codex" } } });
    },
    exec: async (command, args, options) => {
      calls.push({ command, args: Array.from(args), options });
      return execute(env)(command, args);
    },
  });
  const result = await api.agentExec("python3", ["-c", 'import os,json;print(json.dumps([os.environ["CLAUDE_CONFIG_DIR"],os.environ["CODEX_HOME"]]))'], { on: "mini", timeout: 1234 });
  assert.deepEqual(JSON.parse(result.stdout), [dir, dir + "/codex"]);
  assert.equal(calls.at(-1).options.timeout, 1234);
  assert.equal(calls.at(-1).options.on, "mini");
  assert.deepEqual(Array.from(await api.agentLaunch(["claude", "--model", "opus"], "claude", "mini")),
    ["env", `CLAUDE_CONFIG_DIR=${dir}`, "claude", "--model", "opus"]);
  assert.deepEqual(Array.from(await api.agentLaunch(["codex", "-c", "x=y"], "codex", "mini")),
    ["env", `CODEX_HOME=${dir}/codex`, "codex", "-c", "x=y"]);
});

test("Claude discovery and history read a custom root containing spaces and glob characters", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-paths-"));
  try {
    const root = join(dir, "claude [work]");
    const project = join(root, "projects", "-repo");
    mkdirSync(project, { recursive: true });
    mkdirSync(join(root, "sessions"));
    const id = "11111111-1111-1111-1111-111111111111";
    const file = join(project, id + ".jsonl");
    writeFileSync(file, JSON.stringify({ type: "user", message: { content: "Custom root conversation" } }) + "\n" + JSON.stringify({ customTitle: "Custom root conversation" }) + "\n");
    writeFileSync(join(root, "sessions", process.pid + ".json"), JSON.stringify({ sessionId: id }));
    const exec = execute({ ...env, CLAUDE_CONFIG_DIR: root });
    const { locate } = load("source.js", "locate", { exec });
    assert.equal(await locate({ foreground: { pid: process.pid, cwd: "/repo" } }, "claude"), file);
    const { listSessions } = load("sdk.js", "listSessions", { exec });
    const sessions = await listSessions("/repo");
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, id);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("model catalogs and temporary Claude model changes use custom settings directories", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-paths-"));
  try {
    const claude = join(dir, "claude [work]");
    const codex = join(dir, "codex [work]");
    mkdirSync(claude); mkdirSync(codex);
    const settings = join(claude, "settings.json");
    const original = JSON.stringify({ model: "custom-claude", effortLevel: "high" });
    writeFileSync(settings, original);
    writeFileSync(join(codex, "config.toml"), 'model = "custom-codex"\nmodel_reasoning_effort = "high"\n');
    writeFileSync(join(codex, "models_cache.json"), JSON.stringify({ models: [{ slug: "custom-codex", visibility: "list" }] }));
    const { catalog, switchModel } = load("models.js", "catalog, switchModel", {
      exec: execute({ ...env, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex }), CODEX_TITLE_CONFIG: "",
      hc: async () => { writeFileSync(settings, '{"model":"opus"}'); return { code: 0 }; },
    });
    assert.equal((await catalog("claude")).model, "custom-claude");
    assert.equal((await catalog("codex")).model, "custom-codex");
    await switchModel("fake-terminal", "claude", "opus", null, null, async () => {});
    assert.equal(readFileSync(settings, "utf8"), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Codex matching, fork candidates and archived history follow the configured root", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-paths-"));
  try {
    const root = join(dir, "codex [work]");
    mkdirSync(join(root, "sessions"), { recursive: true });
    mkdirSync(join(root, "archived_sessions"));
    const parent = "11111111-1111-1111-1111-111111111111";
    const child = "22222222-2222-2222-2222-222222222222";
    const meta = (id, extra = {}) => JSON.stringify({ type: "session_meta", payload: { id, cwd: "/repo", originator: "codex-tui", ...extra } }) + "\n";
    const message = (text) => JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: text } }) + "\n";
    const prefix = meta(parent) + message("parent message");
    writeFileSync(join(root, "archived_sessions", `rollout-${parent}.jsonl`), prefix);
    const file = join(root, "sessions", `rollout-${child}.jsonl`);
    writeFileSync(file, meta(child, { history_base: { thread_id: parent, end_byte_offset: Buffer.byteLength(prefix) } }) + message("child message"));
    const exec = execute({ ...env, CODEX_HOME: root });
    const { HISTORY_PY, inheritedHistory } = load("history.js", "HISTORY_PY, inheritedHistory", { exec });
    const history = await inheritedHistory(file, null);
    assert.deepEqual(Array.from(history.lines, (line) => JSON.parse(line).payload.message), ["parent message", "child message"]);
    const { resolveSession } = load("session.js", "resolveSession", { exec, HISTORY_PY, machineOf: () => null, codexTitleIdentity: () => ({ prefix: child, complete: true }) });
    const old = join(dir, "old.jsonl");
    writeFileSync(old, meta(child));
    const result = await resolveSession({ foreground: { cwd: "/repo" } }, "", null, old);
    assert.equal(result.file, file);
    assert.equal(result.invalidPrevious, true);
    const { forkCandidates } = load("source.js", "forkCandidates", { exec });
    assert.deepEqual(Array.from(await forkCandidates(file, { foreground: { cwd: "/repo" } }), (x) => x.file), [file]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
