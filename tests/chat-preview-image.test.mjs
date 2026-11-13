import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const source=readFileSync(new URL('../mods/chat-preview/image-preview.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
const main=readFileSync(new URL('../mods/chat-preview/main.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default class Preview','class Preview');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rLkAAAAASUVORK5CYII=','base64');
function loader(overrides={}){
 const calls=[],writes=[];
 const api=runInNewContext(source+'\n({isImageFile,loadPreviewImage,IMAGE_READ_PY})',{
  exec:async(...args)=>{calls.push(args);return {code:0,stdout:png.toString('base64'),stderr:''};},
  appHome:()=>'/app',fs:{mkdir:async()=>{},writeFile:async(path,data)=>writes.push({path,data})},Buffer,createHash,imageSize:async()=>({w:1,h:1}),...overrides,
 });return {...api,calls,writes};
}
test('image bytes are read on the owner machine and cached as binary, never decoded as text',async()=>{
 const s=loader(),result=await s.loadPreviewImage('/remote/my image.PNG','connection-alias');
 assert.equal(s.calls[0][0],'python3');assert.equal(s.calls[0][1][2],'/remote/my image.PNG');assert.equal(s.calls[0][2].on,'connection-alias');
 assert(s.writes[0].data.equals(png));assert(result.rel.startsWith('data/chat-preview/images/'));assert.equal(result.w,1);assert.equal(result.h,1);
 assert.equal(s.isImageFile('/a.JPG'),true);assert.equal(s.isImageFile('/a.md'),false);
});
test('the binary reader preserves a PNG and gives a clear error for oversized input',()=>{
 const s=loader(),folder=mkdtempSync(join(tmpdir(),'herdr-image-preview-'));
 try{
  const path=join(folder,'image.png');writeFileSync(path,png);
  const encoded=execFileSync('python3',['-c',s.IMAGE_READ_PY,path,String(png.length)],{encoding:'utf8'}).trim();
  assert(Buffer.from(encoded,'base64').equals(png));
  assert.throws(()=>execFileSync('python3',['-c',s.IMAGE_READ_PY,path,'1'],{stdio:'pipe'}),/Command failed/);
 }finally{rmSync(folder,{recursive:true,force:true});}
});
function view(overrides={}){
 const tasks=[];let textReads=0;
 const Preview=runInNewContext(main+'\nPreview',{View:class{},isImageFile:loader().isImageFile,loadPreviewImage:async()=>({rel:'cache.png',w:1,h:1}),
 readTextFile:async()=>{textReads++;return 'hello';},theme:()=>({}),settings:()=>({}),EditorState:{new:()=>({release(){}})},...overrides});
 const instance=new Preview();instance.init();
 const cx={notify(){},spawn(fn){tasks.push(fn(cx));}};
 return {instance,cx,tasks,textReads:()=>textReads};
}
test('the sidebar branches to image preview before invoking readTextFile, including persisted Source mode',async()=>{
 const s=view();s.instance.open({file:'/repo/image.png',mode:'source',on:'alias'},s.cx);await Promise.all(s.tasks);
 assert.equal(s.textReads(),0);assert.equal(s.instance.picture.rel,'cache.png');assert.equal(s.instance.error,null);
 s.instance.open({file:'/repo/a.md',mode:'preview',on:'alias'},s.cx);await Promise.all(s.tasks);
 assert.equal(s.instance.picture,null);assert.equal(s.instance.text,'hello');
});
test('a stale remote image response cannot replace a newer text preview',async()=>{
 let resolve;const waiting=new Promise(done=>resolve=done),s=view({loadPreviewImage:()=>waiting});
 s.instance.open({file:'/repo/image.png',mode:'source'},s.cx);
 s.instance.open({file:'/repo/a.md',mode:'preview'},s.cx);
 await s.tasks[1];resolve({rel:'stale.png'});await Promise.all(s.tasks);
 assert.equal(s.instance.picture,null);assert.equal(s.instance.text,'hello');
});
test('unrecognized binary files show a readable unsupported-preview message',async()=>{
 const s=view({readTextFile:async()=>{throw new Error('herdr.readTextFile: stream did not contain valid UTF-8');}});
 s.instance.open({file:'/repo/binary.dat',mode:'source'},s.cx);await Promise.all(s.tasks);
 assert.equal(s.instance.error,'Binary or non-UTF-8 file · no text preview');
});
