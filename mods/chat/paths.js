// Configuration belongs to this Herdr client; paths belong to the agent's machine.
import { appHome, readTextFile, exec } from "herdr";

export function machinePaths(config, on) {
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  if (!object(config)) throw new Error("chat-paths.json must contain an object");
  if (config.local !== undefined && !object(config.local)) throw new Error("chat-paths.json: local must be an object");
  if (config.machines !== undefined && !object(config.machines)) throw new Error("chat-paths.json: machines must be an object");
  const value = on ? (Object.hasOwn(config.machines ?? {}, on) ? config.machines[on] : {}) : config.local ?? {};
  if (!object(value)) throw new Error("chat-paths.json: machine paths must be an object");
  const result = {};
  for (const key of ["claudeConfigDir", "codexHome"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string" || !value[key].trim() || /[\0\r\n]/.test(value[key]))
      throw new Error(`chat-paths.json: ${key} must be a non-empty path`);
    result[key] = value[key];
  }
  for (const key of ["claudeConfigDirs", "codexHomes"]) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].some(path =>
      typeof path !== "string" || !path.trim() || /[\0\r\n]/.test(path)))
      throw new Error(`chat-paths.json: ${key} must be an array of non-empty paths`);
    result[key] = value[key];
  }
  return result;
}

export const RESOLVE_PATHS_PY = `
import json, os, pathlib, sys
config = json.loads(sys.argv[1])
def expand(value, key):
    path = pathlib.Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError(key + " must be an absolute path or start with ~/")
    if any(c in str(path) for c in ("\\0", "\\r", "\\n")):
        raise ValueError(key + " contains a control character")
    return str(path)
def root(key, env, default):
    return expand(config.get(key) or os.environ.get(env) or str(pathlib.Path.home() / default), key)
claude = root("claudeConfigDir", "CLAUDE_CONFIG_DIR", ".claude")
codex = root("codexHome", "CODEX_HOME", ".codex")
codex_homes = list(dict.fromkeys([codex] + [expand(p, "codexHomes") for p in config.get("codexHomes", [])]))
directories = list(dict.fromkeys([claude] + [expand(p, "claudeConfigDirs") for p in config.get("claudeConfigDirs", [])]))
print(json.dumps({"home": str(pathlib.Path.home()),
                  "claudeConfigDir": claude, "claudeConfigDirs": directories,
                  "codexHome": codex, "codexHomes": codex_homes}))
`;

// Read once per machine/source version. Restart Herdr after editing chat-paths.json
// so active transcripts, cached catalogs and helper processes change together.
export function createPathResolver(readConfig, execute) {
  const pending = new Map();
  return function resolve(on = null) {
    const key = on || null;
    if (!pending.has(key)) {
      const task = (async () => {
        const text = await readConfig();
        const config = machinePaths(text == null || text === "" ? {} : JSON.parse(text), key);
        const r = await execute("python3", ["-c", RESOLVE_PATHS_PY, JSON.stringify(config)], { on: key });
        if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not resolve agent directories");
        return JSON.parse(r.stdout);
      })();
      pending.set(key, task);
      task.catch(() => { if (pending.get(key) === task) pending.delete(key); });
    }
    return pending.get(key);
  };
}

export const agentPaths = createPathResolver(
  () => readTextFile(`${appHome()}/data/chat-paths.json`), exec);

export function agentEnvironment(paths) {
  return [`CLAUDE_CONFIG_DIR=${paths.claudeConfigDir}`, `CODEX_HOME=${paths.codexHome}`,
    `HERDR_CHAT_CLAUDE_DIRS=${JSON.stringify(paths.claudeConfigDirs)}`,
    `HERDR_CHAT_CODEX_HOMES=${JSON.stringify(paths.codexHomes)}`];
}

// A bound transcript selects its account; additional discovery roots do not
// change the default account used by New Chat or unbound queries.
export function pathsForFile(paths, file) {
  const root = [...paths.claudeConfigDirs].sort((a, b) => b.length - a.length)
    .find(path => file?.startsWith(`${path.replace(/\/$/, "")}/projects/`));
  const codexRoot = [...paths.codexHomes].sort((a, b) => b.length - a.length)
    .find(path => ["sessions", "archived_sessions"].some(dir => file?.startsWith(`${path.replace(/\/$/, "")}/${dir}/`)));
  return { ...paths, ...(root ? { claudeConfigDir: root } : {}), ...(codexRoot ? { codexHome: codexRoot } : {}) };
}

// Arguments are passed literally, never interpolated into a shell command.
export async function agentExec(command, args, options = {}) {
  const { sessionFile, ...execution } = options;
  const paths = pathsForFile(await agentPaths(execution.on), sessionFile);
  return exec("env", [...agentEnvironment(paths), command, ...args], execution);
}

export async function agentLaunch(argv, kind, on) {
  const paths = await agentPaths(on);
  const entry = kind === "claude" ? `CLAUDE_CONFIG_DIR=${paths.claudeConfigDir}` : `CODEX_HOME=${paths.codexHome}`;
  return ["env", entry, ...argv];
}
