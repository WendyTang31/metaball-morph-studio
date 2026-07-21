// 纯函数断言(node --test)。只测无 DOM 依赖的引擎/采样层。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EASE, buildSequence, makePairs, sampleFrame } from '../src/engine.js';
import { SAMPLERS } from '../src/samplers.js';
import { P } from '../src/config.js';

test('缓动端点连续:每种 ease 都满足 f(0)=0, f(1)=1', () => {
  for (const name of Object.keys(EASE)) {
    assert.ok(Math.abs(EASE[name](0) - 0) < 1e-9, `${name}(0) 应为 0`);
    assert.ok(Math.abs(EASE[name](1) - 1) < 1e-9, `${name}(1) 应为 1`);
  }
});

test('缓动单调不减(采样 0..1)', () => {
  for (const name of Object.keys(EASE)) {
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = EASE[name](t);
      assert.ok(v >= prev - 1e-9, `${name} 在 t=${t.toFixed(2)} 处回退`);
      prev = v;
    }
  }
});

test('序列总时长 == 各段时长之和,且末段收于 T', () => {
  const mk = (hold, dur, dots) => ({ hold, dur, color: '#ffffff', dots });
  const states = [
    mk(1, 2, [{ x: .2, y: .2, r: .01 }]),
    mk(0.5, 3, [{ x: .8, y: .8, r: .01 }]),
  ];
  const SEQ = buildSequence(states, true, P); // seamless: hold,trans,hold,trans(尾→首)
  const sum = SEQ.segs.reduce((a, s) => a + s.dur, 0);
  assert.ok(Math.abs(sum - SEQ.T) < 1e-9, '段时长和应等于 T');
  const last = SEQ.segs[SEQ.segs.length - 1];
  assert.ok(Math.abs(last.t0 + last.dur - SEQ.T) < 1e-9, '末段 t0+dur 应等于 T');
  // 无缝:应存在一段 尾→首(a=1,b=0)的过渡
  assert.ok(SEQ.segs.some(s => s.type === 'trans' && s.a === 1 && s.b === 0), '缺尾→首过渡');
});

test('无缝关闭时无尾→首过渡', () => {
  const mk = (dots) => ({ hold: 1, dur: 2, color: '#fff', dots });
  const states = [mk([{ x: .2, y: .2, r: .01 }]), mk([{ x: .8, y: .8, r: .01 }])];
  const SEQ = buildSequence(states, false, P);
  assert.ok(!SEQ.segs.some(s => s.type === 'trans' && s.a === 1 && s.b === 0), '不应有尾→首过渡');
});

test('配对补齐:点数不等时两侧对齐到同长', () => {
  const A = [{ x: .1, y: .1, r: .01 }, { x: .2, y: .2, r: .01 }, { x: .3, y: .3, r: .01 }];
  const B = [{ x: .8, y: .8, r: .01 }];
  const pairs = makePairs(A, B, P);
  assert.equal(pairs.length, 3, '应补齐到较多一侧的点数');
  for (const p of pairs) { assert.ok(p.a && p.b, '每对两端都在'); }
});

test('sampleFrame 在过渡端点落回 A/B 位置(错峰=0 时)', () => {
  const savedStag = P.stag, savedAmp = P.amp;
  P.stag = 0; P.amp = 0; // 关掉错峰与漂移,端点应精确重合
  const A = [{ x: .2, y: .5, r: .02 }], B = [{ x: .8, y: .5, r: .02 }];
  const states = [
    { hold: 0, dur: 2, color: '#ffffff', dots: A },
    { hold: 0, dur: 2, color: '#ffffff', dots: B },
  ];
  const SEQ = buildSequence(states, false, P);
  const f0 = sampleFrame(SEQ, states, 0, 0, P);       // 过渡起点
  const f1 = sampleFrame(SEQ, states, 2 - 1e-4, 0, P); // 过渡终点(逼近)
  assert.ok(Math.abs(f0.balls[0].x - .2) < 1e-3, '起点应贴近 A');
  assert.ok(Math.abs(f1.balls[0].x - .8) < 2e-3, '终点应贴近 B');
  P.stag = savedStag; P.amp = savedAmp;
});

test('采样器只在蒙版内落点', () => {
  // 蒙版:中心 200x120 矩形为"内"
  const on = (x, y) => x >= 140 && x <= 340 && y >= 80 && y <= 200;
  for (const name of ['grid', 'hex', 'poisson', 'outline']) {
    const pts = SAMPLERS[name](on, 17, 0);
    assert.ok(pts.length > 0, `${name} 应产出点`);
    // 允许 outline 落在边缘像素,放宽 2px 容差
    for (const [x, y] of pts) {
      assert.ok(on(Math.round(x), Math.round(y)) ||
        (x >= 138 && x <= 342 && y >= 78 && y <= 202),
        `${name} 点 (${x|0},${y|0}) 落到蒙版外`);
    }
  }
});
