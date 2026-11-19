import test from "node:test";
import assert from "node:assert/strict";
import { Transcript, parseAgyModel, cleanAgyToolOutput } from "../mods/chat/parse.js";
import { toolDetails, withChanges } from "../mods/chat/activity.js";
import { toolSummary } from "../mods/chat/display.js";
import { liveSnapshot } from "../mods/chat/stream.js";
import { menuAtBottom } from "../mods/chat/prompt.js";
import { conversationTitle, parseAgyHistoryRenames, saveAgyTitle } from "../mods/chat-pane/title.js";

test("parseAgyModel normalizes display labels and CLI model IDs", () => {
  assert.deepEqual(parseAgyModel("Gemini 4 Argon (Medium)"), {
    model: "gemini-4-argon",
    effort: "medium",
  });
  assert.deepEqual(parseAgyModel("gemini-4-hydrogen-xhigh"), {
    model: "gemini-4-hydrogen",
    effort: "xhigh",
  });
  assert.deepEqual(parseAgyModel("Orchestrator (Carbon)"), {
    model: "gemini-pro-orchestrator",
    effort: null,
  });
  assert.deepEqual(parseAgyModel("Claude Opus 4.6 (Thinking)"), {
    model: "claude-opus-4-6-thinking",
    effort: null,
  });
});

test("cleanAgyToolOutput strips timestamp headers, command wrappers, and background instructions", () => {
  const raw = [
    "Created At: 2026-11-18T14:28:47+08:00",
    "Completed At: 2026-11-18T14:28:50+08:00",
    "Created At: 2026-11-18T14:28:47+08:00",
    "Completed At: 2026-11-18T14:28:50+08:00",
    "Command exited with code 0.",
    "",
    "Command output:",
    "hello world",
    "",
    "YOU MUST TAKE ONE OF THE FOLLOWING TWO ACTIONS: A) either proceed...",
  ].join("\n");
  const res = cleanAgyToolOutput(raw);
  assert.equal(res.exitCode, 0);
  assert.equal(res.text, "hello world");
});

