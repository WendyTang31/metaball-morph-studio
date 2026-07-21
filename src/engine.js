// 引擎层:全部纯函数,无隐藏状态。参数从 P 显式传入,任意全局时间 g 都能凭空求值 ——
// 这是时间轴可拖、导出确定性、"预览 == 导出"一致性的根基。预览与导出共用 sampleFrame。
import { hex2rgb } from './utils.js';

// 缓动:端点连续、速度/加速度在端点收敛(smootherstep 最柔)。
export const EASE={ linear:t=>t, smoothstep:t=>t*t*(3-2*t),
  smootherstep:t=>t*t*t*(t*(t*6-15)+10),
  cubic:t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2 };

const centroid=a=>{let x=0,y=0;a.forEach(b=>{x+=b.x;y+=b.y;});return{x:x/a.length,y:y/a.length};};

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
};

// 配对:先用"最近邻复制"把点数补齐到相等,再按策略排序对齐;
// p.d 是按 A 的 x 归一化的相位,供错峰(stagger)用。
export function makePairs(dotsA,dotsB,P){
  let A=dotsA.map(b=>({...b})), B=dotsB.map(b=>({...b}));
  if(!A.length||!B.length) return [];
  const nearest=(arr,ref)=>{let best=arr[0],bd=1e9;
    arr.forEach(b=>{const d=(b.x-ref.x)**2+(b.y-ref.y)**2;if(d<bd){bd=d;best=b;}});return best;};
  while(A.length<B.length)A.push({...nearest(A,B[A.length%B.length])});
  while(B.length<A.length)B.push({...nearest(B,A[B.length%A.length])});
  const [sa,sb]=MATCH[P.match](A,B);
  const pairs=sa.map((a,i)=>({a,b:sb[i],phase:Math.random()*6.28,d:0}));
  const xs=pairs.map(p=>p.a.x),mn=Math.min(...xs),mx=Math.max(...xs);
  pairs.forEach(p=>p.d=(mx-mn)<1e-6?0:(p.a.x-mn)/(mx-mn));
  return pairs;
}

// 双正弦低频漂移:停留态的"呼吸",幅度极小(乘 P.amp)。
export function drift(ph,time,P){return Math.sin(time*P.freq*6.283+ph)*.7+Math.sin(time*P.freq*3.33+ph*1.7)*.3;}

// 融合柔度膨胀:过渡中段(按段进度 t 的抛物线)整体放大点半径,端点复原=1。
// 半径是比软边强得多的杠杆(场 ∝ r²,直接改变空间尺度),让结块更肉、化开羽化更宽。
const FUSION_INFLATE = 0.6; // fusion=1 时中段半径最多膨胀 60%
export function fusionInflate(P, t){
  return 1 + (P.fusion||0) * FUSION_INFLATE * (4*t*(1-t));
}

// 过渡帧:每个点独立按错峰相位 p.d 延迟进入缓动,叠加双轴漂移;半径含融合膨胀。
export function transBalls(pairs,t,time,P){
  const ease=EASE[P.ease], span=Math.max(1e-6,1-P.stag), inflate=fusionInflate(P,t);
  return pairs.map(p=>{
    const lt=Math.max(0,Math.min(1,(t-p.d*P.stag)/span)), e=ease(lt);
    return{x:p.a.x+(p.b.x-p.a.x)*e+P.amp*drift(p.phase,time,P),
           y:p.a.y+(p.b.y-p.a.y)*e+P.amp*drift(p.phase+3.1,time,P),
           r:(p.a.r+(p.b.r-p.a.r)*e)*inflate};
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

// 融合柔度:突兀感来自"实体⇄点云"相变挤在极窄的软边带里发生。
// 只在过渡段、按抛物线 4·lt·(1-lt) 在中段加宽渲染软边(端点归零,与停留态无缝衔接),
// 让结块与化开都成为渐进"生长"而非硬切。P.fusion=0 即关闭,越大越柔。纯函数、确定性不破。
const FUSION_MAX_SOFT = 0.5; // fusion=1 时中段最多把软边加宽这么多
export function fusionSoft(P, lt){
  return P.soft + (P.fusion||0) * FUSION_MAX_SOFT * (4*lt*(1-lt));
}

// 采样一帧:全局时间 g → {seg, balls, col, soft}。预览与导出共用同一函数。
// soft = 该帧的"有效软边"(含融合柔度加成),渲染时用它覆盖 P.soft。
export function sampleFrame(SEQ, states, g, time, P){
  const {segs,T}=SEQ;
  g=Math.max(0,Math.min(T-1e-6,g));
  let seg=segs[0];
  for(const s of segs){ if(g>=s.t0 && g<s.t0+s.dur){seg=s;break;} }
  if(seg.type==='hold'){
    const st=states[seg.si];
    return {seg, soft:P.soft, col:hex2rgb(st.color),
      balls:st.dots.map((b,i)=>({x:b.x+P.amp*drift(i*2.3,time,P),y:b.y+P.amp*drift(i*2.3+3,time,P),r:b.r}))};
  } else {
    const lt=(g-seg.t0)/seg.dur, ca=hex2rgb(states[seg.a].color), cb=hex2rgb(states[seg.b].color);
    const e=EASE.smoothstep(lt);
    return {seg, soft:fusionSoft(P,lt), balls:transBalls(seg.pairs,lt,time,P),
      col:[ca[0]+(cb[0]-ca[0])*e, ca[1]+(cb[1]-ca[1])*e, ca[2]+(cb[2]-ca[2])*e]};
  }
}
