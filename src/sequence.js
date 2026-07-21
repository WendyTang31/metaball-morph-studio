// 序列构建的粘合层:把纯函数 buildSequence 的结果落进 store,并清脏标记。
// 引擎本身不碰 store/DOM,seamless 开关这一 UI 读取被隔离在这里。
import { buildSequence } from './engine.js';
import { store } from './store.js';
import { P } from './config.js';
import { $ } from './utils.js';

export function rebuildSequence(){
  store.SEQ = buildSequence(store.states, $('seamless').checked, P);
  store.seqDirty = false;
}
