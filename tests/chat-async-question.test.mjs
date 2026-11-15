import test from "node:test";
import assert from "node:assert/strict";
import { Transcript, parseAsyncQuestions } from "../mods/chat/parse.js";
import { liveSnapshot } from "../mods/chat/stream.js";
import { Outbox } from "../mods/chat/outbox.js";
import { conversationTitle, hasActionRequired, CODEX_TITLE_CONFIG } from "../mods/chat/title.js";

function codexCall(name, args, callId = "call-1") {
  return JSON.stringify({
    type: "response_item",
    payload: { type: "function_call", name, call_id: callId, arguments: JSON.stringify(args) },
  });
}

function codexCallOutput(callId, output) {
  return JSON.stringify({
    type: "response_item",
    payload: { type: "function_call_output", call_id: callId, output: typeof output === "string" ? output : JSON.stringify(output) },
  });
}

function codexUserMessage(text) {
  return JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
}

test("parseAsyncQuestions extracts optioned and free-text questions for async user input tools", () => {
  const withOptions = parseAsyncQuestions("request_user_input_async", JSON.stringify({
    questions: [{
      id: "q1",
      header: "Target",
      question: "Where should I deploy?",
      options: [
        { label: "macbook", description: "Local machine" },
        { label: "mini", description: "Home server" },
      ],
    }],
  }));
  assert.deepEqual(withOptions, [{
    id: "q1",
    header: "Target",
    question: "Where should I deploy?",
    title: "Where should I deploy?",
    options: [
      { label: "macbook", description: "Local machine" },
      { label: "mini", description: "Home server" },
    ],
  }]);

  const freeText = parseAsyncQuestions("request_user_input_async", JSON.stringify({
    questions: [{ title: "你的音箱型号和期望模型是什么？" }],
  }));
  assert.deepEqual(freeText, [{
    id: null,
    header: "",
    question: "你的音箱型号和期望模型是什么？",
    title: "你的音箱型号和期望模型是什么？",
    options: [],
  }]);

  const directMsg = parseAsyncQuestions("send_user_message_async", { message: "Need SSH host" });
  assert.equal(directMsg?.[0]?.question, "Need SSH host");
  const legacyMsg = parseAsyncQuestions("send_message_to_user_async", { text: "Provide API key" });
  assert.equal(legacyMsg?.[0]?.question, "Provide API key");
  assert.equal(parseAsyncQuestions("shell_command", { command: "ls" }), null);
});

test("Transcript parses request_user_input_async, deduplicates item_completed, ignores accepted ack, and settles on user reply", () => {
  const t = new Transcript("codex");
  t.feed(codexCall("request_user_input_async", {
    questions: [{ title: "部署目标选哪台机器？", options: [{ label: "macbook" }, { label: "mini" }] }],
  }, "call-async-1"));

  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].kind, "question");
  assert.equal(t.entries[0].answered, false);
  assert.equal(t.entries[0].closed, false);
  assert.equal(t.pendingQuestion, t.entries[0]);
  assert.equal(t.hasOpenQuestion(), true);

  // Companion AgentMessage with same id must not duplicate the card or create a stray assistant bubble.
  t.feed(JSON.stringify({
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "AgentMessage",
        id: "call-async-1",
        delivery: "async",
        questions: [{ title: "部署目标选哪台机器？", options: [{ label: "macbook" }, { label: "mini" }] }],
        content: [{ type: "Text", text: "部署目标选哪台机器？" }],
      },
    },
  }));
  assert.equal(t.entries.length, 1);

  // {"accepted":true} tool output does not close the question or add a tool card.
  t.feed(codexCallOutput("call-async-1", { accepted: true }));
  assert.equal(t.entries.length, 1);
  assert.equal(t.pendingQuestion, t.entries[0]);

  // Mid-turn user reply answers the pending question cleanly.
  t.feed(codexUserMessage("mini"));
  assert.equal(t.entries[0].answered, true);
  assert.equal(t.entries[0].answer, "mini");
  assert.equal(t.pendingQuestion, null);
  assert.equal(t.hasOpenQuestion(), false);
  assert.equal(t.entries[1].kind, "user");
  assert.equal(t.entries[1].text, "mini");
});