test("Transcript('agy') parses USER_INPUT, PLANNER_RESPONSE, tools, diffs, questions, and checkpoints", () => {
  const t = new Transcript("agy");

  // 1. User input with model setting change & media attachment
  t.feed(
    JSON.stringify({
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      content:
        "<USER_REQUEST>\n学习一下 T3 Code ，为 Agy 也支持 ChatUI\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: 2026-11-18T17:56:13+08:00.\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 4 Argon (Medium).\n</USER_SETTINGS_CHANGE>",
      media: [{ mime_type: "image/png", uri: "/tmp/test-screen.png" }],
    }),
  );

  assert.equal(t.model, "gemini-4-argon");
  assert.equal(t.effort, "medium");
  const userEntry = t.entries.find((e) => e.kind === "user");
  assert.ok(userEntry);
  assert.equal(userEntry.text, "学习一下 T3 Code ，为 Agy 也支持 ChatUI");
  assert.equal(userEntry.images.length, 1);
  assert.equal(userEntry.images[0].path, "/tmp/test-screen.png");

  // 2. Planner response with thinking + run_command + edit_file + write_file
  t.feed(
    JSON.stringify({
      step_index: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      model: "gemini-4-argon-high",
      input_tokens: 12000,
      cache_read_tokens: 3000,
      output_tokens: 500,
      thinking: "Inspecting the workspace and applying the Agy parser changes.",
      tool_calls: [
        {
          name: "run_command",
          args: {
            CommandLine: '"ls -la"',
            WaitMsBeforeAsync: '"5000"',
            toolSummary: '"List workspace files"',
          },
        },
        {
          name: "edit_file",
          args: {
            Path: '"/repo/src/index.js"',
            Target: '"const oldVal = 1;"',
            Replacement: '"const newVal = 2;\\nconst extra = 3;"',
          },
        },
        {
          name: "write_file",
          args: {
            Path: '"/repo/src/new.js"',
            Content: '"export const added = true;\\n"',
          },
        },
      ],
    }),
  );

  assert.equal(t.model, "gemini-4-argon");
  assert.equal(t.effort, "high");
  assert.equal(t.context?.used, 15500);
  assert.ok(t.entries.some((e) => e.kind === "thinking" && e.text.includes("Inspecting the workspace")));

  // Feed tool results (GENERIC steps)
  t.feed(
    JSON.stringify({
      step_index: 2,
      source: "MODEL",
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-18T18:00:00+08:00\nCompleted At: 2026-11-18T18:00:01+08:00\nCommand exited with code 0.\n\nCommand output:\ntotal 8\ndrwxr-xr-x 2 user staff 64 src\n",
    }),
  );
  t.feed(
    JSON.stringify({
      step_index: 3,
      source: "MODEL",
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-18T18:00:01+08:00\nCompleted At: 2026-11-18T18:00:02+08:00\nMade 1 replacement in /repo/src/index.js starting at line 1 (+2/-1 lines).",
    }),
  );
  t.feed(
    JSON.stringify({
      step_index: 4,
      source: "MODEL",
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-18T18:00:02+08:00\nCompleted At: 2026-11-18T18:00:02+08:00\nCreated file.",
    }),
  );

  const toolsEntry = t.entries.find((e) => e.kind === "tools");
  assert.ok(toolsEntry);
  assert.equal(toolsEntry.items.length, 3);
  const bashDetail = toolDetails(toolsEntry.items[0]);
  assert.equal(bashDetail.name, "Bash");
  assert.equal(bashDetail.exitCode, 0);
  assert.match(bashDetail.result, /drwxr-xr-x/);

  const summary = toolSummary(toolsEntry.items.map(toolDetails), false);
  assert.equal(summary, "1 command · 2 edits");

  const projected = withChanges(t.entries);
  const changesCard = projected.find((e) => e.kind === "changes");
  assert.ok(changesCard);
  assert.equal(changesCard.files.length, 2);
  assert.equal(changesCard.files[0].path, "/repo/src/index.js");
  assert.equal(changesCard.files[0].added, 2);
  assert.equal(changesCard.files[0].removed, 1);
  assert.equal(changesCard.files[1].path, "/repo/src/new.js");
  assert.equal(changesCard.files[1].operation, "add");

  // 3. ask_question followed by user answer in GENERIC
  t.feed(
    JSON.stringify({
      step_index: 5,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      tool_calls: [
        {
          name: "ask_question",
          args: {
            questions: JSON.stringify([
              {
                question: "How should we proceed?",
                options: ["(Recommended) Full ChatUI support", "Read-only"],
                is_multi_select: false,
              },
            ]),
          },
        },
      ],
    }),
  );
  assert.equal(t.hasOpenQuestion(), true);

  t.feed(
    JSON.stringify({
      step_index: 6,
      source: "MODEL",
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-18T18:01:00+08:00\nCompleted At: 2026-11-18T18:01:05+08:00\nA1: (Recommended) Full ChatUI support",
    }),
  );
  assert.equal(t.hasOpenQuestion(), false);
  const qEntry = t.entries.find((e) => e.kind === "question");
  assert.equal(qEntry?.answered, true);
  assert.equal(qEntry?.answer, "(Recommended) Full ChatUI support");

  // 4. Compaction CHECKPOINT and final reply
  t.feed(
    JSON.stringify({
      step_index: 7,
      source: "SYSTEM",
      type: "CHECKPOINT",
      status: "DONE",
      input_tokens: 4000,
      cache_read_tokens: 1000,
      output_tokens: 200,
      content: "# Resuming from a compaction\n\nSummary of prior steps.",
    }),
  );
  const compactNote = t.entries.find((e) => e.kind === "note" && e.compact);
  assert.ok(compactNote);
  assert.equal(compactNote.summary, "Summary of prior steps.");

  t.feed(
    JSON.stringify({
      step_index: 8,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      content: "已完成 Agy 的 ChatUI 支持。",
    }),
  );
  assert.equal(t.turnState.stage, "completed");
  assert.equal(t.entries.at(-1)?.kind, "assistant");
  assert.equal(t.entries.at(-1)?.text, "已完成 Agy 的 ChatUI 支持。");
});

