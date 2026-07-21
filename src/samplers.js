// 采样层:纯函数家族 (on, spacing, jitter) => pts[]。
// on(x,y) 是蒙版读取器(白=形状内);返回像素坐标点数组 [[x,y],…]。
// 单状态点数上限由上层(pipeline.resample)统一抽稀,这里只管铺点。
import { W, H } from './config.js';

export const SAMPLERS = {
  // 方格网格:最规整,行列感最强。
  grid(on,sp,jit){ const pts=[];
    for(let y=sp/2;y<H;y+=sp) for(let x=sp/2;x<W;x+=sp){
      const jx=x+(Math.random()-.5)*jit*sp, jy=y+(Math.random()-.5)*jit*sp;
      if(on(Math.round(jx),Math.round(jy))) pts.push([jx,jy]); } return pts; },
  // 六角网格:错行 √3/2,视觉最均匀,默认。
  hex(on,sp,jit){ const pts=[], rh=sp*0.866; let row=0;
    for(let y=sp/2;y<H;y+=rh,row++){ const off=(row%2)*sp/2;
      for(let x=sp/2+off;x<W;x+=sp){
        const jx=x+(Math.random()-.5)*jit*sp, jy=y+(Math.random()-.5)*jit*sp;
        if(on(Math.round(jx),Math.round(jy))) pts.push([jx,jy]); } } return pts; },
  // 泊松盘(飞镖投掷 + cell=sp/√2 网格加速,邻域查 5×5):蓝噪声,无行列感。
  poisson(on,sp){
    const cell=sp/Math.SQRT2, gc=Math.ceil(W/cell), gr=Math.ceil(H/cell);
    const grid=new Int32Array(gc*gr).fill(-1), pts=[];
    const tries=Math.min(60000, Math.ceil(W*H/(sp*sp))*30);
    for(let k=0;k<tries;k++){
      const x=Math.random()*W, y=Math.random()*H;
      if(!on(x|0,y|0)) continue;
      const cx=(x/cell)|0, cy=(y/cell)|0; let ok=true;
      for(let dy=-2;dy<=2&&ok;dy++) for(let dx=-2;dx<=2&&ok;dx++){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=gc||ny>=gr) continue;
        const pi=grid[ny*gc+nx];
        if(pi>=0){ const p=pts[pi]; if((p[0]-x)**2+(p[1]-y)**2<sp*sp) ok=false; } }
      if(ok){ grid[cy*gc+cx]=pts.length; pts.push([x,y]); } } return pts; },
  // 仅轮廓:先取 4 邻域边缘像素,再按 minD 做同样的网格去重。
  outline(on,sp){
    const edges=[];
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++)
      if(on(x,y)&&(!on(x-1,y)||!on(x+1,y)||!on(x,y-1)||!on(x,y+1))) edges.push([x,y]);
    const minD=sp*0.75, cell=minD/Math.SQRT2, gc=Math.ceil(W/cell), gr=Math.ceil(H/cell);
    const grid=new Int32Array(gc*gr).fill(-1), pts=[];
    for(const [x,y] of edges){
      const cx=(x/cell)|0, cy=(y/cell)|0; let ok=true;
      for(let dy=-2;dy<=2&&ok;dy++) for(let dx=-2;dx<=2&&ok;dx++){
        const nx=cx+dx, ny=cy+dy;
        if(nx<0||ny<0||nx>=gc||ny>=gr) continue;
        const pi=grid[ny*gc+nx];
        if(pi>=0){ const p=pts[pi]; if((p[0]-x)**2+(p[1]-y)**2<minD*minD) ok=false; } }
      if(ok){ grid[cy*gc+cx]=pts.length; pts.push([x,y]); } } return pts; },
};
