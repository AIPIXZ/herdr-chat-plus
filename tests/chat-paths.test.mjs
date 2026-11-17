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

test("multiple Claude accounts discover the owning log and keep helpers and history in that account", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-accounts-"));
  try {
    const roots = [join(dir, "account one/config"), join(dir, "account two/config")];
    const id = "11111111-1111-1111-1111-111111111111";
    const files = roots.map(root => join(root, "projects/-repo", id + ".jsonl"));
    for (let i = 0; i < roots.length; i++) {
      mkdirSync(join(roots[i], "projects/-repo"), { recursive: true });
      mkdirSync(join(roots[i], "sessions"));
      writeFileSync(files[i], JSON.stringify({ customTitle: `account ${i}` }) + "\n");
      writeFileSync(join(roots[i], "settings.json"), JSON.stringify({ model: `account-${i}-model` }));
    }
    const api = load("paths.js", "agentPaths, agentExec, pathsForFile, agentLaunch", {
      appHome: () => dir, readTextFile: async () => JSON.stringify({ local: { claudeConfigDirs: roots } }), exec: execute(env),
    });
    const paths = await api.agentPaths();
    assert.equal(paths.claudeConfigDir, join(homedir(), ".claude"));
    assert.equal(paths.codexHome, join(homedir(), ".codex"));
    assert.equal(api.pathsForFile(paths, files[1]).claudeConfigDir, roots[1]);
    assert.equal(api.pathsForFile(paths, roots[1] + "-other/projects/log").claudeConfigDir, paths.claudeConfigDir);
    // A copied transcript alone must not choose the wrong account.
    const registry = roots.map(root => join(root, "sessions", process.pid + ".json"));
    writeFileSync(registry[1], JSON.stringify({ sessionId: id }));
    const { locate } = load("source.js", "locate", { exec: api.agentExec });
    assert.equal(await locate({ foreground: { pid: process.pid } }, "claude"), files[1]);
    const { catalog } = load("models.js", "catalog", { exec: api.agentExec });
    assert.equal((await catalog("claude", null, files[1])).model, "account-1-model");
    const { listSessions, control } = load("sdk.js", "listSessions, control", {
      exec: async (command, args, options) => {
        if (args[1].includes("stop_proc")) {
          const r = await api.agentExec("python3", ["-c", 'import json,os;print(json.dumps({"out":[os.environ["CLAUDE_CONFIG_DIR"]]}))'], options);
          return r;
        }
        return api.agentExec(command, args, options);
      },
    });
    assert.equal((await listSessions("/repo", null, files[1]))[0].title, "account 1");
    assert.equal((await control("/repo", null, [{}], { sessionFile: files[1] }))[0], roots[1]);
    writeFileSync(registry[0], JSON.stringify({ sessionId: id }));
    assert.equal(await locate({ foreground: { pid: process.pid } }, "claude"), null);
    assert.equal((await api.agentLaunch(["claude"], "claude"))[1], `CLAUDE_CONFIG_DIR=${paths.claudeConfigDir}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("additional Claude directories validate, deduplicate and expand without overriding defaults", async () => {
  const resolve = createPathResolver(async () => JSON.stringify({ local: {
    claudeConfigDir: "~/primary", claudeConfigDirs: ["~/primary", "~/second", "~/second"],
  } }), execute(env));
  assert.deepEqual(Array.from((await resolve()).claudeConfigDirs), [join(homedir(), "primary"), join(homedir(), "second")]);
  for (const value of ["/single", [""], [3], ["relative"], ["/bad\npath"]]) {
    await assert.rejects(createPathResolver(async () => JSON.stringify({ local: { claudeConfigDirs: value } }), execute(env))());
  }
});

test("Codex accounts match independently and keep inherited history, catalogs and helpers in the owning home", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-codex-accounts-"));
  try {
    const roots = [join(dir, "account one"), join(dir, "account two [work]")];
    const parent = "11111111-1111-1111-1111-111111111111";
    const ids = ["22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"];
    const files = roots.map((root, i) => join(root, "sessions", `rollout-${ids[i]}.jsonl`));
    const meta = (id, extra = {}) => JSON.stringify({ type: "session_meta", payload: { id, cwd: "/repo", originator: "codex-tui", ...extra } }) + "\n";
    const message = text => JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: text } }) + "\n";
    const anchors = ["The first account has a completely different inherited request", "The second account has this unique inherited conversation request"];
    for (let i = 0; i < roots.length; i++) {
      mkdirSync(join(roots[i], "sessions"), { recursive: true });
      mkdirSync(join(roots[i], "archived_sessions"));
      mkdirSync(join(roots[i], "prompts"));
      const prefix = meta(parent) + message(anchors[i]);
      writeFileSync(join(roots[i], "archived_sessions", `rollout-${parent}.jsonl`), prefix);
      writeFileSync(files[i], meta(ids[i], { history_base: { thread_id: parent, end_byte_offset: Buffer.byteLength(prefix) } }) + message(`Another distinctive child request in account ${i}`));
      writeFileSync(join(roots[i], "config.toml"), `model = "account-${i}-model"\n`);
      writeFileSync(join(roots[i], "prompts", `profile-${i}.md`), "Profile-specific custom prompt");
    }
    const api = load("paths.js", "agentPaths, agentExec, pathsForFile, agentLaunch", {
      appHome: () => dir, exec: execute(env), readTextFile: async () => JSON.stringify({ local: { codexHome: roots[0], codexHomes: roots } }),
    });
    const paths = await api.agentPaths();
    assert.deepEqual(Array.from(paths.codexHomes), roots);
    assert.equal(api.pathsForFile(paths, files[1]).codexHome, roots[1]);
    assert.equal(api.pathsForFile(paths, join(roots[1], "archived_sessions", "log")).codexHome, roots[1]);
    assert.equal(api.pathsForFile(paths, roots[1] + "-other/sessions/log").codexHome, roots[0]);
    assert.equal((await api.agentLaunch(["codex"], "codex"))[1], `CODEX_HOME=${roots[0]}`);
    const { HISTORY_PY, inheritedHistory } = load("history.js", "HISTORY_PY, inheritedHistory", { exec: api.agentExec });
    const history = await inheritedHistory(files[1], null);
    assert.equal(JSON.parse(history.lines[0]).payload.message, anchors[1]);
    const { resolveSession } = load("session.js", "resolveSession", {
      exec: api.agentExec, HISTORY_PY, machineOf: () => null, codexTitleIdentity: term => term.identity,
    });
    const term = { foreground: { cwd: "/repo" }, identity: { prefix: ids[1], complete: true } };
    const matched = await resolveSession(term, "", files[0], files[1]);
    assert.equal(matched.file, files[1]);
    assert.equal(matched.invalidPrevious, false);
    assert.equal((await resolveSession({ ...term, identity: null }, `Model: gpt-5\nSession: ${ids[1]}\nContext window: 30%`)).file, files[1]);
    assert.equal((await resolveSession({ ...term, identity: null }, anchors[1] + "\nAnother distinctive child request in account 1")).file, files[1]);
    const { catalog } = load("models.js", "catalog", { exec: api.agentExec });
    assert.equal((await catalog("codex", null, files[1])).model, "account-1-model");
    const { forkCandidates } = load("source.js", "forkCandidates", { exec: api.agentExec });
    assert.deepEqual(Array.from(await forkCandidates(files[1], term), x => x.file), [files[1]]);
    const { loadCommands } = load("commands.js", "loadCommands", { exec: api.agentExec, codexCalls: async () => [null] });
    const commands = await loadCommands("codex", "/repo", null, files[1]);
    assert.ok(commands.list.some(x => x.name.includes("profile-1")));
    assert.ok(!commands.list.some(x => x.name.includes("profile-0")));
    const { codexCalls, askCodexSide } = load("sdk.js", "codexCalls, askCodexSide", {
      exec: async (_command, args, options) => api.agentExec("python3", ["-c",
        'import json,os;print(json.dumps({"out":[os.environ["CODEX_HOME"]],"text":os.environ["CODEX_HOME"]}))'], options),
    });
    assert.equal((await codexCalls("/repo", [["config/read", {}]], null, files[1]))[0], roots[1]);
    assert.equal((await askCodexSide("/repo", files[1], "question", [], null)).text, roots[1]);
    // A missing parent in this account must never be borrowed from the other.
    rmSync(join(roots[1], "archived_sessions", `rollout-${parent}.jsonl`));
    await assert.rejects(inheritedHistory(files[1], null), /missing or ambiguous/);
    writeFileSync(join(roots[0], "sessions", `rollout-copy-${ids[1]}.jsonl`), readFileSync(files[1]));
    assert.equal((await resolveSession(term, "", files[1], files[1])).file, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("additional Codex homes validate and remain isolated by machine", async () => {
  const resolve = createPathResolver(async () => JSON.stringify({
    local: { codexHomes: ["~/secondary", "~/secondary"] }, machines: { mini: { codexHomes: ["/remote/profile"] } },
  }), execute(env));
  assert.deepEqual(Array.from((await resolve()).codexHomes), [join(homedir(), ".codex"), join(homedir(), "secondary")]);
  assert.deepEqual(Array.from((await resolve("mini")).codexHomes), [join(homedir(), ".codex"), "/remote/profile"]);
  for (const value of ["/single", [""], [3], ["relative"], ["/bad\npath"]]) {
    await assert.rejects(createPathResolver(async () => JSON.stringify({ local: { codexHomes: value } }), execute(env))());
  }
});
