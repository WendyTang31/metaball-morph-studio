// 图片导入编排:上传 → 缩放到工作分辨率 → Otsu 自动阈值 → 落地成 'image' 形状。
// 复用与其它形状完全相同的 rasterize()/resample() 管线(见 pipeline.js 的 'image' 分支)。
import { W, H, P } from '../config.js';
import { store, cur } from '../store.js';
import { setHint } from '../utils.js';
import { pushUndo } from '../state.js';
import { shapesChanged } from '../pipeline.js';
import { luminanceHistogram, alphaHistogram, hasMeaningfulAlpha, otsuThreshold, decodeImageShape } from '../image.js';
import { updateSelBox } from './inspector.js';

const WORK_MAX=480;  // 工作分辨率上限:与画布同级即可,更高分辨率对最终蒙版无意义
const FIT_MAX=300;   // 导入后默认摆放尺寸上限(画布内留边距,可再拖拽缩放)

export async function importImageFile(file){
  setHint('导入中…');
  const dataURL=await new Promise((res,rej)=>{ const rd=new FileReader();
    rd.onload=()=>res(rd.result); rd.onerror=rej; rd.readAsDataURL(file); });
  const rawImg=await new Promise((res,rej)=>{ const img=new Image();
    img.onload=()=>res(img); img.onerror=rej; img.src=dataURL; });

  // 缩到工作分辨率,导出新的 dataURL(不保留原图全尺寸字节,工程文件体积可控)
  const scale=Math.min(1, WORK_MAX/Math.max(rawImg.width,rawImg.height));
  const ww=Math.max(1,Math.round(rawImg.width*scale)), wh=Math.max(1,Math.round(rawImg.height*scale));
  const work=document.createElement('canvas'); work.width=ww; work.height=wh;
  const wctx=work.getContext('2d',{willReadFrequently:true});
  wctx.drawImage(rawImg,0,0,ww,wh);
  const id=wctx.getImageData(0,0,ww,wh);

  const useAlpha=hasMeaningfulAlpha(id.data);
  const hist=useAlpha?alphaHistogram(id.data):luminanceHistogram(id.data);
  const threshold=otsuThreshold(hist);
  const imgDataURL=work.toDataURL('image/png');

  const fitScale=Math.min(1, FIT_MAX/Math.max(ww,wh));
  const dw=ww*fitScale, dh=wh*fitScale;

  const s=cur();
  pushUndo();
  const sh={ id:store.shapeId++, type:'image', x:(W-dw)/2, y:(H-dh)/2, w:dw, h:dh,
    bool:P.bool, imgDataURL, threshold, invert:false, useAlpha };
  await decodeImageShape(sh); // 立即解码好,首次光栅化就能画出来,不留一帧空白
  s.shapes.push(sh); store.sel=sh; updateSelBox(); shapesChanged(s);
  setHint(`✓ 已导入图片(${ww}×${wh},自动阈值 ${threshold}${useAlpha?' · 按透明通道':''})`);
}
