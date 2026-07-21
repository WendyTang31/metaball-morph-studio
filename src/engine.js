// 引擎层:全部纯函数,无隐藏状态。参数从 P 显式传入,任意全局时间 g 都能凭空求值 ——
// 这是时间轴可拖、导出确定性、"预览 == 导出"一致性的根基。预览与导出共用 sampleFrame。
import { hex2rgb } from './utils.js';

// 缓动:端点连续、速度/加速度在端点收敛(smootherstep 最柔)。
export const EASE={ linear:t=>t, smoothstep:t=>t*t*(3-2*t),
  smootherstep:t=>t*t*t*(t*(t*6-15)+10),
  cubic:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2 };

const centroid=a=>{let x=0,y=0;a.forEach(b=>{x+=b.x;y+=b.y;});return{x:x/a.length,y:y/a.length};};

// Sliced Optimal Transport 配对:沿多个方向反复做 1D 排序对齐(1D 排序即该方向的最优传输),
// 迭代逼近 2D 最优传输,得到总位移最小、保邻域的 A↔B 映射 —— 点如流体般各走最短路、
// 不交叉、不在中途挤成团。这是 procedural morph 平滑的关键,取代易聚集的最近邻类匹配。
// 方向用黄金角序列均匀铺开(确定性,不引入随机,保证预览=导出一致)。
function matchOT(A, B, iters){
  const n=A.length;
  const perm=new Array(n); for(let i=0;i<n;i++) perm[i]=i;      // A[i] ↔ B[perm[i]]
  const idxA=new Array(n), idxB=new Array(n);
  for(let it=0; it<iters; it++){
    const ang=it*2.399963229;                                   // 黄金角(弧度)
    const ux=Math.cos(ang), uy=Math.sin(ang);
    for(let i=0;i<n;i++){ idxA[i]=i; idxB[i]=i; }
    idxA.sort((p,q)=>(A[p].x*ux+A[p].y*uy)-(A[q].x*ux+A[q].y*uy));           // A 沿方向排序
    idxB.sort((p,q)=>(B[perm[p]].x*ux+B[perm[p]].y*uy)-(B[perm[q]].x*ux+B[perm[q]].y*uy)); // 当前配对 B 排序
    const np=new Array(n);
    for(let r=0;r<n;r++) np[idxA[r]]=perm[idxB[r]];             // 该方向按序重新对齐
    for(let i=0;i<n;i++) perm[i]=np[i];
  }
  const sb=new Array(n); for(let i=0;i<n;i++) sb[i]=B[perm[i]];
  return [A.slice(), sb];
}

// 点配对策略:决定 A→B 谁变成谁,直接塑造形变的"手感"。
export const MATCH={
  sortXY:(A,B)=>{const k=b=>b.x+0.3*b.y;
    return[[...A].sort((p,q)=>k(p)-k(q)),[...B].sort((p,q)=>k(p)-k(q))];},
  angle:(A,B)=>{const ca=centroid(A),cb=centroid(B);
    const ka=b=>Math.atan2(b.y-ca.y,b.x-ca.x),kb=b=>Math.atan2(b.y-cb.y,b.x-cb.x);
    return[[...A].sort((p,q)=>ka(p)-ka(q)),[...B].sort((p,q)=>kb(p)-kb(q))];},
  greedy:(A,B)=>{const sa=[...A].sort((p,q)=>p.x-q.x),used=new Array(B.length).fill(false),sb=[];
    sa.forEach(a=>{let bi=-1,bd=1e9;
      B.forEach((b,i)=>{if(used[i])return;const d=(a.x-b.x)**2+(a.y-b.y)**2;if(d<bd){bd=d;bi=i;}});
      used[bi]=true;sb.push(B[bi]);});
    return[sa,sb];},
  random:(A,B)=>{const sb=[...B];
    for(let i=sb.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[sb[i],sb[j]]=[sb[j],sb[i]];}
    return[[...A],sb];},
  ot:(A,B)=>matchOT(A,B,60),
};

// 打散重合点(mass splitting):点数不等时补齐会把多点复制到同一位置,
// 过渡到该状态时它们坍缩成黑块。这里把落在同一格的重复点按黄金角螺旋小幅散开,
// 让每个点有独立位置 —— 视觉上"一个点裂成一小簇",而非多点挤成一团。
function scatterDuplicates(pts){
  const groups=new Map();
  for(let i=0;i<pts.length;i++){
    const k=Math.round(pts[i].x*4096)+','+Math.round(pts[i].y*4096);
    let g=groups.get(k); if(!g){ g=[]; groups.set(k,g); } g.push(i);
  }
  for(const g of groups.values()){
    if(g.length<2) continue;
    for(let j=1;j<g.length;j++){                    // 第一个留原位,其余螺旋散开
      const p=pts[g[j]], ang=j*2.399963229, rad=p.r*1.6*Math.sqrt(j);
      pts[g[j]]={x:p.x+Math.cos(ang)*rad, y:p.y+Math.sin(ang)*rad, r:p.r};
    }
  }
}

