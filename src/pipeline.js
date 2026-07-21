// 管线层:形状 → 光栅化蒙版 → 采样成点。这里是数据层(shapes)与画布对象(mask/ghost/thumb)
// 唯一合法的交汇处;纯引擎/采样只吃它产出的 dots。
import { W, H } from './config.js';
import { P } from './config.js';
import { store } from './store.js';
import { $, FONT, hex2rgb } from './utils.js';
import { SAMPLERS } from './samplers.js';

// 蒙版读取器:白(>127)= 形状内。
export function readMask(s){ const d=s.mctx.getImageData(0,0,W,H).data;
  return (x,y)=> x>=0&&y>=0&&x<W&&y<H && d[(y*W+x)*4]>127; }

// 文字量度只依赖字体串,与具体画布无关 —— 用独立 scratch context,
// 免得像 legacy 那样依赖 states[0](初始化时序列尚空,取 states[0] 会炸)。
const _measCtx=document.createElement('canvas').getContext('2d');
export function measureText(txt,size){ _measCtx.font=FONT(size);
  return _measCtx.measureText(txt).width; }

// 把形状列表烧进蒙版(add=白,sub=黑),再刷新幽灵与缩略图。
export function rasterize(s){
  const c=s.mctx; c.fillStyle='#000'; c.fillRect(0,0,W,H);
  for(const sh of s.shapes){
    c.fillStyle=sh.bool==='add'?'#fff':'#000';
    if(sh.type==='rect') c.fillRect(sh.x,sh.y,sh.w,sh.h);
    else if(sh.type==='ellipse'){ c.beginPath();
      c.ellipse(sh.x+sh.w/2,sh.y+sh.h/2,sh.w/2,sh.h/2,0,0,7); c.fill(); }
    else { c.font=FONT(sh.h); c.textAlign='center'; c.textBaseline='middle';
      c.fillText(sh.text, sh.x+sh.w/2, sh.y+sh.h/2); }
  }
  tintGhost(s); updateThumb(s);
}

// 幽灵:半透明染色版蒙版,编辑时叠加做洋葱皮/参考。
export function tintGhost(s){
  const src=s.mctx.getImageData(0,0,W,H),
        out=s.ghost.getContext('2d'), od=out.createImageData(W,H),
        [r,g,b]=hex2rgb(s.color);
  for(let i=0;i<src.data.length;i+=4){
    od.data[i]=r; od.data[i+1]=g; od.data[i+2]=b;
    od.data[i+3]=src.data[i]>127?42:0;
  }
  out.putImageData(od,0,0);
}

// 胶片条缩略图(96×56):蒙版乘状态色。
export function updateThumb(s){
  if(!s.thumb) return;
  const c=s.thumb.getContext('2d');
  c.fillStyle='#000'; c.fillRect(0,0,96,56);
  c.drawImage(s.mask,0,0,96,56);
  c.globalCompositeOperation='multiply';
  c.fillStyle=s.color; c.fillRect(0,0,96,56);
  c.globalCompositeOperation='source-over';
}

// 采样:蒙版 → 归一化点集(超 1500 抽稀),并入手动点。
export function resample(s){
  const on=readMask(s);
  let pts=SAMPLERS[P.sample](on,P.spacing,P.jitter);
  if(pts.length>1500){ const k=Math.ceil(pts.length/1500); pts=pts.filter((_,i)=>i%k===0); }
  const r=P.dotR/W;
  s.dots=pts.map(p=>({x:p[0]/W,y:p[1]/H,r})).concat(s.manual.map(m=>({x:m.x,y:m.y,r})));
  $('cnt').textContent=store.states.map(st=>`${st.name}: ${st.dots.length}`).join(' · ');
  store.seqDirty=true;
}
export const resampleAll=()=>store.states.forEach(resample);

// 形状变动后统一入口。live=true(拖拽中)只重烧蒙版不重采样,松手时再采样。
export function shapesChanged(s,live){ rasterize(s); if(!live){ resample(s); store.seqDirty=true; } }
