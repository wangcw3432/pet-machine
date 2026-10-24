import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {buildGeometry} from './mooncove-geometry.mjs';

const out = path.dirname(fileURLToPath(import.meta.url));
const parts = [];
const C = {shell:[0.89,0.87,0.80],sage:[0.66,0.71,0.58],dark:[0.13,0.17,0.16],steel:[0.72,0.73,0.71],gold:[0.77,0.55,0.26],pcb:[0.10,0.36,0.28]};
function mesh(name,color,rings,center=[0,0],opts={}) {
  const p=[],idx=[],segments=opts.segments||96;
  for(const [z,rx,ry,exponent=2] of rings) for(let j=0;j<segments;j++) {
    const a=j/segments*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
    const point=[center[0]+rx*Math.sign(c)*Math.abs(c)**(2/exponent),center[1]+ry*Math.sign(s)*Math.abs(s)**(2/exponent),z];
    p.push(...(opts.transform?opts.transform(point,a):point));
  }
  for(let k=0;k<rings.length-1;k++) for(let j=0;j<segments;j++) {
    if(opts.omit?.(k,j,rings))continue;
    const a=k*segments+j,b=k*segments+(j+1)%segments,c=b+segments,d=a+segments;
    idx.push(a,b,c,a,c,d);
  }
  return addMesh(name,color,p,idx,opts);
}
function addMesh(name,color,p,idx,opts={}) {
  const n=new Array(p.length).fill(0);
  for(let t=0;t<idx.length;t+=3) {
    const [a,b,c]=idx.slice(t,t+3).map(i=>i*3);
    const u=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]],v=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const q=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    for(const at of [a,b,c]) for(let d=0;d<3;d++) n[at+d]+=q[d];
  }
  for(let i=0;i<n.length;i+=3) {const len=Math.hypot(...n.slice(i,i+3))||1;for(let d=0;d<3;d++)n[i+d]/=len;}
  const {transform,omit,segments,...metadata}=opts;
  const part={name,color,p,n,idx,...metadata};
  parts.push(part);
  return part;
}
function oval(name,color,x,y,z,rx,ry,h,opts={}) {
  mesh(name,color,[[z,0,0],[z,rx-3,ry-3],[z+3,rx,ry],[z+h-3,rx,ry],[z+h,rx-3,ry-3],[z+h,0,0]],[x,y],opts);
}
const dimensions=buildGeometry({mesh,addMesh,oval,C});

// A +Y front camera sees world -X on screen right. Mirror geometry, normals,
// winding and exploded offsets together to match the reference's right-hand bowl.
for(const part of parts){
  for(let i=0;i<part.p.length;i+=3){part.p[i]*=-1;part.n[i]*=-1;}
  for(let i=0;i<part.idx.length;i+=3)[part.idx[i+1],part.idx[i+2]]=[part.idx[i+2],part.idx[i+1]];
  if(part.explode)part.explode[0]*=-1;
}
for(const part of parts){
  if(!part.p.every(Number.isFinite)||!part.n.every(Number.isFinite))throw Error('Non-finite mesh: '+part.name);
  if(part.idx.some(i=>i<0||i>=part.p.length/3))throw Error('Invalid mesh index: '+part.name);
}

// GLB uses metres and Y-up; the editable concept uses millimetres and Z-up.
let blobs=[],byteOffset=0;
const gltf={asset:{version:'2.0',generator:'MOONCOVE V0.3; concept only, not manufacturing geometry'},scene:0,scenes:[{name:'Exterior V0.3',nodes:[]},{name:'Layout envelopes - unverified',nodes:[]}],nodes:[],meshes:[],materials:[],buffers:[{byteLength:0}],bufferViews:[],accessors:[]};
function addBuffer(data,type,componentType,count,min,max,target) {
  const buf=Buffer.from(data.buffer,data.byteOffset,data.byteLength),pad=(4-buf.length%4)%4;
  const view=gltf.bufferViews.length;gltf.bufferViews.push({buffer:0,byteOffset,byteLength:buf.length,target});
  blobs.push(buf,Buffer.alloc(pad));byteOffset+=buf.length+pad;
  const a={bufferView:view,componentType,count,type};if(min)a.min=min;if(max)a.max=max;
  return gltf.accessors.push(a)-1;
}
for(const part of parts) {
  const p=[],n=[];
  for(let i=0;i<part.p.length;i+=3) {p.push(part.p[i]/1000,part.p[i+2]/1000,-part.p[i+1]/1000);n.push(part.n[i],part.n[i+2],-part.n[i+1]);}
  const min=[0,1,2].map(d=>Math.min(...p.filter((_,i)=>i%3===d))),max=[0,1,2].map(d=>Math.max(...p.filter((_,i)=>i%3===d)));
  const pos=addBuffer(new Float32Array(p),'VEC3',5126,p.length/3,min,max,34962);
  const normal=addBuffer(new Float32Array(n),'VEC3',5126,n.length/3,null,null,34962);
  const indices=addBuffer(new Uint16Array(part.idx),'SCALAR',5123,part.idx.length,null,null,34963);
  const mat=gltf.materials.push({name:part.name,pbrMetallicRoughness:{baseColorFactor:[...part.color,1],metallicFactor:part.color===C.steel?0.65:0,roughnessFactor:0.55},doubleSided:true})-1;
  const mi=gltf.meshes.push({name:part.name,primitives:[{attributes:{POSITION:pos,NORMAL:normal},indices,material:mat}]})-1;
  const ni=gltf.nodes.push({name:part.name,mesh:mi})-1;
  if(part.role!=='inside')gltf.scenes[0].nodes.push(ni);
  gltf.scenes[1].nodes.push(ni);
}
gltf.buffers[0].byteLength=byteOffset;
let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const bin=Buffer.concat(blobs),head=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);
head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(28+json.length+bin.length,8);
jh.writeUInt32LE(json.length,0);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
fs.writeFileSync(`${out}/MOONCOVE-3D.glb`,Buffer.concat([head,jh,json,bh,bin]));