// 配对:先用"最近邻复制"把点数补齐到相等,再打散重合点,最后按策略排序对齐;
// p.d 是按 A 的 x 归一化的相位,供错峰(stagger)用。
export function makePairs(dotsA,dotsB,P){
  let A=dotsA.map(b=>({...b})), B=dotsB.map(b=>({...b}));
  if(!A.length||!B.length) return [];
  const nearest=(arr,ref)=>{let best=arr[0],bd=1e9;
    arr.forEach(b=>{const d=(b.x-ref.x)**2+(b.y-ref.y)**2;if(d<bd){bd=d;best=b;}});return best;};
  while(A.length<B.length)A.push({...nearest(A,B[A.length%B.length])});
  while(B.length<A.length)B.push({...nearest(B,A[B.length%A.length])});
  scatterDuplicates(A); scatterDuplicates(B);       // 消除坍缩:重复点各自散开
  const [sa,sb]=MATCH[P.match](A,B);
  const pairs=sa.map((a,i)=>({a,b:sb[i],phase:Math.random()*6.28,d:0}));
  const xs=pairs.map(p=>p.a.x),mn=Math.min(...xs),mx=Math.max(...xs);
  pairs.forEach(p=>p.d=(mx-mn)<1e-6?0:(p.a.x-mn)/(mx-mn));
  return pairs;
}

// 双正弦低频漂移:停留态的"呼吸",幅度极小(乘 P.amp)。
export function drift(ph,time,P){return Math.sin(time*P.freq*6.283+ph)*.7+Math.sin(time*P.freq*3.33+ph*1.7)*.3;}

// 过渡帧:每个点独立按错峰相位 p.d 延迟进入缓动,叠加双轴漂移。
export function transBalls(pairs,t,time,P){
  const ease=EASE[P.ease], span=Math.max(1e-6,1-P.stag);
  return pairs.map(p=>{
    const lt=Math.max(0,Math.min(1,(t-p.d*P.stag)/span)), e=ease(lt);
    return{x:p.a.x+(p.b.x-p.a.x)*e+P.amp*drift(p.phase,time,P),
           y:p.a.y+(p.b.y-p.a.y)*e+P.amp*drift(p.phase+3.1,time,P),
           r:p.a.r+(p.b.r-p.a.r)*e};
  });
}

// 序列构建:[停留, 过渡, 停留, …(seamless 时补一段 尾→首 过渡)]。
// 纯函数:states + seamless 开关 + P 进,{segs,T} 出;不碰任何全局。
export function buildSequence(states, seamless, P){
  const segs=[]; const N=states.length;
  for(let i=0;i<N;i++){
    if(states[i].hold>0.01) segs.push({type:'hold', si:i, dur:states[i].hold});
    const isLast=(i===N-1);
    const j=isLast ? (seamless && N>1 ? 0 : null) : i+1;
    if(j!==null) segs.push({type:'trans', a:i, b:j, dur:states[i].dur,
      pairs:makePairs(states[i].dots, states[j].dots, P)});
  }
  if(!segs.length) segs.push({type:'hold', si:0, dur:1});
  let T=0; segs.forEach(s=>{s.t0=T; T+=s.dur;});
  return {segs,T};
}

// 采样一帧:全局时间 g → {seg, balls, col}。预览与导出共用同一函数。
export function sampleFrame(SEQ, states, g, time, P){
  const {segs,T}=SEQ;
  g=Math.max(0,Math.min(T-1e-6,g));
  let seg=segs[0];
  for(const s of segs){ if(g>=s.t0 && g<s.t0+s.dur){seg=s;break;} }
  if(seg.type==='hold'){
    const st=states[seg.si];
    return {seg, col:hex2rgb(st.color),
      balls:st.dots.map((b,i)=>({x:b.x+P.amp*drift(i*2.3,time,P),y:b.y+P.amp*drift(i*2.3+3,time,P),r:b.r}))};
  } else {
    const lt=(g-seg.t0)/seg.dur, ca=hex2rgb(states[seg.a].color), cb=hex2rgb(states[seg.b].color);
    const e=EASE.smoothstep(lt);
    return {seg, balls:transBalls(seg.pairs,lt,time,P),
      col:[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e]};
  }
}