test("liveSnapshot('agy') parses running tools and streaming assistant replies", () => {
  const runningScreen = [
    "────────────────────────────────────────────────────────────",
    "> 好，加油",
    "",
    "○ Thought for 12s (Inspecting Agy transcripts...)",
    "● Explored 3 files (parse.js, stream.js, source.js)",
    "○ Running (python3 scripts/check.py --native) (ctrl+o to expand)",
    "⣷  Running command...",
    "────────────────────────────────────────────────────────────",
    ">",
    "────────────────────────────────────────────────────────────",
    "esc to cancel                     auto · Gemini 4 Argon · medium",
  ].join("\n");

  const snap1 = liveSnapshot(runningScreen, "agy");
  assert.equal(snap1.item?.kind, "run");
  assert.equal(snap1.item?.title, "Running command...");
  assert.ok(snap1.item?.out?.includes("Running (python3 scripts/check.py --native)"));
  assert.equal(snap1.statusAfterAt, true);

  const replyScreen = [
    "────────────────────────────────────────────────────────────",
    "> 好，加油",
    "",
    "● Thought for 12s",
    "● Explored 3 files (parse.js, stream.js, source.js)",
    "",
    "  已经完成了对 T3 Code 的学习并为 Agy 接入了 ChatUI：",
    "  - 支持自动定位 transcript_full.jsonl",
    "  - 支持工具调用和 Diff 预览",
    "────────────────────────────────────────────────────────────",
    ">",
    "────────────────────────────────────────────────────────────",
    "esc to cancel                     auto · Gemini 4 Argon · medium",
  ].join("\n");

  const snap2 = liveSnapshot(replyScreen, "agy");
  assert.equal(snap2.item?.kind, "text");
  assert.match(snap2.item?.text ?? "", /已经完成了对 T3 Code 的学习/);
  assert.match(snap2.item?.text ?? "", /支持工具调用和 Diff 预览/);
});

test("liveSnapshot('agy') does not leak multi-line indented user prompt lines as assistant text", () => {
  const multiLinePromptScreen = [
    "────────────────────────────────────────────────────────────",
    "> 1. 命令和think process 没有收起来，展开的还是很多",
    "  2. TUI中切换了 model，ChatUI中没有跟随切换",
    "  3. 行间距有点小，是不是跟Codex ChatUI 的实现不一样",
    "",
    "⠋  Thinking...",
    "────────────────────────────────────────────────────────────",
    ">",
    "────────────────────────────────────────────────────────────",
    "esc to cancel                     auto · Gemini 4 Neon · medium",
  ].join("\n");

  const snap = liveSnapshot(multiLinePromptScreen, "agy");
  assert.equal(snap.item?.kind, "run");
  assert.equal(snap.item?.title, "Thinking...");
});

test("withChanges coalesces interleaved Agy thinking and tools into one thinking and one tools group", () => {
  const t = new Transcript("agy");
  t.feed(JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "<USER_REQUEST>\nCheck files\n</USER_REQUEST>" }));
  t.feed(JSON.stringify({
    step_index: 1,
    type: "PLANNER_RESPONSE",
    thinking: "Step 1 thought",
    tool_calls: [{ name: "read_file", args: { Path: '"/a.js"' } }],
  }));
  t.feed(JSON.stringify({ step_index: 2, type: "GENERIC", content: "file a" }));
  t.feed(JSON.stringify({
    step_index: 3,
    type: "PLANNER_RESPONSE",
    thinking: "Step 2 thought",
    tool_calls: [{ name: "run_command", args: { CommandLine: '"ls"' } }],
  }));
  t.feed(JSON.stringify({ step_index: 4, type: "GENERIC", content: "Command exited with code 0.\n\nCommand output:\nok" }));
  t.feed(JSON.stringify({
    step_index: 5,
    type: "PLANNER_RESPONSE",
    thinking: "Step 3 thought",
    content: "All done.",
  }));

  const projected = withChanges(t.entries);
  const kinds = projected.map((e) => e.kind);
  assert.deepEqual(kinds, ["user", "thinking", "tools", "assistant"]);
  assert.match(projected[1].text, /Step 1 thought[\s\S]*Step 2 thought[\s\S]*Step 3 thought/);
  assert.equal(projected[2].items.length, 2);
});

