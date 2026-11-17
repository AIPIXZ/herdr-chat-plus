import { layout, panes, run, shared, setShared, exec } from "herdr";
import { herdr } from "./backstage.js";
import { localId, qualifyAddress } from "./identity.js";

export function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

// Only personal layout files change. The shared tab/split document is never written.
export function viewLayout(tree, target, extra = {}) {
  const updated = JSON.parse(JSON.stringify(tree));
  const stack = findNode(updated, "conversation-view");
  const template = findNode(updated, "conversation-page");
  if (!stack || !template) throw new Error("Select the updated Chat layout first");
  const matches = (meta) => meta?.owner_tab === localId(target.tab)
    && meta?.owner_pane === localId(target.pane) && meta?.terminal === localId(target.terminal);
  const live = typeof panes === "function" ? panes() : null;
  if (Array.isArray(live) && live.length > 0) {
    const livePanes = new Set(live.map((p) => localId(p?.pane ?? p?.id)).filter(Boolean));
    const livePairs = new Set(live.map((p) => `${localId(p?.pane ?? p?.id)}::${localId(p?.terminal)}`));
    const hasTermField = live.some((p) => p?.terminal);
    stack.children = stack.children.filter((child) => {
      if (child.id === "main" || child.id === "conversation-page") return true;
      const meta = pageMeta(child);
      if (!meta || matches(meta)) return true;
      const op = localId(meta.owner_pane);
      const ot = localId(meta.terminal);
      if (op && !livePanes.has(op)) return false;
      if (op && ot && hasTermField && !livePairs.has(`${op}::${ot}`)) return false;
      return true;
    });
  }
  let page = stack.children.find((child) => matches(pageMeta(child)));
  if (!page) {
    page = JSON.parse(JSON.stringify(template));
    const key = `${localId(target.tab)}-${localId(target.pane)}-${localId(target.terminal)}`;
    const rename = (node) => {
      node.id += `-${key}`;
      for (const child of node.children ?? []) rename(child);
    };
    rename(page);
    const props = { ...extra, presentation: true, terminal: localId(target.terminal),
      owner_tab: localId(target.tab), owner_pane: localId(target.pane) };
    page.children.find((child) => child.content?.mod === "chat").content.props = props;
    page.children.find((child) => child.content?.mod === "chat-pane").content.props = props;
    stack.children.push(page);
  }
  // Chat is a single full-size presentation of the same pane. Use its
  // ordinary frame, never the split-pane focus highlight.
  const frame = findNode(updated, "main")?.content?.pane;
  page.background = frame?.background && frame.background !== "background"
    ? frame.background
    : (template.background ?? "#00000000");
  page.border = { ...(frame?.border ?? { width: 1, color: "border" }) };
  page.radius = frame?.radius ?? 10;
  stack.active = page.id;
  return updated;
}

export function presentationPane(meta, all) {
  if (!meta.owner_tab || !meta.owner_pane || !meta.terminal) return null;
  const matches = all.filter((p) => p.terminal && localId(p.tab) === localId(meta.owner_tab)
    && localId(p.pane) === localId(meta.owner_pane)
    && p.terminal === qualifyAddress(meta.terminal, p.tab));
  return matches.length === 1 ? matches[0] : null;
}

// Read the source geometry; never write the shared tab document to toggle a view.
export const TAB_ROOT_PY = `
import json, os, shutil, subprocess, sys
params = {"name": "herdr-app"}
if sys.argv[2]: params["on"] = sys.argv[2]
request = {"jsonrpc": "2.0", "id": 1, "method": "doc.get", "params": params}
r = subprocess.run([shutil.which("hc") or os.path.expanduser("~/.local/bin/hc"), "connect"], input=json.dumps(request)+"\\n", capture_output=True, text=True, timeout=15)
for line in r.stdout.splitlines():
    reply = json.loads(line)
    if reply.get("id") != 1: continue
    if "error" in reply: raise RuntimeError(reply["error"].get("message", "Could not read tab layout"))
    for space in (reply.get("result", {}).get("value") or {}).get("spaces", []):
        for tab in space.get("tabs", []):
            if tab.get("id") == sys.argv[1]:
                print(json.dumps(tab["root"])); sys.exit(0)
raise RuntimeError("The tab layout is no longer available")
`;

