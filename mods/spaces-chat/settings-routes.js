const MARKER = "/* herdr-chat-plus:machine-routes-v1 */";

const ROUTE_INPUT_INIT = `    this.routeInput = InputState.new({ placeholder: "user@host or ssh alias" });
    this.routeInput.on("focus", (_e, cx) => { this.routeFocused = true; cx.notify(); });
    this.routeInput.on("blur", (_e, cx) => { this.routeFocused = false; cx.notify(); });
    this.routeInput.on("change", (_e, cx) => { if (this.machineEdit?.action === "route") this.machineEdit.target = this.routeInput.value(); cx.notify(); });
    this.routeInput.on("submit", (_e, cx) => {
      const edit = this.machineEdit;
      if (edit?.action === "route") this.saveMachineRoute(edit.machine, edit.target, false, cx);
    });`;

const MACHINES_SECTION = `  // Machines -------------------------------------------------------------
  ${MARKER}

  machineDetachedMap() {
    const raw = shared("machine.routes.detached");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  setMachineDetached(name, info) {
    const next = { ...this.machineDetachedMap() };
    if (info) next[name] = info;
    else delete next[name];
    setShared("machine.routes.detached", next);
  }

  machineRoutes(m) {
    const all = shared("machine.routes");
    const saved = Array.isArray(all?.[m.name]) ? all[m.name].map((r) => String(r ?? "").trim()).filter(Boolean) : [];
    const current = String(m.target ?? "").trim();
    return [...new Set([...saved, ...(current ? [current] : [])])];
  }

  setMachineRoutes(name, routes) {
    const prev = shared("machine.routes");
    const next = prev && typeof prev === "object" && !Array.isArray(prev) ? { ...prev } : {};
    const clean = [...new Set((routes ?? []).map((r) => String(r ?? "").trim()).filter(Boolean))];
    if (clean.length) next[name] = clean;
    else delete next[name];
    setShared("machine.routes", next);
  }

  saveMachineRoute(machineName, rawTarget, switchNow, cx) {
    const target = String(rawTarget ?? "").trim();
    const m = (this.machineList ?? []).find((x) => x.name === machineName);
    if (!target || !m) return;
    const next = [...new Set([...this.machineRoutes(m), target])];
    this.setMachineRoutes(machineName, next);
    this.machineEdit = null;
    this.handle.focus();
    if (switchNow && (target !== m.target || m.detached)) {
      this.switchMachineRoute(m, target, cx);
      return;
    }
    this.machineResults[machineName] = { message: \`Added route \${target} for \${machineName}.\`, ok: true };
    cx.notify();
  }

  removeMachineRoute(m, route, cx) {
    if (route === m.target && !m.detached) return;
    const next = this.machineRoutes(m).filter((r) => r !== route);
    this.setMachineRoutes(m.name, next);
    cx.notify();
  }

  switchMachineRoute(m, target, cx) {
    const name = m?.name;
    const nextTarget = String(target ?? "").trim();
    if (!name || !nextTarget || this.machineBusy[name]) return;
    if (nextTarget === m.target && !m.detached) return;
    const previousTarget = String(m.target ?? "").trim();
    this.setMachineRoutes(name, [...this.machineRoutes(m), nextTarget]);
    this.machineBusy[name] = "route";
    delete this.machineResults[name];
    this.machineEdit = null;
    this.handle.focus();
    const switching = shared("machines.switching");
    setShared("machines.switching", {
      ...(switching && typeof switching === "object" && !Array.isArray(switching) ? switching : {}),
      [name]: { ...m, target: nextTarget },
    });
    cx.notify();
    cx.spawn(async (cx) => {
      const clearSwitching = () => {
        const cur = shared("machines.switching");
        if (!cur || typeof cur !== "object" || Array.isArray(cur) || !(name in cur)) return;
        const copy = { ...cur };
        delete copy[name];
        setShared("machines.switching", copy);
      };
      const buildAddArgs = (hostTarget) => {
        const args = ["machine", "add"];
        if (m.via) args.push("--via", hostTarget);
        else args.push(hostTarget);
        args.push("--name", name);
        if (m.session) args.push("--session", m.session);
        if (m.temporary) args.push("--temp");
        args.push("--json");
        return args;
      };
      const parseErr = (r, fallback) => {
        try {
          const msg = JSON.parse(r.stdout || r.stderr)?.error?.message;
          if (msg) return msg;
        } catch {}
        return (r.stderr || r.stdout || fallback).trim();
      };
      try {
        if (!m.detached) {
          const rmRes = await hc(["machine", "rm", name, "--json"]);
          if (rmRes.code !== 0) throw new Error(parseErr(rmRes, "Couldn't switch route."));
        }
        const addRes = await hc(buildAddArgs(nextTarget));
        if (addRes.code !== 0) {
          const errMsg = parseErr(addRes, \`Couldn't reach \${nextTarget}.\`);
          if (previousTarget) {
            const rollback = await hc(buildAddArgs(previousTarget));
            if (rollback.code === 0) {
              this.setMachineDetached(name, null);
              throw new Error(\`\${errMsg} (kept \${previousTarget})\`);
            }
          }
          this.setMachineDetached(name, {
            name,
            target: previousTarget || nextTarget,
            state: "unreachable",
            version: m.version ?? null,
            via: Boolean(m.via),
            session: m.session ?? null,
            detached: true,
          });
          throw new Error(errMsg);
        }
        this.setMachineDetached(name, null);
        this.machineResults[name] = { message: \`Switched \${name} to \${nextTarget}.\`, ok: true };
      } catch (e) {
        this.machineResults[name] = { message: String(e?.message ?? e), ok: false };
      } finally {
        clearSwitching();
        delete this.machineBusy[name];
      }
      await this.loadMachines();
      cx.notify();
    });
  }

  async loadMachines() {
    if (this.machineLoading) return;
    this.machineLoading = true;
    try {
      const r = await hc(["machine", "ls", "--json"]);
      if (r.code !== 0) throw new Error(r.stderr || r.stdout || "Couldn't read machines.");
      const list = JSON.parse(r.stdout).machines;
      if (!Array.isArray(list)) throw new Error("Couldn't read machines.");
      const live = list.filter((m) => !m.temporary);
      const liveNames = new Set(live.map((m) => m.name));
      const detached = this.machineDetachedMap();
      for (const name of Object.keys(detached)) {
        if (liveNames.has(name)) this.setMachineDetached(name, null);
      }
      const extras = Object.values(this.machineDetachedMap()).filter((m) => m?.name && !liveNames.has(m.name));
      this.machineList = [...live, ...extras];
      this.machineError = null;
    } catch (e) {
      this.machineError = String(e);
    } finally {
      this.machineLoading = false;
    }
  }

  machineAction(machine, action, cx, name) {
    if (this.machineBusy[machine]) return;
    if (action === "rename" && (!name?.trim() || name.trim() === machine)) return;
    this.machineBusy[machine] = action;
    delete this.machineResults[machine];
    this.machineEdit = null;
    this.handle.focus();
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const current = (this.machineList ?? []).find((m) => m.name === machine);
        if (current?.detached && action === "rm") {
          this.setMachineDetached(machine, null);
          this.setMachineRoutes(machine, []);
          this.machineNotice = \`Removed \${machine}; its terminals keep running there.\`;
        } else {
          const args = ["machine", action, machine];
          if (action === "rename") args.push(name.trim());
          const r = await hc(args);
          let payload = null;
          try { payload = JSON.parse(r.stdout || r.stderr); } catch {}
          if (r.code !== 0) throw new Error(payload?.error?.message || (r.stderr || r.stdout || "It didn't work.").trim());
          if (action === "rename") {
            const trimmed = name.trim();
            const routes = current ? this.machineRoutes(current) : [];
            this.setMachineRoutes(machine, []);
            if (routes.length) this.setMachineRoutes(trimmed, routes);
            const det = this.machineDetachedMap()[machine];
            if (det) {
              this.setMachineDetached(machine, null);
              this.setMachineDetached(trimmed, { ...det, name: trimmed });
            }
          } else if (action === "rm") {
            this.setMachineRoutes(machine, []);
            this.setMachineDetached(machine, null);
          }
          const message = action === "update"
            ? \`Updated \${machine}\${payload?.version ? \` to hc \${payload.version}\` : ""}; its terminals kept running.\`
            : action === "rename" ? \`Renamed \${machine} to \${name.trim()}.\` : \`Removed \${machine}; its terminals keep running there.\`;
          if (action === "update") this.machineResults[machine] = { message, ok: true };
          else this.machineNotice = message;
        }
      } catch (e) {
        this.machineResults[machine] = { message: String(e), ok: false };
      } finally {
        delete this.machineBusy[machine];
      }
      await this.loadMachines();
      cx.notify();
    });
  }

  olderCore(remote, local) {
    const parse = (v) => /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([^+]+))?(?:\\+.*)?$/.exec(v ?? "");
    const a = parse(remote), b = parse(local);
    if (!a || !b) return false;
    for (let i = 1; i <= 3; i++) {
      if (+a[i] !== +b[i]) return +a[i] < +b[i];
    }
    if (!a[4] || !b[4]) return Boolean(a[4] && !b[4]);
    const x = a[4].split("."), y = b[4].split(".");
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      if (x[i] === undefined || y[i] === undefined) return x[i] === undefined;
      const xn = /^\\d+$/.test(x[i]), yn = /^\\d+$/.test(y[i]);
      return xn && yn ? +x[i] < +y[i] : xn !== yn ? xn : x[i] < y[i];
    }
    return false;
  }

  machineRow(t, m, localVersion) {
    const busy = this.machineBusy[m.name];
    const edit = this.machineEdit?.machine === m.name ? this.machineEdit : null;
    const state = String(m.state ?? "unknown").replace(/[_-]/g, " ");
    const color = ["connected", "online"].includes(m.state) ? t.ansi2 : ["connecting", "reconnecting"].includes(m.state) ? t.working : t.blocked;
    const result = this.machineResults[m.name];
    const routes = this.machineRoutes(m);
    const controls = h_flex().gap(6).items_center();
    if (busy) controls.child(svg("mods/workspace-chrome/spinner.svg").size(12).text_color(t.working).spin(900)).child(div().text_size(12).text_color(t.muted).child(busy === "update" ? "Updating…" : busy === "rename" ? "Renaming…" : busy === "route" ? "Switching…" : "Removing…"));
    else {
      if (this.olderCore(m.version, localVersion)) controls.child(this.button(t, \`st-m-update-\${m.name}\`, "Update", (_e, cx) => this.machineAction(m.name, "update", cx)));
      controls.child(this.button(t, \`st-m-route-\${m.name}\`, "Add route", (_e, cx) => {
        this.machineEdit = { machine: m.name, action: "route", target: "" };
        this.routeInput.set_value("");
        this.routeFocused = true;
        this.routeInput.focus();
        cx.notify();
      }));
      for (const [action, label] of [["rename", "Rename"], ["rm", "Remove"]]) {
        controls.child(this.button(t, \`st-m-\${action}-\${m.name}\`, label, (_e, cx) => {
          this.machineEdit = { machine: m.name, action, name: m.name };
          if (action === "rename") {
            this.renameInput.set_value(m.name);
            this.renameInput.set_selected_range({ start: 0, end: encodeURIComponent(m.name).replace(/%[0-9A-F]{2}/g, "_").length });
            this.renameFocused = true;
            this.renameInput.focus();
          }
          cx.notify();
        }));
      }
    }
    const row = v_flex().w_full().py(12).gap(8).border_b(1).border_color(t.border)
      .child(h_flex().gap(10).items_center()
        .child(div().w(7).h(7).flex_none().rounded(4).bg(color))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(div().text_size(14).text_color(t.foreground).child(m.name))
          .child(div().text_size(12.5).text_color(t.dim).child(\`\${m.target ?? ""} · \${state} · \${m.version ? \`hc \${m.version}\` : "hc version unknown"}\`)))
        .when(m.keeps_running_after_logout === false, el => el.child(div().id(\`st-m-logout-\${m.name}\`)
          .text_color(t.blocked).cursor_pointer().tooltip("Agents stop when you disconnect. Click for the fix.")
          .on_click(() => run("mod.open", { name: "machine-add" })).child("⚠")))
        .child(controls.flex_none()));
    if (routes.length > 1 || m.detached) {
      row.child(
        h_flex()
          .pl(17)
          .gap(6)
          .flex_wrap()
          .items_center()
          .children(
            routes.map((route) => {
              const active = route === m.target && !m.detached;
              return h_flex()
                .id(\`st-m-route-item-\${m.name}-\${route}\`)
                .gap(6)
                .px(8)
                .py(3)
                .rounded(6)
                .border_1()
                .border_color(active ? t.accent : t.border)
                .bg(active ? t.raised : t.background)
                .items_center()
                .child(div().w(6).h(6).rounded(3).bg(active ? color : t.dim))
                .child(div().text_size(12).text_color(active ? t.foreground : t.muted).child(route))
                .when(active, (el) => el.child(div().text_size(11).text_color(t.dim).child("current")))
                .when(!active && !busy, (el) =>
                  el
                    .child(
                      div()
                        .id(\`st-m-route-use-\${m.name}-\${route}\`)
                        .px(6)
                        .py(1)
                        .rounded(4)
                        .border_1()
                        .border_color(t.border)
                        .bg(t.raised)
                        .cursor_pointer()
                        .text_size(11.5)
                        .text_color(t.foreground)
                        .hover((s) => s.bg(t.hover))
                        .on_click((_e, cx) => this.switchMachineRoute(m, route, cx))
                        .child("Use"),
                    )
                    .when(routes.length > 1, (el2) =>
                      el2.child(
                        div()
                          .id(\`st-m-route-del-\${m.name}-\${route}\`)
                          .px(4)
                          .rounded(4)
                          .cursor_pointer()
                          .text_size(12)
                          .text_color(t.dim)
                          .hover((s) => s.bg(t.hover).text_color(t.foreground))
                          .on_click((_e, cx) => this.removeMachineRoute(m, route, cx))
                          .child("×"),
                      ),
                    ),
                );
            }),
          ),
      );
    }
    if (m.state === "needs_login") {
      const command = \`hc machine login \${m.name}\`;
      row.child(v_flex().gap(5)
        .child(div().text_size(12.5).text_color(t.blocked).child("needs a login: run"))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(command))
          .child(this.button(t, \`st-m-login-copy-\${m.name}\`, this.copiedLogin === command ? "Copied" : "Copy", (_e, cx) => {
            cx.write_to_clipboard(command);
            this.copiedLogin = command;
            cx.notify();
          }))));
    }
    if (busy === "update") row.child(div().text_size(12.5).text_color(t.dim).child("Copying this computer's herdr-core. Its terminals keep running."));
    if (edit && !busy) {
      const cancel = this.button(t, \`st-m-cancel-\${m.name}\`, "Cancel", (_e, cx) => { this.machineEdit = null; this.handle.focus(); cx.notify(); });
      if (edit.action === "rm") row.child(v_flex().gap(8)
        .child(div().text_size(12.5).text_color(t.muted).child(\`Remove \${m.name}? Its terminals keep running there.\`))
        .child(h_flex().gap(6).child(cancel).child(this.button(t, \`st-m-confirm-\${m.name}\`, "Remove machine", (_e, cx) => this.machineAction(m.name, "rm", cx)))));
      else if (edit.action === "route") row.child(v_flex().gap(6)
        .child(div().text_size(12).text_color(t.dim).child(\`New route for \${m.name} (ssh host, user@ip, or Tailscale address)\`))
        .child(h_flex().gap(6).items_center()
          .child(Input.new(this.routeInput).flex_1().min_w(0).h(32).px(10).rounded(7).border_1().border_color(this.routeFocused ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground))
          .child(cancel)
          .child(this.button(t, \`st-m-route-save-\${m.name}\`, "Save", (_e, cx) => this.saveMachineRoute(m.name, edit.target, false, cx)))
          .child(this.button(t, \`st-m-route-switch-\${m.name}\`, "Save & use", (_e, cx) => this.saveMachineRoute(m.name, edit.target, true, cx)))));
      else row.child(v_flex().gap(6)
        .child(div().text_size(12).text_color(t.dim).child("New name (addresses using the old name stop working)"))
        .child(h_flex().gap(6).items_center()
          .child(Input.new(this.renameInput).flex_1().min_w(0).h(32).px(10).rounded(7).border_1().border_color(this.renameFocused ? t.accent : t.input).bg(t.background).text_size(13).text_color(t.foreground))
          .child(cancel).child(this.button(t, \`st-m-save-\${m.name}\`, "Save", (_e, cx) => this.machineAction(m.name, "rename", cx, edit.name)))));
    }
    if (result) row.child(div().text_size(12.5).text_color(result.ok ? t.ansi2 : t.blocked).child(result.message));
    return row;
  }`;

export function patchSettingsMachinesSource(source) {
  if (typeof source !== "string" || !source) return source;
  if (source.includes(MARKER)) return source;

  let next = source;
  if (!/\bsetShared\b/.test(next)) {
    next = next.replace(
      /\bshared,\s*appHome\b/,
      "shared, setShared, appHome",
    );
  }

  const renameSubmitAnchor = `    this.renameInput.on("submit", (_e, cx) => {
      const edit = this.machineEdit;
      if (edit?.action === "rename") this.machineAction(edit.machine, "rename", cx, edit.name);
    });`;
  if (!next.includes(renameSubmitAnchor)) return source;
  next = next.replace(renameSubmitAnchor, `${renameSubmitAnchor}\n${ROUTE_INPUT_INIT}`);

  const machinesStart = "  // Machines -------------------------------------------------------------";
  const machinesEnd = "\n  machines(t) {";
  const startIdx = next.indexOf(machinesStart);
  const endIdx = next.indexOf(machinesEnd, startIdx);
  if (startIdx < 0 || endIdx < 0) return source;

  next = `${next.slice(0, startIdx)}${MACHINES_SECTION}\n${next.slice(endIdx)}`;
  return next;
}