test("liveSnapshot('agy') puts live status in title and prior actions/thoughts in body", () => {
  const screen = [
    "────────────────────────────────────────────────────────────",
    "> check keybindings",
    "",
    "○ Thought for 7.5s (Examining Agy TUI's keybindings)",
    "● Ran (python3 -c 'print(1)')",
    "⣷  Running command...",
    "└ Tip: Use /help to see commands",
    "────────────────────────────────────────────────────────────",
    ">",
    "────────────────────────────────────────────────────────────",
    "esc to cancel                     auto · Gemini 4 Neon · medium",
  ].join("\n");

  const snap = liveSnapshot(screen, "agy");
  assert.equal(snap.item?.kind, "run");
  assert.equal(snap.item?.title, "Running command...");
  assert.deepEqual(snap.item?.out, [
    "Thought for 7.5s (Examining Agy TUI's keybindings)",
    "Ran (python3 -c 'print(1)')",
  ]);

  const thinkingScreen = [
    "────────────────────────────────────────────────────────────",
    "> check keybindings",
    "",
    "⠋  Examining mods/chat/models.js to implement live catalog...",
    "────────────────────────────────────────────────────────────",
    ">",
  ].join("\n");
  const snapThink = liveSnapshot(thinkingScreen, "agy");
  assert.equal(snapThink.item?.kind, "run");
  assert.equal(snapThink.item?.title, "Thinking…");
  assert.deepEqual(snapThink.item?.out, ["Examining mods/chat/models.js to implement live catalog..."]);
});

test("liveSnapshot('agy') extracts TUI queued messages without leaking them into streaming reply", () => {
  const queuedScreen = [
    "────────────────────────────────────────────────────────────",
    "> first prompt",
    "",
    "○ Thought for 3s (Working on first prompt)",
    "⠋  Running command...",
    "",
    "> second queued message",
    "> third queued message",
    "  second line of third",
    "Press ↑ to edit queued messages",
    "└ Tip: Press alt+enter to send immediately",
    "────────────────────────────────────────────────────────────",
    ">",
    "────────────────────────────────────────────────────────────",
    "esc to cancel                     auto · Gemini 4 Neon · medium",
  ].join("\n");

  const snap = liveSnapshot(queuedScreen, "agy");
  assert.deepEqual(snap.queued, [
    "second queued message",
    "third queued message\nsecond line of third",
  ]);
  assert.equal(snap.item?.kind, "run");
  assert.equal(snap.item?.title, "Running command...");
  assert.equal(snap.promptLine, "> first prompt");
});

test("conversationTitle caches Agy working report.msg and ignores done reply previews", () => {
  const shared = {};
  const workingTitle = conversationTitle({
    address: "mini/t28",
    status: "working",
    title: "agy --conversation=66b4db1e-a6a4-4cb6-b63e-d29e067657a6",
    report: { app: "antigravity", state: "working", msg: "Gemini New Models Comparison Codex" },
  }, shared);
  assert.equal(workingTitle, "Gemini New Models Comparison Codex");
  shared["mini/t28"] = workingTitle;

  // When done, Agy puts the last reply's first line in report.msg: must keep the cached session title.
  assert.equal(
    conversationTitle({
      address: "mini/t28",
      status: "done",
      title: "agy --conversation=66b4db1e-a6a4-4cb6-b63e-d29e067657a6",
      report: { app: "antigravity", state: "done", msg: "两张截图一眼看清了全部原因：" },
    }, shared),
    "Gemini New Models Comparison Codex",
  );

  // When idle (switched back to TUI), report.msg is cleared: must still keep cached title.
  assert.equal(
    conversationTitle({
      address: "mini/t28",
      status: "idle",
      title: "agy --conversation=66b4db1e-a6a4-4cb6-b63e-d29e067657a6",
      report: { app: "antigravity", state: "idle", msg: "" },
    }, shared),
    "Gemini New Models Comparison Codex",
  );

  // Unknown Agy session without cached title falls back to Antigravity, not raw CLI command.
  assert.equal(
    conversationTitle({
      address: "mini/t99",
      status: "idle",
      title: "agy --conversation=66b4db1e-a6a4-4cb6-b63e-d29e067657a6",
      report: { app: "antigravity", state: "idle" },
    }),
    "Antigravity",
  );
});

