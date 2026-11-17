// Finds the session log an agent terminal is writing, and reads it as it grows.
import { agentExec as exec } from "./paths.js";

// Start this far from the end of a long log; earlier history is skipped.
const TAIL_BYTES = 4 * 1024 * 1024;
const TAIL_CHUNK_BYTES = 4 * 1024 * 1024;

const sh = (script, args, on) => exec("sh", ["-c", script, "sh", ...args], { on });

export const machineOf = (address) => (address?.includes("/") ? address.split("/")[0] : null);

export function agentKind(term) {
  const argv0 = term?.argv?.[0]?.split("/").pop() ?? "";
  const what = `${term?.report?.app ?? ""} ${term?.foreground?.name ?? ""} ${term?.program?.key ?? ""} ${argv0}`.toLowerCase();
  return what.includes("claude") ? "claude" : what.includes("codex") ? "codex" : null;
}

// Some Claude versions keep PID discovery in the default registry even when
// transcripts use CLAUDE_CONFIG_DIR. Only the configured projects root is read.
export const CLAUDE_PY = `
import json, os, pathlib, subprocess, sys
roots = [pathlib.Path(p) for p in json.loads(os.environ.get("HERDR_CHAT_CLAUDE_DIRS") or "[]")]
if not roots: roots = [pathlib.Path(os.environ["CLAUDE_CONFIG_DIR"])]
children = subprocess.run(["pgrep", "-P", sys.argv[1]], capture_output=True, text=True).stdout.split()
for pid in [sys.argv[1], *children]:
    hits = set()
    # Account-local registries identify ownership even if another profile has
    # a copy of the same session. The default registry is a fallback only.
    for root in roots:
        try:
            ident = json.loads((root / "sessions" / (pid + ".json")).read_text())["sessionId"]
            if not isinstance(ident, str) or not ident or any(c not in "0123456789abcdef-" for c in ident): continue
            hits.update(str(p) for p in (root / "projects").glob("*/" + ident + ".jsonl"))
        except (OSError, ValueError, KeyError): pass
    if not hits:
        try:
            ident = json.loads((pathlib.Path.home() / ".claude/sessions" / (pid + ".json")).read_text())["sessionId"]
            if isinstance(ident, str) and ident and all(c in "0123456789abcdef-" for c in ident):
                for root in roots:
                    hits.update(str(p) for p in (root / "projects").glob("*/" + ident + ".jsonl"))
        except (OSError, ValueError, KeyError): pass
    if hits:
        if len(hits) == 1: print(next(iter(hits)))
        break
`;

// An open rollout is a candidate, not proof after an in-process fork.
const CODEX = `
kids=$(pgrep -P "$1" | tr '\\n' ' ')
grand=$(for k in $kids; do pgrep -P "$k"; done | tr '\\n' ' ')
for p in "$1" $kids $grand; do
  { lsof -nP -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p'; ls -l "/proc/$p/fd" 2>/dev/null | sed 's/.* -> //'; } | grep '/sessions/.*rollout-.*\\.jsonl$'
done | sort -u | { files=$(cat); [ "$(printf '%s\\n' "$files" | grep -c .)" = 1 ] && printf '%s\\n' "$files"; }`;

export async function locate(term, kind) {
  const pid = term?.foreground?.pid;
  if (!pid) return null;
  const on = machineOf(term.address);
  const r = kind === "codex"
    ? await sh(CODEX, [String(pid), term.foreground.cwd ?? ""], on)
    : await exec("python3", ["-c", CLAUDE_PY, String(pid)], { on });
  return r.stdout.trim().split("\n")[0] || null;
}

// Track raw byte offsets in Python before UTF-8 decoding so splitting a
// multi-byte character at the tail boundary never shifts future offsets, and
// cap each read well below Herdr's 8 MiB exec stdout limit.
export const TAIL_PY = `
import os, sys
path, off, budget, skip, cap = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4] == "1", int(sys.argv[5])
size = os.path.getsize(path)
trunc = False
if off < 0:
    off = max(0, size - budget)
    skip = off > 0
    trunc = skip
elif off > size:
    off = 0
    skip = False
end = min(size, off + cap)
with open(path, "rb") as f:
    f.seek(off)
    data = f.read(max(0, end - off))
    while end < size and b"\\n" not in data and len(data) < 6 * 1024 * 1024:
        extra = f.read(min(1024 * 1024, size - end))
        if not extra: break
        data += extra
        end += len(extra)
cut = data.rfind(b"\\n")
if cut < 0:
    sys.stdout.write(f"{off} {int(trunc)} {int(skip)} {size}\\n")
    sys.exit(0)
chunk = data[:cut + 1]
off += cut + 1
if skip:
    chunk = chunk.split(b"\\n", 1)[1]
    skip = False
sys.stdout.write(f"{off} {int(trunc)} {int(skip)} {size}\\n")
sys.stdout.write(chunk.decode("utf-8", errors="replace"))
`;

// Reads complete new lines from `file` since the last call.
export class Tail {
  constructor(file, on, bytes = TAIL_BYTES) {
    this.bytes = bytes;
    this.file = file;
    this.on = on;
    this.offset = null;
    this.skipFirst = false;
    this.truncated = false;
  }

  async read() {
    const out = [];
    let targetSize = null;
    for (let guard = 0; guard < 64; guard++) {
      const first = this.offset === null;
      const r = await exec("python3", [
        "-c", TAIL_PY, this.file, String(first ? -1 : this.offset),
        String(this.bytes), this.skipFirst ? "1" : "0", String(TAIL_CHUNK_BYTES),
      ], { on: this.on });
      if (r.code !== 0) throw new Error(r.stderr.trim() || "can't read the session log");
      const nl = r.stdout.indexOf("\n");
      const [nextOff, trunc, nextSkip, fileSize] = (nl < 0 ? r.stdout : r.stdout.slice(0, nl)).trim().split(" ").map(Number);
      const prevOff = this.offset;
      this.offset = nextOff;
      if (first) this.truncated = Boolean(trunc);
      this.skipFirst = Boolean(nextSkip);
      if (targetSize === null) targetSize = fileSize;
      const body = nl < 0 ? "" : r.stdout.slice(nl + 1);
      if (body) out.push(...body.split("\n").filter(Boolean));
      if (this.offset >= targetSize || this.offset === prevOff || !body && first) break;
    }
    return out;
  }
}

// Fork candidates are offered explicitly: a sibling branch is not proof of
// which thread the running TUI currently owns.
export async function forkCandidates(file, term) {
  const script = `
import json,os,pathlib,sys
cwd=sys.argv[2]
root=pathlib.Path(os.environ.get("CODEX_HOME") or pathlib.Path.home()/".codex").expanduser()/"sessions"
found=[]
for path in root.rglob("rollout-*.jsonl"):
    try:
        with path.open() as stream: m=json.loads(stream.readline()).get("payload",{})
        if m.get("cwd")==cwd and m.get("originator")=="codex-tui":
            found.append({"file":str(path),"id":m["id"],"timestamp":m.get("timestamp","")})
    except Exception: pass
print(json.dumps(sorted(found,key=lambda x:x["timestamp"],reverse=True)))
`;
  const result = await exec("python3", ["-c", script, file ?? "", term.foreground?.cwd ?? ""], { on: machineOf(term.address), sessionFile: file });
  if (result.code !== 0) return [];
  try { return JSON.parse(result.stdout); } catch { return []; }
}
