// 中央舞台:画布交互(画/选/移/缩/单点)、叠加层(洋葱皮/轨迹/画幅线/选框)、
// 播放模式与 requestAnimationFrame 主循环。预览渲染走 render.js 的 createPreviewRenderer。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { $, hex2rgb, setHint, getExpSize } from '../utils.js';
import { createPreviewRenderer } from '../render.js';
import { sampleFrame, drift } from '../engine.js';
import { rebuildSequence } from '../sequence.js';
import { resampleAll, resample, updateThumb, shapesChanged, measureText } from '../pipeline.js';
import { pushUndo, undo, redo } from '../state.js';
import { updateSelBox, deleteSel } from './inspector.js';
import { renderStrip } from './filmstrip.js';
import { setTool } from './toolbar.js';
import { rdpSimplify, pathBBox, fillSmoothClosedPath } from '../path.js';

let cv, ctx, previewRender;

const HANDLE=5;
const handlePts=s=>[[s.x,s.y],[s.x+s.w,s.y],[s.x,s.y+s.h],[s.x+s.w,s.y+s.h]];
const PEN_MIN_STEP=2.5;   // 原始轨迹节流:相邻捕获点最小间距(px),避免密集到没法简化
const PEN_EPSILON=2.5;    // RDP 简化容差(px):越大锚点越少、越粗糙

// 路径最近线段:返回最近的相邻锚点对索引(环形,与 fillSmoothClosedPath 的闭合方式一致)及距离,
// 供双击"在线段上插入锚点"命中测试用。
function nearestPathSegment(points,p){
  const n=points.length; let best=-1,bd=Infinity;
  for(let i=0;i<n;i++){
    const a=points[i], b=points[(i+1)%n];
    const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
    const t=len2<1e-9?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len2));
    const d=Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
    if(d<bd){bd=d;best=i;}
  }
  return {index:best, dist:bd};
}

// ══════════════ 叠加层 ══════════════
function overlayOnion(){
  if(store.hideOverlays||!$('showOnion').checked||store.mode==='play') return;
  const N=store.states.length;
  if(N<2) return;
  const prev=store.states[(store.active-1+N)%N], next=store.states[(store.active+1)%N];
  if(prev!==cur()) ctx.drawImage(prev.ghost,0,0);
  if(next!==cur()&&next!==prev) ctx.drawImage(next.ghost,0,0);
}
function overlayTraj(curBalls,seg){
  if(store.hideOverlays||!$('showTraj').checked||!seg||seg.type!=='trans') return;
  const pairs=seg.pairs, step=Math.ceil(pairs.length/350);
  ctx.lineWidth=0.6;
  for(let i=0;i<pairs.length;i+=step){
    const p=pairs[i];
    ctx.strokeStyle='rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(p.a.x*W,p.a.y*H); ctx.lineTo(p.b.x*W,p.b.y*H); ctx.stroke();
    if(curBalls&&curBalls[i]){ ctx.fillStyle='rgba(255,255,255,0.5)';
      ctx.beginPath(); ctx.arc(curBalls[i].x*W,curBalls[i].y*H,1.2,0,7); ctx.fill(); }
  }
}
function overlayFrameGuide(){
  if(store.hideOverlays||!$('showFrame').checked) return;
  const [EW,EH]=getExpSize(), ar=EW/EH, ar0=W/H;
  let gw,gh;
  if(ar>ar0){ gw=W; gh=W/ar; } else { gh=H; gw=H*ar; }
  ctx.strokeStyle='rgba(255,200,80,0.55)'; ctx.setLineDash([5,4]); ctx.lineWidth=1;
  ctx.strokeRect((W-gw)/2,(H-gh)/2,gw,gh); ctx.setLineDash([]);
}
function overlaySelection(){
  if(!store.sel||store.mode==='play') return;
  const sel=store.sel;
  if(sel.type==='path'){
    // 描边显示实际会被填充的平滑曲线,再逐锚点画小圆手柄(区别于下方整体缩放的方块手柄)
    if(fillSmoothClosedPath(ctx, sel.points)){
      ctx.strokeStyle='rgba(120,180,255,0.85)'; ctx.lineWidth=1; ctx.stroke();
    }
    ctx.fillStyle='#7ab4ff';
    for(const p of sel.points){ ctx.beginPath(); ctx.arc(p.x,p.y,3.2,0,7); ctx.fill(); }
  }
  ctx.strokeStyle='rgba(120,180,255,0.95)'; ctx.lineWidth=1;
  ctx.strokeRect(sel.x,sel.y,sel.w,sel.h);
  ctx.fillStyle='#7ab4ff';
  for(const [hx,hy] of handlePts(sel))
    ctx.fillRect(hx-HANDLE/2,hy-HANDLE/2,HANDLE,HANDLE);
}

