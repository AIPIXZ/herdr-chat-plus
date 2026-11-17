import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { patchSettingsMachinesSource } from "../mods/spaces-chat/settings-routes.js";

const SAMPLE_SETTINGS_MAIN = `// App-owned settings mod. Writes changes immediately; no Save step.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, InputState, Input, Popup } from "gpui-base";
import { hc, run, theme, themes, fonts, updates, telemetry, settings, layouts, shared, appHome, readTextFile, writeTextFile, playSound, props, closeOverlay, notify, window } from "herdr";

export default class Settings extends View {
  init(_props, cx) {
    this.renameInput = InputState.new();
    this.renameInput.on("focus", (_e, cx) => { this.renameFocused = true; cx.notify(); });
    this.renameInput.on("blur", (_e, cx) => { this.renameFocused = false; cx.notify(); });
    this.renameInput.on("change", (_e, cx) => { if (this.machineEdit?.action === "rename") this.machineEdit.name = this.renameInput.value(); cx.notify(); });
    this.renameInput.on("submit", (_e, cx) => {
      const edit = this.machineEdit;
      if (edit?.action === "rename") this.machineAction(edit.machine, "rename", cx, edit.name);
    });
    this.machineList = null;
    this.machineLoading = false;
    this.machineError = null;
    this.machineBusy = {};
    this.machineResults = {};
    this.machineEdit = null;
    this.machineNotice = null;
    this.handle = { focus() {} };
  }

  // Machines -------------------------------------------------------------

  async loadMachines() {
    if (this.machineLoading) return;
    this.machineLoading = true;
    try {
      const r = await hc(["machine", "ls", "--json"]);
      if (r.code !== 0) throw new Error(r.stderr || r.stdout || "Couldn't read machines.");
      const list = JSON.parse(r.stdout).machines;
      if (!Array.isArray(list)) throw new Error("Couldn't read machines.");
      this.machineList = list.filter((m) => !m.temporary);
      this.machineError = null;
    } catch (e) {
      this.machineError = String(e);
    } finally {
      this.machineLoading = false;
    }
  }

  machineRow(t, m, localVersion) {
    return div();
  }

  machines(t) {
    return div();
  }
}
`;

function createHarness(hcImpl) {
  const patched = patchSettingsMachinesSource(SAMPLE_SETTINGS_MAIN);
  const sharedState = {};
  const hcCalls = [];
  const transformed = patched
    .replace(/^import\s+.*$/gm, "")
    .replace(/export\s+default\s+class\s+Settings\s+extends\s+View/, "class Settings");

  const context = vm.createContext({
    JSON,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Error,
    RegExp,
    Math,
    encodeURIComponent,
    InputState: {
      new() {
        let val = "";
        return {
          on() {},
          value: () => val,
          set_value: (v) => { val = v; },
          set_selected_range() {},
          focus() {},
        };
      },
    },
    Input: { new: () => ({}) },
    shared: (k) => sharedState[k],
    setShared: (k, v) => { sharedState[k] = v; },
    hc: async (args) => {
      hcCalls.push(args);
      return hcImpl(args);
    },
    run: () => {},
  });

  const SettingsClass = vm.runInContext(`${transformed}\nSettings;`, context);
  const instance = new SettingsClass();
  const tasks = [];
  const cx = {
    notify() {},
    spawn(fn) {
      tasks.push(fn(cx));
    },
  };
  instance.init({}, cx);
  return {
    instance,
    cx,
    sharedState,
    hcCalls,
    flush: async () => {
      while (tasks.length) {
        const batch = tasks.splice(0, tasks.length);
        await Promise.all(batch);
      }
    },
  };
}

test("patchSettingsMachinesSource is idempotent and injects route controls", () => {
  const once = patchSettingsMachinesSource(SAMPLE_SETTINGS_MAIN);
  assert.notEqual(once, SAMPLE_SETTINGS_MAIN);
  assert.match(once, /\bshared,\s*setShared,\s*appHome\b/);
  assert.match(once, /st-m-route-\$\{m\.name\}/);
  assert.match(once, /Add route/);
  assert.match(once, /Save & use/);
  assert.equal(patchSettingsMachinesSource(once), once);
});

test("saveMachineRoute, switchMachineRoute, rollback, and rename migration work", async () => {
  let machinesInCore = [{ name: "mini2", target: "mini2.lan", state: "connected", version: "0.1.21" }];
  let failAddTarget = null;

  const { instance, cx, sharedState, hcCalls, flush } = createHarness(async (args) => {
    if (args[0] === "machine" && args[1] === "ls") {
      return { code: 0, stdout: JSON.stringify({ machines: machinesInCore }), stderr: "" };
    }
    if (args[0] === "machine" && args[1] === "rm") {
      const name = args[2];
      machinesInCore = machinesInCore.filter((m) => m.name !== name);
      return { code: 0, stdout: "{}", stderr: "" };
    }
    if (args[0] === "machine" && args[1] === "add") {
      const target = args[2];
      const nameIdx = args.indexOf("--name");
      const name = nameIdx >= 0 ? args[nameIdx + 1] : target;
      if (failAddTarget && (failAddTarget === "*" || failAddTarget === target)) {
        return { code: 1, stdout: JSON.stringify({ error: { message: `unreachable: ${target}` } }), stderr: "" };
      }
      machinesInCore.push({ name, target, state: "connected", version: "0.1.21" });
      return { code: 0, stdout: "{}", stderr: "" };
    }
    if (args[0] === "machine" && args[1] === "rename") {
      const [, , oldName, newName] = args;
      machinesInCore = machinesInCore.map((m) => (m.name === oldName ? { ...m, name: newName } : m));
      return { code: 0, stdout: "{}", stderr: "" };
    }
    return { code: 0, stdout: "{}", stderr: "" };
  });

  await instance.loadMachines();
  assert.equal(instance.machineList.length, 1);

  // 1. Save a second route without switching
  instance.saveMachineRoute("mini2", "mini2.tailnet", false, cx);
  assert.deepEqual([...instance.machineRoutes(instance.machineList[0])], ["mini2.lan", "mini2.tailnet"]);

  // 2. Switch to the second route successfully
  instance.switchMachineRoute(instance.machineList[0], "mini2.tailnet", cx);
  await flush();
  assert.equal(instance.machineList[0].target, "mini2.tailnet");
  assert.deepEqual([...instance.machineRoutes(instance.machineList[0])], ["mini2.lan", "mini2.tailnet"]);
  assert.equal(instance.machineResults.mini2?.ok, true);

  // 3. Switch to an unreachable third route -> automatically rolls back to mini2.tailnet
  failAddTarget = "10.0.0.99";
  instance.saveMachineRoute("mini2", "10.0.0.99", true, cx);
  await flush();
  assert.equal(instance.machineList[0].target, "mini2.tailnet");
  assert.equal(instance.machineResults.mini2?.ok, false);
  assert.match(instance.machineResults.mini2?.message ?? "", /kept mini2\.tailnet/);

  // 4. Remove the failed third route
  instance.removeMachineRoute(instance.machineList[0], "10.0.0.99", cx);
  assert.deepEqual([...instance.machineRoutes(instance.machineList[0])], ["mini2.lan", "mini2.tailnet"]);

  // 5. Rename mini2 -> mini2-pro migrates routes
  instance.machineAction("mini2", "rename", cx, "mini2-pro");
  await flush();
  assert.deepEqual([...sharedState["machine.routes"]["mini2-pro"]], ["mini2.lan", "mini2.tailnet"]);
  assert.equal(sharedState["machine.routes"].mini2, undefined);
  assert.ok(hcCalls.length > 0);
});
