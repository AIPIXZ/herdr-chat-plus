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
  return result;
}

export const RESOLVE_PATHS_PY = `
import json, os, pathlib, sys
config = json.loads(sys.argv[1])
def root(key, env, default):
    value = config.get(key) or os.environ.get(env) or str(pathlib.Path.home() / default)
    path = pathlib.Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError(key + " must be an absolute path or start with ~/")
    if any(c in str(path) for c in ("\\0", "\\r", "\\n")):
        raise ValueError(key + " contains a control character")
    return str(path)
print(json.dumps({"home": str(pathlib.Path.home()),
                  "claudeConfigDir": root("claudeConfigDir", "CLAUDE_CONFIG_DIR", ".claude"),
                  "codexHome": root("codexHome", "CODEX_HOME", ".codex")}))
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
  return [`CLAUDE_CONFIG_DIR=${paths.claudeConfigDir}`, `CODEX_HOME=${paths.codexHome}`];
}

// Arguments are passed literally, never interpolated into a shell command.
export async function agentExec(command, args, options = {}) {
  const paths = await agentPaths(options.on);
  return exec("env", [...agentEnvironment(paths), command, ...args], options);
}

export async function agentLaunch(argv, kind, on) {
  const paths = await agentPaths(on);
  const entry = kind === "claude" ? `CLAUDE_CONFIG_DIR=${paths.claudeConfigDir}` : `CODEX_HOME=${paths.codexHome}`;
  return ["env", entry, ...argv];
}