// ══════════════ 主循环 ══════════════
function tick(now){
  const dt=(now-store.last)/1000; store.last=now; store.clock+=dt;
  if(store.mode==='play'){
    if(store.seqDirty) rebuildSequence();
    if(store.playing){ store.g+=dt;
      if(store.g>=store.SEQ.T){ if($('loop').checked) store.g-=store.SEQ.T;
        else{ store.g=store.SEQ.T; store.playing=false; $('playBtn').textContent='▶ 播放'; } }
      $('timeline').value=Math.round(store.g/store.SEQ.T*1000); }
    $('tVal').textContent=store.g.toFixed(1)+'s';
    const fr=sampleFrame(store.SEQ, store.states, store.g, store.clock, P);
    previewRender(fr.balls, fr.col, P);
    overlayTraj(fr.balls, fr.seg); overlayFrameGuide();
  } else {
    const s=cur();
    previewRender(s.dots.map((b,i)=>({x:b.x+P.amp*drift(i*2.3,store.clock,P),y:b.y+P.amp*drift(i*2.3+3,store.clock,P),r:b.r})),
      hex2rgb(s.color), P);
    ctx.drawImage(s.ghost,0,0);
    overlayOnion();
    if(store.dragAct==='draw'&&store.dragStart&&store.dragNow){
      ctx.strokeStyle='rgba(152,245,208,0.8)'; ctx.setLineDash([4,3]); ctx.lineWidth=1;
      const x0=store.dragStart.x,y0=store.dragStart.y,x1=store.dragNow.x,y1=store.dragNow.y;
      ctx.beginPath();
      if(P.tool==='rect') ctx.rect(Math.min(x0,x1),Math.min(y0,y1),Math.abs(x1-x0),Math.abs(y1-y0));
      else ctx.ellipse((x0+x1)/2,(y0+y1)/2,Math.abs(x1-x0)/2,Math.abs(y1-y0)/2,0,0,7);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if(store.dragAct==='pen'&&store.dragNow?.strokePts?.length>1){
      const pts=store.dragNow.strokePts;
      ctx.strokeStyle='rgba(152,245,208,0.85)'; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();
    }
    overlaySelection(); overlayFrameGuide();
  }
  requestAnimationFrame(tick);
}
export function startLoop(){ store.last=performance.now(); requestAnimationFrame(tick); }

// ══════════════ 模式切换 ══════════════
export function setMode(m){ store.mode=m;
  $('mPlay').classList.toggle('active',m==='play');
  if(m==='play'){ store.sel=null; updateSelBox();
    resampleAll(); rebuildSequence(); store.g=0; $('timeline').value=0;
    store.playing=true; $('playBtn').textContent='⏸ 暂停';
    $('mPlay').textContent='✏ 回到编辑';
    setHint(`预览序列 · 共 ${store.states.length} 个状态 · 总时长 ${store.SEQ.T.toFixed(1)}s`);
  } else {
    store.playing=false; $('playBtn').textContent='▶ 播放';
    $('mPlay').textContent='▶ 预览序列';
    setHint(`编辑「${cur().name}」`);
  }
  renderStrip();
}

// ══════════════ 指针交互 ══════════════
function ptr(e){ const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)/r.width*W, y:(e.clientY-r.top)/r.height*H}; }