async function tabRoot(target) {
  const machine = target.tab.includes("/") ? target.tab.slice(0, target.tab.lastIndexOf("/")) : "";
  const r = await exec("python3", ["-c", TAB_ROOT_PY, localId(target.tab), machine]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not read tab layout");
  return JSON.parse(r.stdout);
}

const paneViewId = (meta) => `conversation-pane-${localId(meta.owner_tab)}-${localId(meta.owner_pane)}-${localId(meta.terminal)}`;
const sameOwner = (a, b) => a?.owner_tab === b?.owner_tab && a?.owner_pane === b?.owner_pane
  && localId(a?.terminal) === localId(b?.terminal);

export function commandTargets(owner) {
  return !owner?.pane_mode || sameOwner(shared("chat.commandTarget"), owner);
}

export function targetCommands(target) {
  setShared("chat.commandTarget", { owner_tab: localId(target.tab), owner_pane: localId(target.pane), terminal: localId(target.terminal) });
}

// Mirror the actual row/column tree, including weights and non-agent siblings.
// Only the clicked leaf changes mode; the terminals themselves stay in place.
export function splitViewLayout(tree, target, root, mode = "chat", extra = {}) {
  const updated = JSON.parse(JSON.stringify(tree));
  const stack = findNode(updated, "conversation-view");
  const template = findNode(updated, "conversation-page");
  if (!stack || !template) throw new Error("Select the updated Chat layout first");
  const frame = findNode(updated, "main")?.content?.pane ?? {};
  const pageId = `conversation-split-${localId(target.tab)}`;
  const previous = findNode(updated, pageId);
  const peers = panes().filter(p => p.tab === target.tab).map(p => `${localId(p.pane)}:${localId(p.terminal)}`).sort();
  const sourcePeers = (node) => node.children?.length ? node.children.flatMap(sourcePeers) : [`${localId(node.id)}:${localId(node.content?.terminal)}`];
  if (JSON.stringify(sourcePeers(root).sort()) !== JSON.stringify(peers))
    throw new Error("The tab split changed; try switching again");
  let matched = false;
  const build = (node) => {
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = `${pageId}-${node.id}`;
    if (node.children?.length) {
      copy.size = findNode(previous, copy.id)?.size ?? copy.size;
      copy.children = node.children.map(build);
      copy.gap ??= frame.gap ?? 8;
      return copy;
    }
    const terminal = node.content?.terminal;
    if (!terminal) return copy;
    const meta = { presentation: true, pane_mode: true, terminal: localId(terminal),
      owner_tab: localId(target.tab), owner_pane: localId(node.id), pane_peers: peers };
    const id = paneViewId(meta);
    const selected = localId(node.id) === localId(target.pane) && localId(terminal) === localId(target.terminal);
    if (selected) matched = true;
    const before = findNode(previous, id);
    const chat = selected ? mode === "chat" : before?.active === `${id}-chat`;
    const chatProps = findNode(before, `${id}-chat`)?.content?.props ?? { ...(selected ? extra : {}), ...meta };
    return { ...Object.fromEntries(["size", "min", "max", "hidden"].filter(key => node[key] !== undefined).map(key => [key, node[key]])),
      id: `${id}-frame`, type: "column",
      size: findNode(previous, `${id}-frame`)?.size ?? node.size,
      background: frame.background ?? "background", border: frame.border ?? { width: 1, color: "border" }, radius: frame.radius ?? 10,
      children: [
        { id: `${id}-header`, type: "block", size: { px: frame.header?.height ?? 44 }, content: { mod: "chat-pane", props: meta } },
        { id, type: "stack", active: `${id}-${chat ? "chat" : "tui"}`, children: [
          { id: `${id}-tui`, type: "block", content: { ...node.content, terminal: qualifyAddress(terminal, target.tab) } },
          { id: `${id}-chat`, type: "block", content: { mod: "chat", props: chatProps } },
        ] },
      ] };
  };
  const page = build(root);
  if (!matched) throw new Error("The terminal pane moved; try switching again");
  page.id = pageId;
  const index = stack.children.findIndex(child => child.id === pageId);
  if (index < 0) stack.children.push(page); else stack.children[index] = page;
  stack.active = pageId;
  return updated;
}

export async function openChat(target, extra = {}) {
  // Reject stale or mismatched targets before changing any local UI.
  if (!panes().some((p) => p.pane === target.pane && p.tab === target.tab && p.terminal === target.terminal))
    throw new Error("This terminal pane is no longer available");
  if (panes().filter(p => p.tab === target.tab).length > 1) {
    const root = await tabRoot(target);
    if (!panes().some(p => p.pane === target.pane && p.tab === target.tab && p.terminal === target.terminal))
      throw new Error("This terminal pane is no longer available");
    targetCommands(target);
    await herdr("layout.set", { layout: splitViewLayout(layout(), target, root, "chat", extra) });
    await herdr("chat.focus", {});
    return { pane: target.pane };
  }
  const current = layout();
  const next = viewLayout(current, target, extra);
  const page = activePage(next);
  const previous = findNode(current, page.id);
  const sameFrame = previous && ["background", "border", "radius"].every(key =>
    JSON.stringify(previous[key]) === JSON.stringify(page[key]));
  if (sameFrame)
    await herdr("layout.select", { stack: "conversation-view", child: page.id });
  else
    await herdr("layout.set", { layout: next });
  await herdr("chat.focus", {});
  return { pane: target.pane };
}

export async function showTerminal(target) {
  const page = activePage(layout());
  if (target && page?.id === `conversation-split-${localId(target.tab)}`) {
    const root = await tabRoot(target);
    const next = splitViewLayout(layout(), target, root, "terminal");
    if (visibleChats(activePage(next)).some(meta => meta?.presentation)) {
      await herdr("layout.set", { layout: next });
      await herdr("pane.focus", { terminal: target.terminal });
      return;
    }
    // Persist the last pane's TUI choice before restoring the native tab tree.
    findNode(next, "conversation-view").active = "main";
    await herdr("layout.set", { layout: next });
    await herdr("pane.focus", { pane: target.pane });
    return;
  }
  await herdr("layout.select", { stack: "conversation-view", child: "main" });
  if (target && panes().some((p) => p.pane === target.pane && p.tab === target.tab && p.terminal === target.terminal))
    await herdr("pane.focus", { pane: target.pane });
}

export function pageMeta(page) {
  if (page?.content?.mod === "chat") return page.content.props;
  for (const child of page?.children ?? []) {
    const meta = pageMeta(child);
    if (meta) return meta;
  }
  return null;
}

function visibleChats(node) {
  if (node?.content?.mod === "chat") return [node.content.props];
  const children = node?.type === "stack" ? (node.children ?? []).filter(child => child.id === node.active) : node?.children ?? [];
  return children.flatMap(visibleChats);
}

export function activePage(tree) {
  const stack = findNode(tree, "conversation-view");
  return stack?.children?.find((child) => child.id === stack.active);
}

export function presentationVisible(tree = layout(), owner = null) {
  return shared("layout") === "chat" && visibleChats(activePage(tree)).some(meta => meta?.presentation && (!owner || sameOwner(meta, owner)));
}

export function presentationLayoutReady(tree) {
  return Boolean(findNode(tree, "conversation-view") && findNode(tree, "conversation-chat") && findNode(tree, "conversation-header"));
}