test("Transcript handles free-text AgentMessage item_completed, superseding questions, task_complete, and sync request_user_input output", () => {
  const t = new Transcript("codex");

  // item_completed without prior function_call
  t.feed(JSON.stringify({
    type: "event_msg",
    payload: {
      type: "item_completed",
      item: {
        type: "AgentMessage",
        id: "async-msg-1",
        delivery: "async",
        content: [{ type: "Text", text: "音箱型号是什么？" }],
      },
    },
  }));
  assert.equal(t.entries.length, 1);
  assert.equal(t.entries[0].kind, "question");
  assert.deepEqual(t.entries[0].questions[0].options, []);
  assert.equal(t.pendingQuestion, t.entries[0]);

  // A newer question closes the previous unanswered one.
  t.feed(codexCall("send_user_message_async", { message: "模型选 DeepSeek 还是豆包？" }, "call-2"));
  assert.equal(t.entries.length, 2);
  assert.equal(t.entries[0].closed, true);
  assert.equal(t.entries[1].closed, false);
  assert.equal(t.pendingQuestion, t.entries[1]);

  // task_complete stops mid-turn answering bypass but leaves card active/clickable when turn becomes idle.
  t.feed(JSON.stringify({ type: "event_msg", payload: { type: "task_complete", turn_id: "t1" } }));
  assert.equal(t.pendingQuestion, null);
  assert.equal(t.entries[1].answered, false);
  assert.equal(t.entries[1].closed, false);
  assert.equal(t.hasOpenQuestion(), true);

  // Subsequent user message still marks that open card answered.
  t.feed(codexUserMessage("DeepSeek"));
  assert.equal(t.entries[1].answered, true);
  assert.equal(t.entries[1].answer, "DeepSeek");
  assert.equal(t.hasOpenQuestion(), false);

  // Sync request_user_input answered via function_call_output.
  t.feed(codexCall("request_user_input", {
    questions: [{ id: "env", header: "Env", question: "Pick env", options: [{ label: "prod" }, { label: "staging" }] }],
  }, "call-sync-3"));
  assert.equal(t.hasOpenQuestion(), true);
  t.feed(codexCallOutput("call-sync-3", { answers: { env: { answers: ["staging"] } } }));
  const q3 = t.entries.find((e) => e.id === "call-sync-3");
  assert.equal(q3?.answered, true);
  assert.equal(q3?.answer, "staging");
  assert.equal(t.pendingQuestion, null);
  assert.equal(t.hasOpenQuestion(), false);
});

test("liveSnapshot ignores Codex Queued follow-up inputs and Messages to be submitted status footers", () => {
  const screen = [
    "› deploy xiaogpt",
    "",
    "• Working (1m 03s • esc to interrupt) • 1 background terminal running",
    "",
    "• Queued follow-up inputs",
    "  ? 1 question",
    "  ⇧← to answer",
    "",
    "›",
  ].join("\n");
  const snap = liveSnapshot(screen, "codex");
  assert.equal(snap.statusAfterAt, true);
  assert.equal(snap.item, null);

  const submittedScreen = [
    "› test",
    "",
    "• Messages to be submitted after next tool call",
    "  hello",
    "",
    "›",
  ].join("\n");
  const snap2 = liveSnapshot(submittedScreen, "codex");
  assert.equal(snap2.statusAfterAt, true);
  assert.equal(snap2.item, null);
});

