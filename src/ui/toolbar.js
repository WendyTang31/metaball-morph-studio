// 左工具条:V/R/E/T/D 五工具 + 新形状 加/减 布尔切换。
import { P } from '../config.js';
import { $ } from '../utils.js';

export function setTool(tl){ P.tool=tl;
  ['tSel','tRect','tEll','tText','tDot'].forEach(id=>$(id).classList.remove('active'));
  $({sel:'tSel',rect:'tRect',ell:'tEll',text:'tText',dot:'tDot'}[tl]).classList.add('active');
}

export function initToolbar(){
  $('tSel').onclick=()=>setTool('sel');
  $('tRect').onclick=()=>setTool('rect');
  $('tEll').onclick=()=>setTool('ell');
  $('tText').onclick=()=>setTool('text');
  $('tDot').onclick=()=>setTool('dot');
  $('boolBtn').onclick=()=>{ P.bool=P.bool==='add'?'sub':'add';
    $('boolBtn').textContent=P.bool==='add'?'➕':'➖'; };
}
