import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
const source=readFileSync(new URL('../mods/chat-file/main.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export default class ChatFile/,'class ChatFile').replace(/export /g,'');
const p={imageWidth:1000,imageHeight:500};
const {imageFit,imageBounds,ChatFile}=runInNewContext(source+'\n({imageFit,imageBounds,ChatFile})',{View:class {},props:()=>p});
test('initial fit preserves aspect ratio and does not upscale small originals',()=>{
 assert.equal(imageFit({width:524,height:324},1000,500),.5);
 assert.equal(imageFit({width:900,height:680},100,50),1);
});
test('small images stay centered and large image panning stays within bounds',()=>{
 const v={width:524,height:324};
 const small=imageBounds(v,100,50,1,{x:300,y:-100});assert.equal(small.x,0);assert.equal(small.y,0);assert.equal(small.left,212);
 const large=imageBounds(v,1000,500,2,{x:1e5,y:-1e5});assert.equal(large.left,12);assert.equal(large.top,v.height-12-large.height);
});
function view(){const v=Object.create(ChatFile.prototype);v.viewport={width:524,height:324};v.imageScale=null;v.imageOffset={x:0,y:0};return v;}
test('zoom keeps the image point beneath the cursor stationary',()=>{
 const v=view();v.zoomImage(1,{notify(){}},{x:362,y:162});
 assert.equal(v.imageScale,1);assert.equal(v.imageOffset.x,-100);assert.equal(v.imageOffset.y,0);
});
test('zoom respects limits and actual size remains available',()=>{
 const v=view();v.zoomImage(100,{notify(){}});assert.equal(v.imageScale,8);
 v.zoomImage(.001,{notify(){}});assert.equal(v.imageScale,.1);
 v.zoomImage(1,{notify(){}});assert.equal(v.imageScale,1);
});
test('image preview window avoids outer rectangular clipping and exposes icon copy controls',()=>{
 const raw=readFileSync(new URL('../mods/chat-file/main.js',import.meta.url),'utf8');
 const chatRaw=readFileSync(new URL('../mods/chat/main.js',import.meta.url),'utf8');
 const previewRaw=readFileSync(new URL('../mods/chat-preview/main.js',import.meta.url),'utf8');
 assert.match(raw,/id\("image-overlay-pad"\)/);
 assert.doesNotMatch(raw,/id\("image-window"\)\.size_full\(\)\.rounded\(18\)\.overflow_hidden\(\)/);
 assert.match(raw,/id\("image-viewport"\)[\s\S]*\.rounded\(12\)\.overflow_hidden\(\)/);
 assert.match(raw,/id\("image-zoom-controls"\)[\s\S]*button\("image-copy",\s*svg\(this\.imageCopied \? "mods\/chat-file\/check\.svg" : "mods\/chat-file\/copy\.svg"\)/);
 assert.doesNotMatch(raw,/"Copy image"|"Copy"|"Copied"/);
 assert.doesNotMatch(raw,/id\("image-context-menu"\)[^\n]*\.bg\(/);
 assert.match(raw,/id\("menu-copy-image"\)\.w\(34\)\.h\(34\)\.rounded\(8\)/);
 assert.match(raw,/id\("image-context-copy"\)[\s\S]*\.w\(34\)\.h\(34\)\.rounded\(8\)/);
 assert.match(raw,/\.on_mouse_down\("right",\s*\(event,\s*cx\)\s*=>\s*\{[\s\S]*event\.local_position[\s\S]*this\.imageMenuAt/);
 assert.doesNotMatch(raw,/id\("image-viewport"\)[\s\S]*\.on_mouse_down\("right"[\s\S]*?openOverlay/);
 assert.doesNotMatch(raw,/View image|Open image|Scroll to zoom/);
 const viewportHeader=raw.slice(raw.indexOf('id("image-viewport")'),raw.indexOf('.on_size_change',raw.indexOf('id("image-viewport")')));
 const chatImgFn=chatRaw.slice(chatRaw.indexOf('img(ref, t'),chatRaw.indexOf('openFilePreview(',chatRaw.indexOf('img(ref, t')));
 const previewImgFn=previewRaw.slice(previewRaw.indexOf('imagePreview(t)'),previewRaw.indexOf('markdownPreview(',previewRaw.indexOf('imagePreview(t)')));
 assert.doesNotMatch(viewportHeader,/\.tooltip\(/);
 assert.doesNotMatch(chatImgFn,/\.tooltip\(/);
 assert.doesNotMatch(previewImgFn,/\.tooltip\(/);
 assert.match(raw,/chat_image_copy/);
});