test("liveSnapshot strips Codex TUI Back to bottom and status banners from replies and tool outputs", () => {
  const replyScreen = [
    "› explain the diff",
    "",
    "• The change updates the composer focus handler.",
    "                                                      New activity · ↓ Back to bottom · esc",
    "                                                                                   ⚠ weekly limit: 17% left · resets at 12:58 on 19 Nov · /status",
    "",
    "› Ask Codex to do anything",
  ].join("\n");
  const snap1 = liveSnapshot(replyScreen, "codex");
  assert.deepEqual(snap1.item, {
    kind: "text",
    text: "The change updates the composer focus handler.",
  });

  const toolScreen = [
    "› run checks",
    "",
    "• Ran npm test",
    "  └ 311 passed",
    "                                                                     ↓ Back to bottom · esc",
    "",
    "› Ask Codex to do anything",
  ].join("\n");
  const snap2 = liveSnapshot(toolScreen, "codex");
  assert.deepEqual(snap2.item, {
    kind: "run",
    title: "Ran npm test",
    out: ["311 passed"],
    time: null,
  });
});

test("Outbox allows direct send and automatic claim while working when answering an async question", () => {
  const outbox = new Outbox();
  const workingBlocked = { scope: "codex:1", status: "working", turn: 1, answering: false, now: 100 };
  outbox.gate = { scope: "codex:1", turn: 1, sawBusy: true, at: 50 };

  assert.equal(outbox.canSendDirect(workingBlocked), false);
  const queuedItem = outbox.enqueue({ text: "later", paths: [], attachments: [], direct: false }, "codex:1");
  assert.equal(outbox.claim(workingBlocked), null);

  const answeringCtx = { scope: "codex:1", status: "working", turn: 1, answering: true, now: 120 };
  // Can auto-claim an existing queued item when a question arrives.
  const claimed = outbox.claim(answeringCtx);
  assert.equal(claimed?.id, queuedItem.id);
  assert.equal(claimed?.state, "sending");
  assert.equal(outbox.gate?.sawBusy, true);
  outbox.finish(claimed.id, null, false);

  // Without pending items, canSendDirect returns true while working + answering.
  assert.equal(outbox.canSendDirect(answeringCtx), true);
  const direct = outbox.enqueue({ text: "xiaomi LX06", paths: [], attachments: [], direct: true }, "codex:1");
  const directClaimed = outbox.claim(answeringCtx);
  assert.equal(directClaimed?.id, direct.id);
  outbox.finish(directClaimed.id, null, false);

  // Because claim recorded sawBusy: true while working, gate clears cleanly when turn ends.
  outbox.observe({ scope: "codex:1", status: "idle", turn: 2, answering: false, now: 200 });
  assert.equal(outbox.gate, null);
});

test("title.js strips Codex Action Required prefixes and detects hasActionRequired", () => {
  const id = "019d5613-76f5-7cc0-ac4c-b41186789000";
  const configured = {
    state: "live",
    status: "working",
    report: { app: "codex", state: "working" },
    foreground: { argv: ["/bin/codex", "-c", CODEX_TITLE_CONFIG] },
  };

  assert.equal(conversationTitle({
    ...configured,
    title: `[ ! ] Action Required | Deploy bot | ${id}`,
  }), "Deploy bot");

  assert.equal(conversationTitle({
    ...configured,
    title: `[ . ] Action Required | codex | ${id}`,
  }), "Codex");

  assert.equal(conversationTitle({
    state: "live",
    title: "[ ! ] Action Required | Manual session",
    report: { app: "codex" },
  }), "Manual session");

  assert.equal(conversationTitle({
    state: "live",
    title: "Plain terminal title",
  }), "Plain terminal title");

  assert.equal(hasActionRequired({
    ...configured,
    title: `[ ! ] Action Required | Deploy bot | ${id}`,
  }), true);

  assert.equal(hasActionRequired({
    state: "live",
    title: "[ . ] Action Required | Manual session",
    report: { app: "codex" },
  }), true);

  assert.equal(hasActionRequired({
    app: "codex",
    title: "[ ! ] Action Required | Fix bug",
  }), true);

  assert.equal(hasActionRequired({
    program: { key: "codex" },
    title: "[ . ] Action Required | Fix bug",
  }), true);

  assert.equal(hasActionRequired({
    ...configured,
    state: "closed",
    title: `[ ! ] Action Required | Deploy bot | ${id}`,
  }), false);

  assert.equal(hasActionRequired({
    state: "live",
    title: "[ ! ] Action Required | Other app",
  }), false);
});
