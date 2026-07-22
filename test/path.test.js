// 纯函数断言(node --test)。钢笔工具的几何工具层,无 DOM 依赖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { rdpSimplify, pathBBox } from '../src/path.js';

test('RDP 简化:近似直线的密集抖动点被大幅精简,首尾保留', () => {
  const raw = [];
  for (let i = 0; i <= 100; i++) raw.push({ x: i, y: 50 + Math.sin(i * 3) * 0.3 }); // 抖动幅度远小于 epsilon
  const simplified = rdpSimplify(raw, 2);
  assert.ok(simplified.length < raw.length / 5, `应大幅精简,实际 ${simplified.length}/${raw.length}`);
  assert.deepEqual(simplified[0], raw[0], '首点应保留');
  assert.deepEqual(simplified[simplified.length - 1], raw[raw.length - 1], '尾点应保留');
});

test('RDP 简化:只删点不新增点、不挪动坐标(保留点必须是原始点的引用/等值)', () => {
  const raw = [{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 50 }, { x: 15, y: -0.1 }, { x: 20, y: 0 }];
  const simplified = rdpSimplify(raw, 3);
  const rawSet = new Set(raw.map(p => p.x + ',' + p.y));
  for (const p of simplified) assert.ok(rawSet.has(p.x + ',' + p.y), `简化后的点 (${p.x},${p.y}) 必须来自原始点集`);
});

test('RDP 简化:epsilon 越大精简越狠(单调性)', () => {
  const raw = [];
  for (let i = 0; i <= 50; i++) raw.push({ x: i, y: Math.sin(i * 0.5) * 10 });
  const loose = rdpSimplify(raw, 0.5).length;
  const tight = rdpSimplify(raw, 5).length;
  assert.ok(tight <= loose, `更大的 epsilon(5) 应产出更少或相等的点,实际 tight=${tight} loose=${loose}`);
});

test('包围盒:正确覆盖全部点', () => {
  const pts = [{ x: 10, y: 20 }, { x: -5, y: 30 }, { x: 8, y: -2 }];
  const bb = pathBBox(pts);
  assert.equal(bb.x, -5); assert.equal(bb.y, -2);
  assert.equal(bb.w, 15); assert.equal(bb.h, 32);
});
