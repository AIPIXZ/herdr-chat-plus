import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
const identity=readFileSync(new URL('../mods/chat/identity.js',import.meta.url),'utf8');
const {localId,qualifyAddress}=await import('data:text/javascript;base64,'+Buffer.from(identity).toString('base64'));
const source=readFileSync(new URL('../mods/chat/presentation.js',import.meta.url),'utf8');
const tree=JSON.parse(readFileSync(new URL('../layouts/chat.json',import.meta.url)));
const target={pane:'connection/p-agent',tab:'connection/tb-work',terminal:'connection/t14'};
const all=[target,{pane:'connection/p-other',tab:target.tab,terminal:'connection/t15'},
 {pane:'connection/p-old',tab:target.tab,mod:'chat'}];
function setup(list=[target]){
 let local=structuredClone(tree);const calls=[];const state=new Map();
 const api=runInNewContext(source.replace(/^import .*;\n/gm,'').replace(/\bexport /g,'')+'\n({openChat,showTerminal,findNode,viewLayout,presentationPane,presentationVisible,activePage,pageMeta,splitViewLayout,commandTargets})',{
  localId,qualifyAddress,panes:()=>list,layout:()=>local,shared:key=>key==='layout'?'chat':state.get(key),setShared:(key,value)=>state.set(key,value),
  exec:async()=>({code:0,stdout:JSON.stringify({id:"tb-work",type:"row",children:list.filter(p=>p.tab===target.tab).map(p=>({id:localId(p.pane),type:"block",size:{weight:0.5},content:p.terminal?{terminal:localId(p.terminal)}:{mod:p.mod}}))})}),
  herdr:async(command,args)=>{calls.push({command,args});if(command==='layout.set')local=args.layout;
   if(command==='layout.select')api.findNode(local,args.stack).active=args.child;},
 });
 return {api,calls,get tree(){return local;}};
}
test('Chat fills a local layout slot while all shared split panes stay unchanged',async()=>{
 const before=JSON.stringify(all),s=setup();await s.api.openChat(target);
 assert.deepEqual(s.calls.map(c=>c.command),['layout.set','chat.focus']);
 assert.equal(s.api.findNode(s.tree,'conversation-view').active,'conversation-page-tb-work-p-agent-t14');
 assert.equal(JSON.stringify(all),before);
 const meta=s.api.pageMeta(s.api.activePage(s.tree));
 assert.deepEqual(JSON.parse(JSON.stringify(meta)),{presentation:true,terminal:'t14',owner_tab:'tb-work',owner_pane:'p-agent'});
 assert.deepEqual(meta,s.api.activePage(s.tree).children.find(c=>c.content?.mod==='chat-pane').content.props);
 assert(s.api.findNode(s.tree,'main').content.tab==='active');
});
test('returning to TUI restores original context tree and focus without zooming or splitting',async()=>{
 const s=setup();const original=JSON.stringify(s.api.findNode(s.tree,'main'));
 await s.api.openChat(target);await s.api.showTerminal(target);
 assert.equal(s.api.findNode(s.tree,'conversation-view').active,'main');
 assert.equal(JSON.stringify(s.api.findNode(s.tree,'main')),original);
 assert.deepEqual(s.calls.map(c=>c.command),['layout.set','chat.focus','layout.select','pane.focus']);
 assert.equal(s.calls[3].args.pane,target.pane);
});
test('multiple terminals stay visible and switch independently without shared pane mutations',async()=>{
 const s=setup(all);await s.api.openChat(target);
 const page=s.api.activePage(s.tree);
 assert.equal(page.type,'row');assert.equal(page.children.length,3);
 const meta=s.api.pageMeta(page.children[0]);
 const other=s.api.pageMeta(page.children[1]);
 assert(s.api.presentationVisible(s.tree,meta));assert(!s.api.presentationVisible(s.tree,other));
 assert(s.api.commandTargets(meta));assert(!s.api.commandTargets(other));
 assert.equal(page.children[1].children[1].children[0].content.terminal,'connection/t15');
 await s.api.openChat(all[1]);
 assert(s.api.presentationVisible(s.tree,meta));assert(s.api.presentationVisible(s.tree,other));
 assert(!s.api.commandTargets(meta));assert(s.api.commandTargets(other));
 await s.api.showTerminal(target);
 assert(!s.api.presentationVisible(s.tree,meta));assert(s.api.presentationVisible(s.tree,other));
 assert.equal(s.calls.at(-1).args.terminal,'connection/t14');
 await s.api.showTerminal(all[1]);assert.equal(s.api.findNode(s.tree,'conversation-view').active,'main');
 assert(s.calls.every(c=>!c.command.startsWith('terminal.')&&!['pane.split','pane.zoom','pane.close','tab.close'].includes(c.command)));
});
test('runtime identity follows the owning pane current connection alias, not a saved alias',()=>{
 const s=setup();const meta={terminal:'old/t14',owner_tab:'tb-work',owner_pane:'p-agent'};
 assert.equal(s.api.presentationPane(meta,all),target);
 const renamed=all.map(p=>({...p,pane:p.pane.replace('connection/','new/'),tab:p.tab.replace('connection/','new/'),terminal:p.terminal?.replace('connection/','new/')}));
 assert.equal(s.api.presentationPane(meta,renamed).terminal,'new/t14');
 assert.equal(s.api.presentationPane(meta,[...all,{...target,pane:'other/p-agent',tab:'other/tb-work',terminal:'other/t14'}]),null);
});
test('missing or stale terminal targets fail before changing local layout',async()=>{
 const s=setup([]);await assert.rejects(s.api.openChat(target),/no longer available/);assert.equal(s.calls.length,0);
 await s.api.showTerminal(target);assert.deepEqual(s.calls.map(c=>c.command),['layout.select']);
});
test('presentation scripts are identical in isolated mods',()=>{
 for(const name of ['chat-pane','chat-tabs'])assert.equal(source,readFileSync(new URL(`../mods/${name}/presentation.js`,import.meta.url),'utf8'));
});
const chatSource=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
const classSource=chatSource.replace(/^import[\s\S]*?;\n/gm,'').replace('export default class Chat','class Chat');
test('local Chat resolves the original terminal pane and sleeps outside its selected layout/tab',()=>{
 const s=setup();let selected=true,active=target.tab;
 const Chat=runInNewContext(classSource+'\nChat',{View:class{},appWindow:()=>({platform:'macos'}),
  presentationPane:s.api.presentationPane,presentationVisible:()=>selected,qualifyAddress,layout:()=>s.tree,
  panes:()=>all,spaces:()=>[{active:true,tabs:[{id:active,active:true}]}]});
 const view=Object.create(Chat.prototype);Object.assign(view,{presentation:true,terminalId:'t14',owner:{terminal:'t14',owner_tab:'tb-work',owner_pane:'p-agent'}});
 assert.equal(view.myPane(),target);assert.equal(view.term,'connection/t14');assert.equal(view.chatVisible(),true);
 selected=false;assert.equal(view.chatVisible(),false);selected=true;active='other';assert.equal(view.chatVisible(),false);
});
test('Chat consumes configured pane split and structure shortcuts without intercepting ordinary chat keys',()=>{
 const start=chatSource.indexOf('      if (this.presentation) {\n        const blocked = keys()');
 const end=chatSource.indexOf('\n      cx.bind_keys([',start);
 const calls=[];
 runInNewContext(chatSource.slice(start,end),{presentation:true,keys:()=>[
  {keys:'cmd-d',action:'pane.split:right'},{keys:'ctrl-x',action:'pane.split:down'},
  {keys:'cmd-shift-w',action:'pane.close'},{keys:'cmd-f',action:'chat.search'},
 ],cx:{bind_keys:list=>calls.push(...list)}});
 assert.deepEqual(calls.map(b=>b.keystroke),['cmd-d','ctrl-x','cmd-shift-w']);
 assert(calls.every(b=>b.context==='ChatPresentation'&&b.action==='chat_no_split'));
});