test("Transcript('agy') ignores internal ERROR_MESSAGE retry entries", () => {
  const t = new Transcript("agy");
  t.feed(JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "<USER_REQUEST>\nhi\n</USER_REQUEST>" }));
  t.feed(JSON.stringify({ step_index: 1, type: "ERROR_MESSAGE", content: "API error (attempt 1): UNAVAILABLE (code 503)" }));
  t.feed(JSON.stringify({ step_index: 2, type: "PLANNER_RESPONSE", content: "hello" }));
  assert.deepEqual(t.entries.map((e) => e.kind), ["user", "assistant"]);
});

test("liveSnapshot('agy') ignores multi-paragraph user prompts and terminal tree output lines", () => {
  const blankLinePrompt = [
    "────────────────────────────────────────────────────────────",
    "> agent error 没必要展示",
    "",
    "  会话名还是没有展示",
    "  ▸ 📎 1 image(s) (144 KB)  (ctrl+o to expand)",
    "⠋  Thinking...",
    "────────────────────────────────────────────────────────────",
    ">",
  ].join("\n");
  const snap1 = liveSnapshot(blankLinePrompt, "agy");
  assert.equal(snap1.item?.kind, "run");
  assert.equal(snap1.item?.title, "Thinking...");

  const treeOutputScreen = [
    "────────────────────────────────────────────────────────────",
    "> check files",
    "● Explored 1 file (main.js)",
    "  └ Read 41 lines (ctrl+o to collapse)",
    "⠋  Thinking...",
    "────────────────────────────────────────────────────────────",
    ">",
  ].join("\n");
  const snap2 = liveSnapshot(treeOutputScreen, "agy");
  assert.equal(snap2.item?.kind, "run");
  assert.equal(snap2.item?.title, "Thinking...");
});

test("menuAtBottom ignores Agy's normal composer footer ('esc to cancel')", () => {
  const agyWorkingFooter = [
    "  已完成修改。",
    "────────────────────────────────────────────────────────────",
    ">",
    "────────────────────────────────────────────────────────────",
    "esc to cancel                    auto · Gemini 4 Neon · medium",
  ].join("\n");
  assert.equal(menuAtBottom(agyWorkingFooter), null);
});

test("liveSnapshot('agy') strips trailing TUI hints like (queued) and (alt+m to send immediately) from queued messages", () => {
  const screen = [
    "────────────────────────────────────────────────────────────",
    "> first prompt",
    "⠋  Thinking...",
    "",
    "  ▸ 我指的是 左侧栏 (alt+m to send immediately)",
    "> second message (queued)",
    "> third message (ctrl+o to expand)",
    "Press ↑ to edit queued messages",
    "────────────────────────────────────────────────────────────",
    ">",
  ].join("\n");
  const snap = liveSnapshot(screen, "agy");
  assert.deepEqual(snap.queued, ["我指的是 左侧栏", "second message", "third message"]);
});

test("parseAgyHistoryRenames extracts latest '/rename' per conversation from history.jsonl", () => {
  const jsonl = [
    JSON.stringify({ display: "hello", timestamp: 100, conversationId: "cid-1" }),
    JSON.stringify({ display: "/rename Old Name", timestamp: 200, conversationId: "cid-1", type: "slash_command" }),
    JSON.stringify({ display: "/rename Neon the King", timestamp: 300, conversationId: "cid-1", type: "slash_command" }),
    JSON.stringify({ display: "/rename Other Session", timestamp: 250, conversationId: "cid-2", type: "slash_command" }),
  ].join("\n");
  const renames = parseAgyHistoryRenames(jsonl);
  assert.deepEqual(renames.get("cid-1"), { title: "Neon the King", timestamp: 300 });
  assert.deepEqual(renames.get("cid-2"), { title: "Other Session", timestamp: 250 });

  const shared = {};
  const setShared = (_k, v) => Object.assign(shared, v);
  assert.equal(saveAgyTitle("t28", "Neon the King", shared, setShared, 300), true);
  assert.equal(shared.t28, "Neon the King");
});
