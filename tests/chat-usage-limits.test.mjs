import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const source=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace('export default class Chat','class Chat');
const parse=readFileSync(new URL('../mods/chat/parse.js',import.meta.url),'utf8');
const {Transcript}=await import('data:text/javascript;base64,'+Buffer.from(parse).toString('base64'));
const quota=pct=>({primary:{used_percent:pct},secondary:{used_percent:pct+1}});
function setup({saved=null,sharedState=new Map(),query,claude}={}){
 let now=1000000,calls=0;const tasks=[],store=new Map(),routes=[];
 if(saved)store.set('limits1:codex|',JSON.stringify(saved));
 function el(){const state={childNodes:[]};let proxy;proxy=new Proxy(state,{get:(target,key)=>key in target?target[key]:(...args)=>{
  if(key==='id')state.elementId=args[0];
  else if(key==='child')state.childNodes.push(args[0]);else if(key==='children')state.childNodes.push(...args[0]);
  else if(key==='tooltip')state.tip=args[0];else if(key==='when'){if(args[0])args[1](proxy);}return proxy;
 }});return proxy;}
 class Clock extends Date{static now(){return now;}}
 const {Chat,usageSnapshot}=runInNewContext(source+'\n({Chat,usageSnapshot})',{
 View:class{},appWindow:()=>({platform:'macos'}),Date:Clock,div:el,h_flex:el,
 machineOf:address=>address?.includes('/')?address.split('/')[0]:null,
 shared:key=>sharedState.get(key)??null,
 setShared:(key,value)=>sharedState.set(key,value),
 localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value)},
 codexCalls:async(folder,requests,on)=>{calls++;routes.push({folder,on});return query?query(calls):[{rateLimits:quota(20)}];},
 control:async(...args)=>{calls++;return claude?claude(...args):[{rate_limits:{five_hour:{utilization:30}}}];},
 });
 const term={address:'t1',cwd:'/repo',foreground:{pid:42}};
 const createView=(addr='t2',t=null)=>{
  const inst=Object.create(Chat.prototype);Object.defineProperty(inst,'term',{value:addr,writable:true});
  return Object.assign(inst,{terminal:()=>({address:addr,cwd:'/repo',foreground:{pid:43}}),t});
 };
 const instance=Object.create(Chat.prototype);Object.defineProperty(instance,'term',{value:'t1',writable:true});
 const view=Object.assign(instance,{terminal:()=>term,t:{limits:quota(90),limitsTimestamp:1000}});
 const cx={notify(){},spawn(fn){tasks.push(fn(cx));}};
 return {view,term,cx,store,sharedState,routes,createView,snapshot:usageSnapshot,advance:ms=>now+=ms,calls:()=>calls,
 flush:async()=>{for(let i=0;i<tasks.length;i++)await tasks[i];}};
}
test('a historical log snapshot cannot skip account queries or override a fresh account result',async()=>{
 const s=setup({saved:quota(80)});s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 assert.equal(s.calls(),1);assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,20);
 const saved=JSON.parse(s.store.get('limits1:codex|'));assert.equal(saved.fetchedAt,1000000);assert.equal(saved.source,'api');
 s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();assert.equal(s.calls(),1);
 assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,20);
 const badge=s.view.contextBadge({border:'#333',input:'#444',muted:'#aaa'});
 assert.match(badge.childNodes[0].tip,/5h limit: 80% remaining/);
});
test('Codex continues polling after three minutes even when its transcript always contains limits',async()=>{
 const s=setup({query:n=>[{rateLimits:quota(n*10)}]});s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 s.advance(180001);s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 assert.equal(s.calls(),2);assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,20);
});
test('each new binding forces refresh but repeatedly confirming the same binding does not',async()=>{
 const s=setup();s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 s.view.refreshUsageBinding(s.term,'codex','session-a.jsonl',null,s.cx);await s.flush();assert.equal(s.calls(),2);
 s.view.refreshUsageBinding(s.term,'codex','session-a.jsonl',null,s.cx);await s.flush();assert.equal(s.calls(),2);
 s.view.refreshUsageBinding(s.term,'codex','session-b.jsonl',null,s.cx);await s.flush();assert.equal(s.calls(),3);
});
test('binding while an account request is running queues one forced refresh instead of losing it',async()=>{
 let resolve;const waiting=new Promise(done=>resolve=done);
 const s=setup({query:n=>n===1?waiting:[{rateLimits:quota(15)}]});
 s.view.loadUsageLimits(s.term,'codex',s.cx);
 s.view.refreshUsageBinding(s.term,'codex','session-a.jsonl',null,s.cx);
 resolve([{rateLimits:quota(20)}]);await s.flush();assert.equal(s.calls(),2);
 assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,15);
});
test('failed queries preserve the best snapshot and retry after thirty seconds without a polling storm',async()=>{
 const s=setup({query:n=>n===1?Promise.reject(new Error('offline')):[{rateLimits:quota(10)}]});
 s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,90);
 s.advance(29999);s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();assert.equal(s.calls(),1);
 s.advance(1);s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();assert.equal(s.calls(),2);
 assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,10);
});
test('a late account response cannot write to a different terminal or machine context',async()=>{
 let resolve;const waiting=new Promise(done=>resolve=done);
 const s=setup({query:n=>n===1?waiting:[{rateLimits:quota(10)}]});
 s.view.loadUsageLimits(s.term,'codex',s.cx);
 const remote={address:'alias/t2',cwd:'/remote/repo',foreground:{pid:99}};
 s.view.term=remote.address;s.view.terminal=()=>remote;s.view.t=null;
 s.view.loadUsageLimits(remote,'codex',s.cx);
 resolve([{rateLimits:quota(95)}]);await s.flush();
 assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,10);assert.equal(s.routes[1].on,'alias');
 assert.equal(JSON.parse(s.store.get('limits1:codex|alias')).limits.fiveHour.pct,10);
});
test('newly recorded log data may update progress, but does not disable completion refresh',async()=>{
 const s=setup();s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();s.advance(1000);
 s.view.t={limits:quota(40),limitsTimestamp:1001000,codexTurn:{stage:'working',epoch:2}};
 s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();assert.equal(s.calls(),1);
 assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,40);
 s.advance(1000);s.view.t.codexTurn.stage='completed';s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 assert.equal(s.calls(),2);assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,20);
});
test('Claude account refresh also records timestamped data and supersedes a legacy cache',async()=>{
 const s=setup();s.view.t=null;s.view.loadUsageLimits(s.term,'claude',s.cx);await s.flush();
 assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,30);
 assert.equal(JSON.parse(s.store.get('limits1:claude|')).source,'api');
});
test('future log clocks cannot pin a historical quota ahead of account queries',async()=>{
 const s=setup();s.view.t.limitsTimestamp=9999999999;
 s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 assert.equal(s.view.currentUsageSnapshot().source,'api');assert.equal(s.view.currentUsageSnapshot().limits.fiveHour.pct,20);
});
test('the transcript retains rate-limit event time rather than the time an old log is loaded',()=>{
 const t=new Transcript('codex');t.feed(JSON.stringify({type:'event_msg',timestamp:'2026-11-01T00:00:00Z',payload:{type:'token_count',rate_limits:quota(80)}}));
 assert.equal(t.limitsTimestamp,Date.parse('2026-11-01T00:00:00Z'));
});
test('expired historical log rate limits whose resets_at passed are reset on binding',async()=>{
 const s=setup({query:()=>new Promise(()=>{})});
 s.view.t={limits:{primary:{used_percent:95,resets_at:900},secondary:{used_percent:60,resets_at:2000}},limitsTimestamp:500000};
 s.view.loadUsageLimits(s.term,'codex',s.cx);
 const snap=s.view.currentUsageSnapshot();
 assert.equal(snap.limits.fiveHour.pct,0);
 assert.equal(snap.limits.fiveHour.resetsAt,null);
 assert.equal(snap.limits.sevenDay.pct,60);
});
test('fresh API limits are shared via chat.usageLimits across independent Chat instances',async()=>{
 const sharedState=new Map();
 const first=setup({sharedState,query:()=>[{rateLimits:quota(24)}]});
 first.view.loadUsageLimits(first.term,'codex',first.cx);
 await first.flush();
 const second=setup({sharedState,query:()=>new Promise(()=>{})});
 second.view.t={limits:{primary:{used_percent:95,resets_at:900},secondary:{used_percent:65,resets_at:2000}},limitsTimestamp:500000};
 second.view.loadUsageLimits(second.term,'codex',second.cx);
 const snap=second.view.currentUsageSnapshot();
 assert.equal(snap.source,'api');
 assert.equal(snap.limits.fiveHour.pct,24);
 assert.equal(snap.limits.sevenDay.pct,25);
});
test('contextBadge keys each ring element id by percentage to force GPUI repaint',async()=>{
 const s=setup({query:()=>[{rateLimits:quota(24)}]});
 s.view.loadUsageLimits(s.term,'codex',s.cx);await s.flush();
 const badge=s.view.contextBadge({border:'#333',input:'#444',muted:'#aaa'});
 assert.equal(badge.childNodes[0].childNodes[0].elementId,'limit-5h-badge-ring-24');
 assert.equal(badge.childNodes[1].childNodes[0].elementId,'limit-7d-badge-ring-25');
});