test('each terminal retains stable block IDs and props across repeated Chat selections',async()=>{
 const other={...all[1],tab:"connection/tb-other"};
 const s=setup([target,other]);await s.api.openChat(target);
 const first=JSON.parse(JSON.stringify(s.api.activePage(s.tree)));
 await s.api.openChat(other);
 assert.notEqual(s.api.activePage(s.tree).id,first.id);
 assert.deepEqual(JSON.parse(JSON.stringify(s.api.findNode(s.tree,first.id))),first);
 await s.api.openChat(target,{started:true});
 assert.deepEqual(JSON.parse(JSON.stringify(s.api.activePage(s.tree))),first);
 assert.equal(s.api.findNode(s.tree,'conversation-view').children.length,4);
 assert.equal(s.api.presentationVisible(s.tree,s.api.pageMeta(s.api.activePage(s.tree))),true);
 assert.equal(s.api.presentationVisible(s.tree,{owner_tab:'other',owner_pane:'other',terminal:'t14'}),false);
});
test('Chat frame matches the terminal ordinary border without its focus accent',()=>{
 const s=setup();const frame=s.api.findNode(s.tree,'main').content.pane;
 frame.border={width:2,color:'border'};frame.radius=12;frame.background='surface';frame.focus={width:2,color:'accent'};
 const next=s.api.viewLayout(s.tree,target),page=s.api.activePage(next);
 assert.deepEqual(JSON.parse(JSON.stringify(page.border)),frame.border);assert.equal(page.radius,12);assert.equal(page.background,'surface');assert.equal(page.focus,undefined);
});
test('existing retained Chat gets an updated terminal frame without changing its identity',async()=>{
 const s=setup();await s.api.openChat(target);const id=s.api.activePage(s.tree).id;
 await s.api.showTerminal(target);s.api.findNode(s.tree,'main').content.pane.radius=14;
 await s.api.openChat(target);assert.equal(s.api.activePage(s.tree).id,id);assert.equal(s.api.activePage(s.tree).radius,14);
 assert.equal(s.calls.at(-2).command,'layout.set');
});

test('nested split directions, ratios, remote siblings and local resize survive a pane mode toggle',()=>{
 const s=setup(all);
 const root={id:'tb-work',type:'column',children:[
  {id:'p-agent',type:'block',size:{weight:0.3},min:120,content:{terminal:'t14'}},
  {id:'nested',type:'row',size:{weight:0.7},children:[
   {id:'p-other',type:'block',size:{weight:0.6},content:{terminal:'t15'}},
   {id:'p-old',type:'block',size:{weight:0.4},content:{mod:'chat',props:{terminal:'t16'}}},
  ]},
 ]};
 const before=JSON.stringify(root);
 const next=s.api.splitViewLayout(s.tree,target,root);
 const page=s.api.activePage(next);
 assert.equal(page.type,'column');assert.equal(page.children[1].type,'row');
 assert.equal(page.children[0].size.weight,0.3);assert.equal(page.children[0].min,120);
 assert.equal(page.children[1].size.weight,0.7);assert.equal(page.children[1].children[0].size.weight,0.6);
 page.children[0].size={weight:0.45};
 const again=s.api.splitViewLayout(next,all[1],root);
 assert.equal(s.api.activePage(again).children[0].size.weight,0.45);
 assert.equal(JSON.stringify(root),before);
 assert.throws(()=>s.api.splitViewLayout(next,target,{...root,children:root.children.slice(0,1)}),/split changed/);
});
