import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
// Only the two final presentation PNGs are written into the design folder.
const root=path.dirname(fileURLToPath(import.meta.url));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({
  executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:true,downloadsPath:'/tmp',args:['--enable-unsafe-swiftshader']
});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,'MOONCOVE-viewer.html')).href);
  await page.waitForFunction(()=>Boolean(window.mooncove));
  const geometry=await page.evaluate(()=>{
    const ps=window.mooncove.parts,body=ps.find(p=>p.role==='shell');
    const bounds=[0,1,2].map(d=>[
      Math.min(...ps.flatMap(p=>p.p.filter((_,i)=>i%3===d))),
      Math.max(...ps.flatMap(p=>p.p.filter((_,i)=>i%3===d)))
    ]);
    let clearance=Infinity;
    // Sample the analytic shell mesh through the bowl's occupied height range.
    for(let i=0;i<body.p.length;i+=3){
      if(body.p[i+2]>=39&&body.p[i+2]<=71)
        clearance=Math.min(clearance,Math.hypot(body.p[i]+90,body.p[i+1]-79)-78);
    }
    return {
      parts:ps.length,bounds,sampledBowlClearance:clearance,
      finite:ps.every(p=>p.p.every(Number.isFinite)&&p.n.every(Number.isFinite)),
      validIndices:ps.every(p=>p.idx.every(i=>i>=0&&i<p.p.length/3&&i<65536)),
      webglError:document.querySelector('canvas').getContext('webgl').getError()
    };
  });
  assert.equal(geometry.finite,true);assert.equal(geometry.validIndices,true);
  assert.equal(geometry.webglError,0);assert.ok(geometry.sampledBowlClearance>0);
  await page.getByRole('button',{name:'内部布局',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mooncove.getState().mode),'inside');
  await page.locator('#explode').fill('100');
  assert.equal(await page.evaluate(()=>window.mooncove.getState().explode),1);
  await page.getByRole('button',{name:'云灰 · 夜蓝',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mooncove.getState().scheme),'night');
  await page.getByRole('button',{name:'俯视',exact:true}).click();
  assert.ok(await page.evaluate(()=>window.mooncove.getState().pitch>1.4));
  await page.getByRole('button',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'月白 · 苔绿',exact:true}).click();
  await page.locator('#explode').fill('0');
  await page.getByRole('button',{name:'参考视角',exact:true}).click();
  const box=await page.locator('#view').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+20);await page.mouse.up();
  assert.notEqual(await page.evaluate(()=>window.mooncove.getState().yaw),0.12);
  await page.getByRole('button',{name:'参考视角',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1440,height:1000});
  // Validate the export payload without asking Chrome to write to user Downloads.
  await page.evaluate(()=>{
    window.savedAnchorClick=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){
      window.exportCheck={name:this.download,png:this.href.startsWith('data:image/png;base64,'),length:this.href.length};
    };
  });
  await page.getByRole('button',{name:'导出当前模型图片',exact:true}).click();
  const exported=await page.evaluate(()=>{
    HTMLAnchorElement.prototype.click=window.savedAnchorClick;
    return window.exportCheck;
  });
  assert.equal(exported.png,true);assert.ok(exported.length>10000);

  // Capture the actual WebGL buffer, crop transparent margins, add a neutral
  // background. No generative image replacement and no nonuniform scaling.
  const preview=await page.evaluate(()=>{
    window.mooncove.render();
    const source=document.querySelector('canvas'),temp=document.createElement('canvas');
    temp.width=source.width;temp.height=source.height;
    const ctx=temp.getContext('2d');ctx.drawImage(source,0,0);
    const data=ctx.getImageData(0,0,temp.width,temp.height).data;
    let minX=temp.width,minY=temp.height,maxX=0,maxY=0;
    for(let y=0;y<temp.height;y++)for(let x=0;x<temp.width;x++){
      if(data[(y*temp.width+x)*4+3]>32){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    }
    const out=document.createElement('canvas'),pad=24;
    out.width=maxX-minX+1+pad*2;out.height=maxY-minY+1+pad*2;
    const c=out.getContext('2d');c.fillStyle='#eeece5';c.fillRect(0,0,out.width,out.height);
    c.drawImage(temp,minX,minY,maxX-minX+1,maxY-minY+1,pad,pad,maxX-minX+1,maxY-minY+1);
    return out.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(root,'MOONCOVE-model-preview.png'),Buffer.from(preview.split(',')[1],'base64'));
  const original='data:image/jpeg;base64,'+fs.readFileSync(path.join(root,'MOONCOVE-concept.jpg')).toString('base64');
  const old='data:image/png;base64,'+fs.readFileSync(path.join(root,'MOONCOVE-v02-preview.png')).toString('base64');
  const comparison=await page.evaluate(async({original,old,preview})=>{
    const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});
    const images=await Promise.all([load(original),load(old),load(preview)]);
    const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=910;
    const c=canvas.getContext('2d');c.fillStyle='#eeece5';c.fillRect(0,0,1800,910);
    c.fillStyle='#304435';c.font='500 30px "PingFang SC", sans-serif';c.fillText('MOONCOVE / 外观还原对照',36,49);
    c.font='16px "PingFang SC", sans-serif';c.fillStyle='#657260';
    c.fillText('按产品可见高度近似对齐，等比缩放，未拉伸。视角尚非严格标定，不可据此推导真实尺寸。',36,84);
    const titles=['原效果图 / 造型目标','上一版 V0.2 / 留存对比','新版 V0.3 / 实际模型渲染'];
    const rects=[[430,103,600,592],[65,44,440,532],[24,24,images[2].width-48,images[2].height-48]];
    images.forEach((im,i)=>{
      const [sx,sy,sw,sh]=rects[i],scale=Math.min(548/sw,570/sh),w=sw*scale,h=sh*scale;
      c.fillStyle='#304435';c.font='500 23px "PingFang SC", sans-serif';c.fillText(titles[i],36+i*600,133);
      c.drawImage(im,sx,sy,sw,sh,i*600+(600-w)/2,160+(570-h),w,h);
    });
    c.fillStyle='#42553f';c.font='18px "PingFang SC", sans-serif';
    c.fillText('目标：连续弧面、圆角口沿、家居质感',36,779);
    c.fillText('问题：直筒感、矩形槽、圆盘底座',636,779);
    c.fillText('本轮：斜向弧面、圆角开口、斜向底座',1236,779);
    c.fillStyle='#776f5b';c.font='17px "PingFang SC", sans-serif';
    c.fillText('仍有差距：肩部与顶盖曲率、碗与机身的视觉比例、凹面柔和程度、接触阴影和摄影材质。未宣称一比一还原。',36,835);
    c.fillText('单张参考图无法唯一确定背面结构；模型为概念曲面，不是可直接加工的工程 CAD。',36,869);
    return canvas.toDataURL('image/png');
  },{original,old,preview});
  fs.writeFileSync(path.join(root,'MOONCOVE-comparison.png'),Buffer.from(comparison.split(',')[1],'base64'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({geometry,tests:'rotation / modes / explode / palette / mobile / export passed',outputs:['MOONCOVE-model-preview.png','MOONCOVE-comparison.png']},null,2));
} finally {
  await browser.close();
}