function onPointerDown(e){
  if(store.mode==='play') return;
  const p=ptr(e), s=cur();
  if(P.tool==='sel'){
    if(store.sel&&store.sel.type==='path'){ // 锚点手柄优先于整体缩放/移动判定
      const pts=store.sel.points;
      for(let i=0;i<pts.length;i++)
        if(Math.hypot(p.x-pts[i].x,p.y-pts[i].y)<7){
          pushUndo(); store.dragAct='pathpt'+i; store.dragStart=p; return; }
    }
    if(store.sel){
      const hs=handlePts(store.sel);
      for(let i=0;i<4;i++)
        if(Math.abs(p.x-hs[i][0])<7&&Math.abs(p.y-hs[i][1])<7){
          pushUndo(); store.dragAct='resize'+i; store.dragStart=p;
          store.dragNow=store.sel.type==='path'
            ? {origX:store.sel.x,origY:store.sel.y,origW:store.sel.w,origH:store.sel.h,
               origPoints:store.sel.points.map(pt=>({...pt}))}
            : null;
          return; }
    }
    store.sel=null;
    for(let i=s.shapes.length-1;i>=0;i--){ const sh=s.shapes[i];
      if(p.x>=sh.x&&p.x<=sh.x+sh.w&&p.y>=sh.y&&p.y<=sh.y+sh.h){ store.sel=sh; break; } }
    updateSelBox();
    if(store.sel){ pushUndo(); store.dragAct='move'; store.dragStart=p;
      store.dragNow={ox:store.sel.x,oy:store.sel.y,
        origPoints:store.sel.type==='path'?store.sel.points.map(pt=>({...pt})):null}; }
  }
  else if(P.tool==='rect'||P.tool==='ell'){ store.dragAct='draw'; store.dragStart=p; store.dragNow=p; }
  else if(P.tool==='pen'){ store.dragAct='pen'; store.dragStart=p; store.dragNow={strokePts:[p]}; }
  else if(P.tool==='text'){
    pushUndo();
    const txt=$('txtWord').value||'GO', h=P.font, w=measureText(txt,h);
    const sh={id:store.shapeId++, type:'text', text:txt, x:p.x-w/2, y:p.y-h/2, w, h, bool:P.bool};
    s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
  }
  else if(P.tool==='dot'){
    pushUndo();
    const hit=s.manual.findIndex(m=>((m.x-p.x/W)**2+(m.y-p.y/H)**2)<(P.dotR/W*2.2)**2);
    if(hit>=0) s.manual.splice(hit,1); else s.manual.push({x:p.x/W,y:p.y/H});
    resample(s); updateThumb(s);
  }
}
function onPointerMove(e){
  if(!store.dragAct) return;
  const p=ptr(e), s=cur();
  if(store.dragAct==='draw'){ store.dragNow=p; }
  else if(store.dragAct==='pen'){
    const pts=store.dragNow.strokePts, last=pts[pts.length-1];
    if(Math.hypot(p.x-last.x,p.y-last.y)>=PEN_MIN_STEP) pts.push(p); // 节流,避免原始轨迹过密
  }
  else if(store.dragAct.startsWith('pathpt')&&store.sel){
    const i=+store.dragAct.slice(6);
    store.sel.points[i]={x:p.x,y:p.y};
    Object.assign(store.sel, pathBBox(store.sel.points));
    shapesChanged(s,true);
  }
  else if(store.dragAct==='move'&&store.sel){
    const dx=p.x-store.dragStart.x, dy=p.y-store.dragStart.y;
    if(store.sel.type==='path'&&store.dragNow.origPoints){
      store.sel.points=store.dragNow.origPoints.map(pt=>({x:pt.x+dx,y:pt.y+dy}));
      Object.assign(store.sel, pathBBox(store.sel.points));
    } else {
      store.sel.x=store.dragNow.ox+dx; store.sel.y=store.dragNow.oy+dy;
    }
    shapesChanged(s,true);
  }
  else if(store.dragAct&&store.dragAct.startsWith('resize')&&store.sel){
    const sel=store.sel, i=+store.dragAct[6];
    const fx=(i===0||i===2)? sel.x+sel.w : sel.x;
    const fy=(i===0||i===1)? sel.y+sel.h : sel.y;
    let nx=Math.min(p.x,fx), ny=Math.min(p.y,fy),
        nw=Math.max(8,Math.abs(p.x-fx)), nh=Math.max(8,Math.abs(p.y-fy));
    if(sel.type==='text'){ nh=Math.max(14,nh); nw=measureText(sel.text,nh);
      nx=(i===0||i===2)? fx-nw : fx; }
    else if(sel.type==='path'&&store.dragNow?.origPoints){
      const {origX,origY,origW,origH,origPoints}=store.dragNow;
      const sx=origW<1e-6?1:nw/origW, sy=origH<1e-6?1:nh/origH;
      sel.points=origPoints.map(pt=>({x:nx+(pt.x-origX)*sx, y:ny+(pt.y-origY)*sy}));
    }
    sel.x=nx; sel.y=ny; sel.w=nw; sel.h=nh;
    shapesChanged(s,true); updateSelBox();
  }
}
function onPointerUp(e){
  if(!store.dragAct) return;
  const s=cur();
  if(store.dragAct==='draw'){
    const p=ptr(e);
    if(Math.abs(p.x-store.dragStart.x)>3||Math.abs(p.y-store.dragStart.y)>3){
      pushUndo();
      const sh={id:store.shapeId++, type:P.tool==='rect'?'rect':'ellipse',
        x:Math.min(store.dragStart.x,p.x), y:Math.min(store.dragStart.y,p.y),
        w:Math.abs(p.x-store.dragStart.x), h:Math.abs(p.y-store.dragStart.y), bool:P.bool};
      s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
    }
  } else if(store.dragAct==='pen'){
    const simplified=rdpSimplify(store.dragNow.strokePts, PEN_EPSILON);
    if(simplified.length>=3){
      pushUndo();
      const sh={id:store.shapeId++, type:'path', points:simplified, bool:P.bool, ...pathBBox(simplified)};
      s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
      setHint(`已画一条轮廓(${simplified.length} 个锚点)· ➤ 工具可拖动锚点精修`);
    }
  } else { shapesChanged(s); }
  store.dragAct=null; store.dragStart=null; store.dragNow=null;
}

