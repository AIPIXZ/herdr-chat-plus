import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const source=readFileSync(new URL('../mods/chat/prompt.js',import.meta.url),'utf8');
const {menuAtBottom,parsePrompt,choose,toggleChoice}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const screen=`Previous assistant response
Worked for 10m

Approaching rate limits
Switch to gpt-6-luna for lower credit usage?

› 1. Switch to gpt-6-luna          Fast and affordable model for easier tasks.
  2. Keep current model
  3. Keep current model (never show again)   Hide future reminders.

  enter select · esc back`;
test('Codex rate limit prompt is recognized with the shorter enter select / esc back legend',()=>{
 assert.equal(menuAtBottom(screen),'menu');
 const prompt=parsePrompt(screen);assert.equal(prompt.selected,0);assert.equal(prompt.options.length,3);
 assert.ok(prompt.question.startsWith('Approaching rate limits'));assert.ok(!prompt.question.includes('Previous assistant'));
 assert.ok(prompt.options[1].includes('Keep current model'));assert.deepEqual(choose(prompt.selected,1),['down','enter']);
});
test('both old and new menu legends remain supported without treating normal TUI hints as prompts',()=>{
 assert.equal(menuAtBottom(screen.replace('enter select · esc back','Enter to select · Esc to cancel')),'menu');
 assert.equal(menuAtBottom('› Ask anything\nWorking · esc to interrupt\n← for agents · ? for shortcuts'),null);
 assert.equal(menuAtBottom('↑/↓ to navigate · Enter to confirm'),'menu');
});
test('multi-select checkbox prompts expose checked flags and toggleChoice sends space',()=>{
 const multi=`Pick features to enable
❯ 1. [x] Fast mode
  2. [ ] Audit logging
  3. Type something else
  Enter to confirm · Space to toggle`;
 const q=parsePrompt(multi);
 assert.equal(q.multi,true);
 assert.deepEqual(q.checked,[true,false,false]);
 assert.deepEqual(q.boxes,[true,true,false]);
 assert.deepEqual(q.options,['Fast mode','Audit logging','Type something else']);
 assert.deepEqual(toggleChoice(0,1),['down','space']);
});
test('Codex command approval strips preceding transcript and table scrollback and separates fields',()=>{
 const approval=`› 你知道怎么增强小米音箱的AI chat吗
───────────────────────── MiGPT ──────────
Worked for 26s · 20:06

› xiaogpt 也不用刷机吧

• 对，xiaogpt 不用刷机。它运行在电脑、NAS 等设备上。

  Would you like to run the following command?

  Environment: local
  Reason: 可以允许我通过 SSH 连接 t18，检查环境并部署 xiaogpt 吗？

  $ ssh -o BatchMode=yes -o ConnectTimeout=8 t18 'uname -a; command -v docker; command -v python3; id; pwd'

› 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with \`ssh -o BatchMode=yes\`
  3. No, and tell Codex what to do differently (esc)`;
 const q=parsePrompt(approval);
 assert.ok(q.question.startsWith('Would you like to run the following command?'));
 assert.ok(!q.question.includes('小米音箱'));
 assert.ok(!q.question.includes('Worked for 26s'));
 assert.ok(!q.question.includes('xiaogpt 不用刷机'));
 assert.deepEqual(q.question.split('\n\n'),[
  'Would you like to run the following command?',
  'Environment: local',
  'Reason: 可以允许我通过 SSH 连接 t18，检查环境并部署 xiaogpt 吗？',
  "$ ssh -o BatchMode=yes -o ConnectTimeout=8 t18 'uname -a; command -v docker; command -v python3; id; pwd'",
 ]);
 assert.equal(q.selected,0);
 assert.equal(q.options.length,3);
});