const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>月湾 MOONCOVE · 三维概念设计</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#eeece5;color:#273c32;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
header{padding:26px 4vw;border-bottom:1px solid #cbd1c5;display:flex;justify-content:space-between;align-items:center}
.brand{font-size:19px;letter-spacing:3px}.small{font-size:11px;letter-spacing:2px;color:#6c7a6b}main{display:grid;grid-template-columns:1fr 320px;min-height:calc(100vh - 86px)}
.stage{position:sticky;top:0;height:calc(100vh - 80px);min-height:630px;overflow:hidden;background:radial-gradient(ellipse at 45% 55%,#faf9f3,#e0e4da)}
canvas{width:100%;height:calc(100% - 145px);position:absolute;inset:145px 0 0;touch-action:none;cursor:grab}canvas:active{cursor:grabbing}
.intro{position:absolute;top:24px;left:4vw;pointer-events:none}h1{font-size:28px;line-height:1.06;font-weight:500;margin:12px 0}h1 br{display:none}.intro p{font-size:12px;color:#687563;line-height:1.6}
.hint{position:absolute;bottom:24px;left:4vw;font-size:12px;color:#5d6c5b;background:#eeece5d9;padding:10px 15px;border-radius:30px}
aside{padding:30px 25px;background:#f8f7f1;border-left:1px solid #d2d7ca}h2{font-size:13px;font-weight:500;letter-spacing:1px;margin:24px 0 13px}
.buttons{display:flex;gap:7px;flex-wrap:wrap}button,a.link{font:inherit;font-size:12px;cursor:pointer;border:1px solid #b9c5b5;background:transparent;padding:10px 13px;border-radius:6px;color:#314333;text-decoration:none}
button.active{background:#344d3b;color:#fff;border-color:#344d3b}button:focus-visible,a:focus-visible{outline:3px solid #be9642;outline-offset:3px}
input{width:100%;accent-color:#536e53}dl{display:grid;grid-template-columns:1fr auto;font-size:13px;gap:14px 8px}dt{color:#77816e}dd{margin:0}
.note{font-size:12px;line-height:1.9;color:#77816e;border-top:1px solid #d9ddcf;padding-top:16px;margin-top:22px}
.tag{font-size:10px;display:inline-block;padding:6px 9px;border:1px solid #bcc7b4;border-radius:20px;letter-spacing:1px}
#status{font-size:12px;min-height:22px;color:#77816e}.legend{font-size:12px;line-height:1.9;margin-top:18px}
@media(max-width:800px){main{display:block}.stage{position:relative;height:72vh;min-height:570px}aside{border-left:0;padding:20px 6vw}h1{font-size:23px}.intro{top:20px}header{padding:20px 6vw}.small{letter-spacing:1px}.hint{font-size:10px}}
</style></head><body>
<header><div class="brand">MOONCOVE / 月湾</div><div class="small">V0.3 · 原图造型拟合</div></header>
<main><section class="stage"><canvas id="view" aria-label="可拖动旋转的自动猫粮投喂器三维模型"></canvas>
<div class="intro"><span class="tag">安静进食 · 开放视野</span><h1>一枚月湾。<br>一处安心饭点。</h1><p>偏心鹅卵石机身 × 低位开放浅碗<br>奶油白 / 鼠尾草绿</p></div>
<div class="hint">拖动旋转 · 滚轮缩放 · 双击复位 · 模型为体块与布局概念</div></section>
<aside><span class="small">01 / DESIGN EXPLORER</span><h2>查看模式</h2>
<div class="buttons" id="modes"><button data-mode="normal" class="active">外观</button><button data-mode="inside">内部布局</button></div>
<h2>拆解程度 <span id="explodeText">0%</span></h2><input aria-label="拆解程度" id="explode" type="range" min="0" max="100" value="0">
<h2>视角</h2><div class="buttons"><button id="front">正面</button><button id="side">侧面</button><button id="top">俯视</button><button id="reset">参考视角</button></div>
<h2>配色提案</h2><div class="buttons" id="colors"><button data-color="sage" class="active">月白 · 苔绿</button><button data-color="sand">砂岩 · 暖灰</button><button data-color="night">云灰 · 夜蓝</button></div>
<h2>外观拟合尺寸 / 非工程定版</h2><dl><dt>整体尺寸</dt><dd>${dimensions.width} × ${dimensions.depth} × ${dimensions.height} mm</dd><dt>目标净粮仓</dt><dd>约 3 L · 待复核</dd><dt>浅碗外径 / 深度</dt><dd>${dimensions.bowlDiameter} / ${dimensions.bowlDepth} mm</dd><dt>碗沿离地</dt><dd>${dimensions.bowlRim} mm</dd><dt>供电</dt><dd>12 V DC / 2 A</dd></dl>
<div class="legend" id="legend">V0.3：斜向月湾曲面、圆角开口、贴合宽侧饰片、横向底座。仍需与原图继续校准，不代表一比一还原。</div>
<p id="status" role="status"></p><div class="buttons"><button id="export">导出当前模型图片</button><a class="link" href="MOONCOVE-3D.glb" download>下载 GLB 模型</a><a class="link" href="MOONCOVE-comparison.png" target="_blank" rel="noopener">原图 / 新旧版对照</a><a class="link" href="MOONCOVE-circuit.svg" target="_blank" rel="noopener">查看电路图</a><a class="link" href="MOONCOVE-concept.jpg" target="_blank" rel="noopener">原效果图 / 造型目标</a></div>
<p class="note">以原 AI 效果图为造型目标重建；不是把原图降级后改成另一款产品。当前模型的静态预览与交互查看使用相同几何。<br>可离线查看。背面及不可见结构属于设计推定。内部件仍为未验证的布局包络，尺寸、容量、粮道与防探爪均需工程校核。</p>
</aside></main>
<script>
const parts=${JSON.stringify(parts)};
const canvas=document.getElementById('view'),gl=canvas.getContext('webgl',{antialias:true,alpha:true});
if(!gl){document.getElementById('status').textContent='当前环境不支持 WebGL，请使用支持 WebGL 的浏览器或下载 GLB。';throw Error('WebGL unavailable');}
const vs='attribute vec3 p;attribute vec3 n;uniform mat4 vp;uniform vec3 offset;varying vec3 normal;varying vec3 world;void main(){normal=n;world=p+offset;gl_Position=vp*vec4(world,1.0);}';
const fs='precision highp float;varying vec3 normal;varying vec3 world;uniform vec3 color;uniform vec3 eye;uniform float metal;void main(){vec3 N=normalize(normal);if(!gl_FrontFacing)N=-N;vec3 L=normalize(vec3(0.85,0.25,0.65));vec3 V=normalize(eye-world);float diffuse=max(dot(N,L),0.0);float fill=max(dot(N,normalize(vec3(-0.7,0.8,0.3))),0.0);float spec=pow(max(dot(N,normalize(L+V)),0.0),mix(32.0,95.0,metal));float light=0.68+0.32*diffuse+0.13*fill;vec3 lit=color*light+vec3(spec*0.065);vec3 R=reflect(-V,N);float env=0.56+0.24*R.z+0.30*pow(max(0.0,R.x*0.7+R.y*0.7),5.0)+0.11*sin(6.0*R.x);float brush=0.004*sin(world.z*2.4);vec3 steel=vec3(env+brush)+vec3(spec*0.8);lit=mix(lit,steel,metal*0.9);gl_FragColor=vec4(lit,1.0);}';
function shader(type,source){let s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vs));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
const loc={p:gl.getAttribLocation(program,'p'),n:gl.getAttribLocation(program,'n'),vp:gl.getUniformLocation(program,'vp'),offset:gl.getUniformLocation(program,'offset'),color:gl.getUniformLocation(program,'color'),eye:gl.getUniformLocation(program,'eye'),metal:gl.getUniformLocation(program,'metal')};
for(const part of parts){part.buffers={};for(const k of ['p','n','idx']){const b=gl.createBuffer(),target=k==='idx'?gl.ELEMENT_ARRAY_BUFFER:gl.ARRAY_BUFFER;gl.bindBuffer(target,b);gl.bufferData(target,k==='idx'?new Uint16Array(part[k]):new Float32Array(part[k]),gl.STATIC_DRAW);part.buffers[k]=b;}}
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>{let l=Math.hypot(...a);return a.map(v=>v/l)},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function look(eye,target){const z=norm(sub(eye,target)),x=norm(cross([0,0,1],z)),y=cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]}
function multiply(a,b){let o=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
let yaw=0.12,pitch=0.25,distance=1140,explode=0,mode='normal',scheme='sage',drag=null;
function reset(){yaw=0.12;pitch=0.25;distance=1140;render()}
const schemes={sage:{shell:${JSON.stringify(C.shell)},base:${JSON.stringify(C.sage)}},sand:{shell:[0.84,0.77,0.64],base:[0.48,0.44,0.39]},night:{shell:[0.77,0.80,0.80],base:[0.22,0.31,0.37]}};
function render(){const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);
 const aspect=w/h,f=1/Math.tan(0.43/2),near=5,far=4000,proj=[f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
 const target=[0,0,155+explode*40],eye=[Math.sin(yaw)*Math.cos(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance,155+explode*40+Math.sin(pitch)*distance];
 gl.uniformMatrix4fv(loc.vp,false,new Float32Array(multiply(proj,look(eye,target))));
 gl.uniform3fv(loc.eye,eye);
 for(const part of parts){if(mode==='inside'&&['shell','panel','lid','seam','indicator','chute'].includes(part.role))continue;if(mode==='normal'&&explode===0&&part.role==='inside')continue;for(const k of ['p','n']){gl.bindBuffer(gl.ARRAY_BUFFER,part.buffers[k]);gl.enableVertexAttribArray(loc[k]);gl.vertexAttribPointer(loc[k],3,gl.FLOAT,false,0,0);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,part.buffers.idx);
 let color=part.color;if(['shell','lid'].includes(part.role)||part.name.startsWith('11a'))color=schemes[scheme].shell;if(['base','panel'].includes(part.role))color=schemes[scheme].base;
 gl.uniform3fv(loc.color,color);gl.uniform1f(loc.metal,part.role==='bowl'?1:0);gl.uniform3fv(loc.offset,(part.explode||[0,0,0]).map(v=>v*explode));gl.drawElements(gl.TRIANGLES,part.idx.length,gl.UNSIGNED_SHORT,0);}
}
canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw-=(e.clientX-drag[0])*0.009;pitch=Math.max(-0.12,Math.min(1.48,pitch+(e.clientY-drag[1])*0.007));drag=[e.clientX,e.clientY];render()});
for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>drag=null);
canvas.addEventListener('wheel',e=>{e.preventDefault();distance=Math.max(700,Math.min(1900,distance+e.deltaY*0.5));render()},{passive:false});
canvas.addEventListener('dblclick',reset);document.getElementById('reset').onclick=reset;
document.getElementById('front').onclick=()=>{yaw=0;pitch=0.12;render()};document.getElementById('side').onclick=()=>{yaw=Math.PI/2;pitch=0.12;render()};document.getElementById('top').onclick=()=>{yaw=0;pitch=1.48;render()};
document.getElementById('explode').oninput=e=>{explode=Number(e.target.value)/100;document.getElementById('explodeText').textContent=e.target.value+'%';render()};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));document.getElementById('legend').textContent=mode==='inside'?'内部件仅为布局假设，尚未通过避让与粮道校核。金色：粮仓；深灰：转子；银色：电机 / 称重梁；绿色：主板。':'V0.3：斜向月湾曲面、圆角开口、贴合宽侧饰片、横向底座。仍需与原图继续校准，不代表一比一还原。';render()});
document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{scheme=b.dataset.color;document.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('active',x===b));render()});
document.getElementById('export').onclick=()=>{
  render();
  const image=document.createElement('canvas');image.width=canvas.width;image.height=canvas.height;
  const ctx=image.getContext('2d');ctx.fillStyle='#eeece5';ctx.fillRect(0,0,image.width,image.height);ctx.drawImage(canvas,0,0);
  const link=document.createElement('a');link.download='MOONCOVE-model-view.png';link.href=image.toDataURL('image/png');link.click();
  document.getElementById('status').textContent='已导出当前视角，与模型使用同一份几何。';
};
window.addEventListener('resize',render);render();window.mooncove={parts,render,getState:()=>({mode,scheme,explode,yaw,pitch,distance}),setView:(y,p,d)=>{yaw=y;pitch=p;distance=d;render()}};
</script></body></html>`;
fs.writeFileSync(`${out}/MOONCOVE-viewer.html`,html);
console.log(`Created ${parts.length} parts; GLB ${Math.round((28+json.length+bin.length)/1024)} KiB; offline viewer ready.`);