function onKeyDown(e){
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  const k=e.key.toLowerCase();
  if((e.ctrlKey||e.metaKey)&&k==='z'){ e.shiftKey?redo():undo(); e.preventDefault(); return; }
  if((e.ctrlKey||e.metaKey)&&k==='y'){ redo(); e.preventDefault(); return; }
  if(k==='v')setTool('sel'); else if(k==='r')setTool('rect');
  else if(k==='e')setTool('ell'); else if(k==='t')setTool('text');
  else if(k==='d')setTool('dot'); else if(k==='p')setTool('pen');
  else if(e.key==='Delete'||e.key==='Backspace'){ deleteSel(); e.preventDefault(); }
  else if(e.key==='Escape'){ store.sel=null; updateSelBox(); }
}

// 双击编辑路径锚点:双击已有手柄=删除该点(至少保留 3 点);双击轮廓线段=在该处插入新锚点。
function onDblClick(e){
  if(store.mode==='play'||P.tool!=='sel'||!store.sel||store.sel.type!=='path') return;
  const p=ptr(e), sel=store.sel, s=cur();
  for(let i=0;i<sel.points.length;i++){
    if(Math.hypot(p.x-sel.points[i].x,p.y-sel.points[i].y)<7){
      if(sel.points.length<=3){ setHint('轮廓至少保留 3 个锚点'); return; }
      pushUndo(); sel.points.splice(i,1); Object.assign(sel, pathBBox(sel.points));
      updateSelBox(); shapesChanged(s); return;
    }
  }
  const {index,dist}=nearestPathSegment(sel.points,p);
  if(dist<10){
    pushUndo(); sel.points.splice(index+1,0,{x:p.x,y:p.y}); Object.assign(sel, pathBBox(sel.points));
    updateSelBox(); shapesChanged(s);
  }
}

export function initStage(){
  cv=$('cv'); ctx=cv.getContext('2d');
  previewRender=createPreviewRenderer(ctx);
  cv.addEventListener('pointerdown',onPointerDown);
  cv.addEventListener('pointermove',onPointerMove);
  cv.addEventListener('dblclick',onDblClick);
  window.addEventListener('pointerup',onPointerUp);
  window.addEventListener('keydown',onKeyDown);
  // 播放控制条
  $('mPlay').onclick=()=>setMode(store.mode==='play'?'edit':'play');
  $('timeline').oninput=e=>{ if(store.mode!=='play'){setMode('play');}
    if(store.seqDirty) rebuildSequence();
    store.g=e.target.value/1000*store.SEQ.T; store.playing=false; $('playBtn').textContent='▶ 播放'; };
  $('playBtn').onclick=()=>{ if(store.mode!=='play'){setMode('play');return;}
    store.playing=!store.playing; if(store.playing&&store.g>=store.SEQ.T){store.g=0;}
    $('playBtn').textContent=store.playing?'⏸ 暂停':'▶ 播放'; };
}
