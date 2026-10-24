// Geometry is in millimetres. +X becomes screen right after the export mirror.
// The scoop and mouth share the same surface evaluator and boundary vertices.
export function buildGeometry({mesh,addMesh,oval,C}) {
  const bodyX=-46,bodyY=-30,bowlX=90,bowlY=79;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
  const power=(v,p)=>Math.sign(v)*Math.abs(v)**p;
  const bodyMove=[-90,-25,50];

  // The convex hull follows the hopper-to-bowl axis. This keeps the front
  // margin small without creating a circular platter around the appliance.
  const capsule=[];
  for(let i=0;i<320;i++){
    const a=i/320*Math.PI*2,nx=Math.cos(a),ny=Math.sin(a);
    const useBowl=bowlX*nx+bowlY*ny+86>bodyX*nx+bodyY*ny+113;
    const r=useBowl?86:113,cx=useBowl?bowlX:bodyX,cy=useBowl?bowlY:bodyY;
    capsule.push([cx+r*nx,cy+r*ny]);
  }
  function baseContour(z,inset){
    const scale=1-inset/123;
    return capsule.map(([x,y])=>[22+(x-22)*scale,24+(y-24)*scale,z]);
  }
  function loft(name,color,loops,opts={}) {
    const count=loops[0].length,p=loops.flat(2),indices=[];
    for(let k=0;k<loops.length-1;k++)for(let j=0;j<count;j++){
      const a=k*count+j,b=k*count+(j+1)%count,c=b+count,d=a+count;
      indices.push(a,b,c,a,c,d);
    }
    return addMesh(name,color,p,indices,opts);
  }
  loft('01 / 横向圆润底座',C.sage,[
    baseContour(2,123),baseContour(2,6),baseContour(3,3),
    baseContour(5,1),baseContour(8,0),baseContour(29,0),
    baseContour(32,1),baseContour(34,3),baseContour(35,6),
    baseContour(35,123)
  ],{role:'base'});
  oval('02 / 隐藏称重碗托',C.sage,bowlX,bowlY,35,76,76,5,{role:'base',explode:[25,25,20]});
  mesh('03 / 卷边拉丝浅碗',C.steel,[
    [39,0,0],[39,72,72],[40,76,76],[42,78,78],
    [69,78,78],[70.4,77.7,77.7],[71,76.8,76.8],
    [70.4,75.8,75.8],[69,75.5,75.5],
    [51,74.5,74.5],[48,72,72],[47,68,68],[47,0,0]
  ],[bowlX,bowlY],{role:'bowl',explode:[40,40,80],segments:192});

  function radius(z){
    // A rounded shoulder and a subtly convex belly; no polygonal profile joins.
    const shoulder=smooth((z-173)/155);
    const bottom=smooth((43-z)/10);
    return [111-14*shoulder-3*bottom,82-10*shoulder-3*bottom];
  }
  function ridge(x){
    // Elliptical diagonal boundary: low at the left foot, high at the mouth.
    const t=clamp((x+115)/175);
    return 36+103*Math.sqrt(Math.max(0,1-(1-t)**2));
  }
  function surface(a,z){
    const [rx,ry]=radius(z);
    const x=bodyX+rx*power(Math.cos(a),0.88);
    let y=bodyY+ry*power(Math.sin(a),0.88);
    const delta=ridge(x)-z;
    const depth=clamp((delta+Math.sqrt(delta*delta+9))/188);
    // The change in curvature starts at the diagonal boundary, not at floor height.
    const front=Math.max(0,Math.sin(a));
    y-=70*(1-Math.exp(-2.1*depth))*front**1.2;
    return [x,y,z];
  }

  // Match a rounded trapezoid in the (surface angle, height) parameter space.
  const a0=0.52,a1=1.15,ar=0.07,zr=4.2;
  function aperture(a){
    const corner=clamp(Math.min(a-a0,a1-a)/ar);
    const lift=zr*(1-Math.sqrt(Math.max(0,1-(1-corner)**2)));
    const center=111+4*(0.835-a);
    return [center-13+lift,center+13-lift];
  }
  const angles=[...Array.from({length:257},(_,i)=>i/256*Math.PI*2),
    ...Array.from({length:41},(_,i)=>a0+(a1-a0)*i/40),a0,a1]
    .sort((a,b)=>a-b).filter((a,i,arr)=>!i||a-arr[i-1]>1e-7);
  const verts=[],indices=[],columns=angles.length;
  const lowN=30,holeN=10,highN=68,rows=lowN+holeN+highN+1;
  for(let j=0;j<columns;j++){
    const a=angles[j],[lo,hi]=aperture(clamp(a,a0,a1));
    for(let k=0;k<rows;k++){
      const z=k<=lowN?33+(lo-33)*k/lowN:
        k<=lowN+holeN?lo+(hi-lo)*(k-lowN)/holeN:
        hi+(329-hi)*(k-lowN-holeN)/highN;
      verts.push(...surface(a,z));
    }
  }
  // Circumferential then vertical winding gives outward-facing normals.
  for(let j=0;j<columns-1;j++)for(let k=0;k<rows-1;k++){
    const opening=angles[j]>=a0-1e-7&&angles[j+1]<=a1+1e-7&&k>=lowN&&k<lowN+holeN;
    if(opening)continue;
    const a=j*rows+k,b=(j+1)*rows+k,c=b+1,d=a+1;
    indices.push(a,b,c,a,c,d);
  }
  const body=addMesh('04 / 斜向月湾连续曲面',C.shell,verts,indices,{role:'shell',explode:bodyMove});
  // Analytic-surface finite differences avoid uneven triangle-area shading at
  // the aperture and the high-curvature diagonal boundary.
  for(let j=0;j<columns;j++)for(let k=0;k<rows;k++){
    const i=(j*rows+k)*3,a=angles[j],z=verts[i+2];
    const pa=surface(a+0.0001,z),ma=surface(a-0.0001,z);
    const pz=surface(a,z+0.01),mz=surface(a,z-0.01);
    const u=pa.map((v,d)=>v-ma[d]),v=pz.map((v,d)=>v-mz[d]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...n)||1;
    for(let d=0;d<3;d++)body.n[i+d]=n[d]/length;
  }
  // Weld the duplicate circumference normals to avoid a seam at a=0.
  for(let k=0;k<rows;k++){
    const i=k*3,j=((columns-1)*rows+k)*3;
    const n=[0,1,2].map(d=>body.n[i+d]+body.n[j+d]),l=Math.hypot(...n)||1;
    for(let d=0;d<3;d++)body.n[i+d]=body.n[j+d]=n[d]/l;
  }
  const openingAngles=angles.filter(a=>a>=a0-1e-7&&a<=a1+1e-7);
  const boundary=[];
  for(const a of openingAngles)boundary.push(surface(a,aperture(a)[0]));
  for(let k=1;k<=holeN;k++){
    const [lo,hi]=aperture(a1);boundary.push(surface(a1,lo+(hi-lo)*k/holeN));
  }
  for(const a of openingAngles.slice(0,-1).reverse())boundary.push(surface(a,aperture(a)[1]));
  for(let k=holeN-1;k>0;k--){
    const [lo,hi]=aperture(a0);boundary.push(surface(a0,lo+(hi-lo)*k/holeN));
  }
  const center=boundary.reduce((s,p)=>s.map((v,i)=>v+p[i]/boundary.length),[0,0,0]);
  const rim=boundary.map(([x,y,z])=>[center[0]+(x-center[0])*0.94,y-1.7,center[2]+(z-center[2])*0.88]);
  loft('11a / 圆角口沿过渡',C.shell,[boundary,rim],{role:'chute',explode:bodyMove});
  const back=rim.map(([x,y,z])=>[x,y-17,z-1.5]);
  loft('11b / 内凹出粮腔',[0.105,0.12,0.105],[rim,back],{role:'chute',explode:bodyMove});
  const bp=back.flat(),bi=[],ci=back.length;bp.push(center[0],center[1]-22,center[2]-1.5);
  for(let i=0;i<back.length;i++)bi.push(ci,i,(i+1)%back.length);
  addMesh('11c / 粮道内部遮挡片',[0.08,0.09,0.08],bp,bi,{role:'chute',explode:bodyMove});

  // Draw the lid and hairline from the same smooth shoulder dimensions.
  const lidCenter=[bodyX,bodyY];
  mesh('05 / 顶盖细密封缝',[0.40,0.41,0.35],
    [[328.8,0,0],[328.8,97.4,72.4,2.27],[329.5,97.4,72.4,2.27],[329.5,0,0]],
    lidCenter,{role:'seam',explode:[0,0,90],segments:160});
  mesh('06 / 贴合弧面顶盖',C.shell,[
    [329.5,0,0],[329.5,97.6,72.6,2.27],[331,98,73,2.27],
    [332,97.8,72.8,2.27],[333.1,96.7,71.7,2.27],
    [334.4,92,68,2.27],[335.4,76,56,2.27],[336,0,0]
  ],lidCenter,{role:'lid',explode:[0,0,105],segments:160});
  mesh('06b / 顶盖小扣手',C.shell,
    [[-2,0,0],[-1,8.5,3],[0,10,3],[1,9,2.5],[2,0,0]],[0,0],
    {role:'lid',explode:[0,0,105],transform:([x,y,z])=>[21+x,30+z,330+y]});
  const seamLoops=[191,191.35].map(z=>angles.map(a=>{
    const [x,y]=surface(a,z);return [x+(x-bodyX)*0.0007,y+(y-bodyY)*0.0007,z];
  }));
  loft('16 / 腰部细拼缝',[0.70,0.69,0.62],seamLoops,{role:'seam',explode:bodyMove});

  // A rounded patch follows the side surface, including the shoulder taper.
  function panelLoop(inset=0,offset=1.6){
    const loop=[],cy=178,halfH=128-inset,halfA=0.40-inset*0.002;
    for(let i=0;i<192;i++){
      const t=i/192*Math.PI*2;
      const a=2.73+halfA*power(Math.cos(t),0.72);
      const z=cy+halfH*power(Math.sin(t),0.25);
      const p=surface(a,z);
      p[0]+=offset*Math.cos(a);p[1]+=offset*Math.sin(a);
      loop.push(p);
    }
    return loop;
  }
  const pl0=panelLoop(0,0.6),pl1=panelLoop(1.2,2.1),pl2=panelLoop(3,2.4);
  const panelLoops=[pl0,pl1,pl2];
  for(let shrink=0.95;shrink>=0.05;shrink-=0.05){
    const loop=[];
    for(let i=0;i<192;i++){
      const t=i/192*Math.PI*2,a=2.73+0.394*power(Math.cos(t),0.72)*shrink;
      const z=178+125*power(Math.sin(t),0.25)*shrink,p=surface(a,z);
      p[0]+=2.4*Math.cos(a);p[1]+=2.4*Math.sin(a);loop.push(p);
    }
    panelLoops.push(loop);
  }
  const panelCenter=surface(2.73,178);panelCenter[0]+=2.4*Math.cos(2.73);panelCenter[1]+=2.4*Math.sin(2.73);
  panelLoops.push(Array.from({length:192},()=>[...panelCenter]));
  loft('07 / 宽幅圆角贴合侧饰片',C.sage,panelLoops,{role:'panel',explode:[-100,0,45]});

  const indicatorA=0.82,indicatorZ=163,indicator=surface(indicatorA,indicatorZ);
  mesh('12 / 暖色嵌入指示点',[1,0.76,0.35],
    [[-0.2,0,0],[0,1.15,1.65],[0.8,1.15,1.65],[1,0,0]],[0,0],{
      role:'indicator',explode:bodyMove,
      transform:([x,y,z])=>[indicator[0]+x,indicator[1]+1+z,indicator[2]+y]
    });

  // Kept as unverified packaging envelopes, intentionally hidden in exterior mode.
  mesh('08 / 粮仓包络待重校',C.gold,[
    [120,0,0],[120,20,20],[162,83,60,2.3],[307,83,60,2.3],
    [312,76,55,2.3],[312,72,52,2.3],[164,79,56,2.3],[126,17,17],[126,0,0]
  ],[bodyX,bodyY],{role:'inside',explode:[0,0,65]});
  oval('09 / 转子包络待重校',C.dark,bodyX,bodyY,85,38,38,24,{role:'inside',explode:[0,0,15]});
  oval('10 / 电机包络待重校',C.steel,bodyX,bodyY,39,20,20,40,{role:'inside',explode:[-20,-35,10]});
  oval('13 / 主板包络待重校',C.pcb,bodyX-35,bodyY+15,36,35,24,5,{role:'inside',explode:[-45,-35,15]});
  oval('14 / 称重梁包络待重校',C.steel,bowlX,bowlY,20,35,8,9,{role:'inside',explode:[35,30,12]});
  for(const [x,y] of [[-102,-63],[-70,34],[85,33],[103,119]])
    oval('15 / 防滑脚垫',C.dark,x,y,0,12,12,4,{role:'foot'});
  return {width:335,depth:308,height:336,bowlDiameter:156,bowlDepth:24,bowlRim:71};
}
