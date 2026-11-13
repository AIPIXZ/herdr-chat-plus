import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {splitMarkdownTables} from '../mods/chat/table.js';
const main=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8').replace(/^import[\s\S]*?;\n/gm,'').replace('export default class Chat','class Chat');
const tables=readFileSync(new URL('../mods/chat/table-view.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
function setup(dark=true){
 function element(type){const state={type,childNodes:[],attrs:{},handlers:{}};let proxy;
  proxy=new Proxy(state,{get:(target,key)=>key in target?target[key]:(...args)=>{
   if(key==='when'){if(args[0])args[1](proxy);}
   else if(key==='child')state.childNodes.push(args[0]);
   else if(key==='children')state.childNodes.push(...args[0]);
   else if(key==='on_mouse_down')state.handlers.down=args[1];
   else if(key==='on_click')state.handlers.click=args[0];
   else state.attrs[key]=args.length===1?args[0]:args;
   return proxy;
  }});return proxy;
 }
 let opened=0;const t={background:'#111',surface:'#222',border:'#333',foreground:'#eee',muted:'#aaa',dim:'#888',raised:'#444'};
 const context={View:class{},appWindow:()=>({platform:'macos'}),div:()=>element('div'),v_flex:()=>element('column'),h_flex:()=>element('row'),image:()=>element('image'),settings:()=>({dark}),theme:()=>t,splitMarkdownTables,
 TextView:{markdown:()=>element('markdown')},openOverlay:()=>opened++};
 const renderTable=runInNewContext(tables+'\nrenderTable',context);
 const Chat=runInNewContext(main+'\nChat',{...context,renderTable});
 const view=Object.assign(Object.create(Chat.prototype),{attach:[],images:{}});
 return {view,t,opened:()=>opened};
}
test('attachment close blocks the image underneath on both press and click',()=>{
 const s=setup();const file={image:{ref:'pic'}};s.view.attach=[file];s.view.images.pic={rel:'a.png',abs:'/a.png',w:100,h:80};
 const node=s.view.attachmentPreview(file,0,s.t),preview=node.childNodes[0],close=node.childNodes[1];
 let stopped=false;const cx={stop_propagation(){stopped=true;},notify(){}};
 close.handlers.down({},cx);assert(stopped);
 stopped=false;close.handlers.click({},cx);if(!stopped)preview.handlers.click({},cx);
 assert(stopped);assert.equal(s.view.attach.length,0);assert.equal(s.opened(),0);
 preview.handlers.click({},cx);assert.equal(s.opened(),1);
});
test('stale attachment buttons remove their own file rather than another file at an old index',()=>{
 const s=setup(),a={name:'a'},b={name:'b'},c={name:'c'};s.view.attach=[a,b,c];
 const first=s.view.attachmentPreview(a,0,s.t).childNodes[1],second=s.view.attachmentPreview(b,1,s.t).childNodes[1];
 const cx={stop_propagation(){},notify(){}};
 first.handlers.click({},cx);second.handlers.click({},cx);
 assert.deepEqual(s.view.attach,[c]);
});
test('non-reply Markdown tables also receive rounded borders and corner-safe body backgrounds',()=>{
 for(const dark of [true,false]){
  const s=setup(dark),root=s.view.markdown('any-markdown','| A | B |\n| - | - |\n| one | two |');
  const table=root.childNodes[0];assert.equal(table.attrs.rounded,10);assert.equal(table.attrs.border,dark?1:0.5);
  assert.equal(table.attrs.bg,s.t.background);assert.equal(table.childNodes[0].attrs.rounded_t,9);
  assert.equal(table.childNodes[1].attrs.bg,undefined);
 }
});
test('code fences containing pipes keep their native Markdown code rendering',()=>{
 const s=setup();assert.equal(s.view.markdown('code','```text\n| A | B |\n| - | - |\n```').type,'markdown');
});
