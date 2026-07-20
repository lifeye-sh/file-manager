// === AI Workbench frontend (P1–P4 MVP) ===
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(s)=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ---------- Auth-aware fetch ----------
let csrf='';
async function fetchCsrf(){
  try{const r=await fetch('/api/csrf-token',{credentials:'include'});if(r.ok){csrf=(await r.json()).token;}}catch(_){}
}
async function authFetch(url,opts={}){
  const m=(opts.method||'GET').toUpperCase();
  const o={...opts,credentials:opts.credentials||'include'};
  if(['POST','PUT','PATCH','DELETE'].includes(m)){
    o.headers=new Headers(opts.headers||{});
    if(csrf)o.headers.set('X-CSRF-Token',csrf);
    if(opts.body&&!(opts.body instanceof FormData)&&!o.headers.has('Content-Type'))
      o.headers.set('Content-Type','application/json');
  }
  const r=await fetch(url,o);
  if(r.status===401){window.location.href='/login.html';return r;}
  if(r.status===403&&['POST','PUT','PATCH','DELETE'].includes(m)){
    const nt=await fetchCsrf(); if(nt)return authFetch(url,opts);
  }
  return r;
}
const api={
  getJson:async(u)=>{const r=await authFetch(u);const t=await r.text().catch(()=>'');let d={};try{d=JSON.parse(t);}catch(_){d={error:t.slice(0,300)};}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;},
  postJson:async(u,b)=>{const r=await authFetch(u,{method:'POST',body:JSON.stringify(b)});const t=await r.text().catch(()=>'');let d={};try{d=JSON.parse(t);}catch(_){d={error:t.slice(0,300)};}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;},
  putJson:async(u,b)=>{const r=await authFetch(u,{method:'PUT',body:JSON.stringify(b)});const t=await r.text().catch(()=>'');let d={};try{d=JSON.parse(t);}catch(_){d={error:t.slice(0,300)};}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;},
  del:async(u)=>{const r=await authFetch(u,{method:'DELETE'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();},
};

// ---------- State ----------
const PORT_COLORS={image:'#f5c2e7',video:'#a6e3a1',text:'#94e2d5',int:'#89b4fa',float:'#b4befe'};
const GENERIC=[
  {type:'image-input',ico:'🖼',name:'图片输入',out:{name:'image',type:'image'}},
  {type:'video-input',ico:'🎬',name:'视频输入',out:{name:'video',type:'video'}},
  {type:'text-input',ico:'📝',name:'文本输入',out:{name:'text',type:'text'}},
  {type:'int-input',ico:'🔢',name:'整数输入',out:{name:'int',type:'int'}},
  {type:'float-input',ico:'🔟',name:'小数输入',out:{name:'float',type:'float'}},
  {type:'image-process',ico:'🪄',name:'图片处理',in:{name:'image',type:'image'},out:{name:'image',type:'image'}},
  {type:'output',ico:'📤',name:'输出节点',out:null,in:{name:'in',type:'any'},passthrough:{name:'out'}},
];
const state={
  defs:{}, defList:[],
  tabs:[], activeIdx:-1,
  viewport:{x:0,y:0,scale:1},
  picker:null, // {callback}
  pollTimer:null, activeTaskId:null,
  dragging:null, // {fromNode,fromPort,fromType,fromIsOut}
  selNode:null, selEdge:null,
};

// ---------- DOM refs ----------
const dom={
  tabs:$('#wfTabs'), tabAdd:$('.wf-add'),
  wfId:$('#wfIdLabel'),
  btnRun:$('#btnRun'), btnPause:$('#btnPause'), btnTerm:$('#btnTerm'),
  btnSave:$('#btnSave'), btnSaveAs:$('#btnSaveAs'), btnRename:$('#btnRename'), btnClear:$('#btnClearSel'),
  lib:$('#nodeLib'), libAdd:$('#libAdd'),
  content:$('#canvasContent'), conn:$('#connLayer'), center:$('.pane-center'), dz:$('#dropZone'),
  rpanel:$('#rpaneBody'), rtabs:$$('.tab'),
  qPending:$('#qPending'), qRunning:$('#qRunning'), qCurId:$('#qCurId'), qCurStep:$('#qCurStep'), qCurName:$('#qCurName'), qPill:$('#qPill'),
  dockBody:$('#dockBody'), dockH:$('#dockH'), taskDock:$('#taskDock'),
  overlay:$('#overlay'),
  picker:$('#picker'), pickerTabs:$$('.picker-tab'), pickerPath:$('#pickerPath'), pickerGrid:$('#pickerGrid'),
  pickerClose:$('#pickerClose'), pickerCancel:$('#pickerCancel'), pickerOk:$('#pickerOk'),
  drawer:$('#drawer'), drawerClose:$('#drawerClose'), drawerTitle:$('#drawerTitle'), drawerTabs:$$('.drawer-tab'), drawerBody:$('#drawerBody'),
  resultPop:$('#resultPop'), rpDetail:$('#rpDetail'), rpClose:$('#rpClose'),
  uploadInput:$('#defUpload'),
  resGrid:$('#resGrid'), resFilter:$('#resFilter'), resSearch:$('#resSearch'), resPath:$('#resPath'), resUp:$('#resUp'),
  resTaskGrid:$('#resTaskGrid'), resTaskFilter:$('#resTaskFilter'),
};

// ---------- Workflow tab model ----------
function newWorkflow(name){
  return {id:null,name:name||'未命名工作流',nodes:[],edges:[],dirty:false,savedName:name||'未命名工作流'};
}
function activeWf(){return state.tabs[state.activeIdx]||null;}

// ---------- Library ----------
function renderLibrary(){
  let h='<div class="lib-cat"><div class="lib-cat-h"><span class="chev">▾</span>通用节点</div>';
  GENERIC.forEach(g=>{
    h+=`<div class="lib-item" data-add="${g.type}"><span class="ico">${g.ico}</span>${g.name}`+
       (g.out?`<span class="swatch" style="background:${PORT_COLORS[g.out.type]}"></span>`:'<span class="tag">透传</span>')+`</div>`;
  });
  h+='</div><div class="lib-cat"><div class="lib-cat-h"><span class="chev">▾</span>自定义节点 (${state.defList.length})</div>';
  state.defList.forEach(d=>{
    h+=`<div class="lib-item" data-add="custom" data-def="${esc(d.id)}"><span class="ico">🎨</span>${esc(d.name)}<span class="tag">${esc(d.id.slice(-6))}</span><span class="lib-del" data-del-def="${esc(d.id)}" title="删除定义">✕</span></div>`;
  });
  h+='</div>';
  dom.lib.innerHTML=h;
  $$('#nodeLib .lib-del').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();deleteDef(el.dataset.delDef);}));
  $$('#nodeLib .lib-item').forEach(el=>{
    // click = add at center
    el.addEventListener('click',()=>addFromLib(el));
    // double-click = also add at center
    el.addEventListener('dblclick',()=>addFromLib(el));
    // drag to canvas
    el.draggable=true;
    el.addEventListener('dragstart',e=>{
      el.classList.add('dragging');
      const data={add:el.dataset.add};
      if(el.dataset.def)data.defId=el.dataset.def;
      e.dataTransfer.setData('text/plain',JSON.stringify(data));
      e.dataTransfer.effectAllowed='copy';
    });
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
  });
}

function addFromLib(el){
  const wf=activeWf();if(!wf)return;
  const t=el.dataset.add;
  if(t==='custom')addNode('custom',{defId:el.dataset.def});
  else addNode(t,{});
}

// ---------- Node port specs ----------
function nodeOutPorts(n){
  if(n.type==='custom'){const d=state.defs[n.data.defId];return (d&&d.ports.outputs)||[];}
  const g=GENERIC.find(x=>x.type===n.type);
  if(!g||!g.out)return [];
  if(n.type==='output')return [{name:'out',type:inferredOutType(n)}];
  return [g.out];
}
function nodeInPorts(n){
  if(n.type==='custom'){const d=state.defs[n.data.defId];return (d&&d.ports.inputs)||[];}
  if(n.type==='output')return [{name:'in',type:'any'}];
  const g=GENERIC.find(x=>x.type===n.type);
  if(g&&g.in)return [g.in];
  return [];
}
function inferredOutType(n){
  // output node type follows its incoming edge type
  const wf=activeWf(); if(!wf)return 'image';
  const e=wf.edges.find(ed=>ed.to===n.id+'.in');
  return e?e.type:'image';
}
function canConnect(fromType,toType){
  if(toType==='any')return true;
  if(fromType===toType)return true;
  if(fromType==='int'&&toType==='float')return true;
  return false;
}

// ---------- Add node ----------
let nodeSeq=0;
function addNode(type,data){
  const wf=activeWf(); if(!wf)return;
  const prefix=type==='image-process'?'proc':type.split('-')[0].slice(0,4);
  const id=type==='custom'?'c'+(++nodeSeq):prefix+(++nodeSeq);
  const n={id,type,x:120+Math.random()*40,y:120+Math.random()*40,data};
  wf.nodes.push(n); wf.dirty=true;
  renderCanvas(); renderTabs(); selectNode(n.id);
}

// ---------- Render canvas ----------
function applyViewport(){
  const v=state.viewport;
  dom.content.style.transform=`translate(${v.x}px,${v.y}px) scale(${v.scale})`;
}
function renderCanvas(){
  const wf=activeWf();
  // remove old node elements
  $$('#canvasContent .node').forEach(el=>el.remove());
  if(!wf){renderConnections();return;}
  wf.nodes.forEach(n=>dom.content.appendChild(buildNodeEl(n)));
  renderConnections(); renderTabs();
}
function buildNodeEl(n){
  const el=document.createElement('div');
  el.className='node'; el.dataset.id=n.id;
  el.style.left=n.x+'px'; el.style.top=n.y+'px';
  const wf=activeWf();
  const taskState=currentTaskNodeStatus(n.id);
  let badge='';
  if(taskState){const map={queued:'⏳ 排队',running:'运行中',completed:'✓',failed:'✗',skipped:'⤵'};badge=`<div class="status-badge ${taskState}">${map[taskState]||''}</div>`;}
  const ins=nodeInPorts(n), outs=nodeOutPorts(n);
  let body='';
  if(n.type==='image-input'||n.type==='video-input'){
    const kind=n.type==='image-input'?'image':'video';
    const p=(n.data.fileRef&&n.data.fileRef.path)||n.data.path;
    const isPlaceholder=!p||p==='(拖放文件请重新选择)';
    let thumbHtml;
    if(isPlaceholder){thumbHtml=`<div class="thumb placeholder">${kind==='image'?'🖼':'🎬'}</div>`;}
    else{const url=`/api/file?path=${encodeURIComponent(p)}`;thumbHtml=`<img class="thumb" src="${url}" alt="">`;}
    const metaHtml=isPlaceholder
      ?`<div class="meta"><span class="src">未选择</span><span class="hint">点击选择文件</span></div>`
      :`<div class="meta"><span class="src">${esc(p.split('/').pop())}</span><span class="hint">${esc(p)}</span></div>`;
    body=`<div class="ed-file">${thumbHtml}${metaHtml}<button class="pick" data-pick="${kind}">选择</button></div>`;
  }else if(n.type==='text-input'){
    body=`<textarea class="ed-text" data-field="value" placeholder="输入文本...">${esc(n.data.value||'')}</textarea>`;
  }else if(n.type==='int-input'||n.type==='float-input'){
    body=`<div class="ed-num"><input type="number" data-field="value" value="${esc(n.data.value!=null?n.data.value:'')}" step="${n.type==='float-input'?'0.1':'1'}"></div>`;
  }else if(n.type==='output'){
    body=`<div class="hint">透传：保存输入为结果，并继续向下游输出</div>`;
  }else if(n.type==='image-process'){
    const d=n.data||{};
    const ip=(k,lab,val,ph)=>`<div class="ed-port-row"><span class="pn">${lab}</span><input data-field="${k}" value="${esc(val==null?'':val)}" placeholder="${ph||''}"></div>`;
    body=`<div class="ed-ports">
      ${ip('width','宽',d.width,'如 800，空=自动')}
      ${ip('height','高',d.height,'如 800，空=自动')}
      <div class="ed-port-row"><span class="pn">裁剪</span><select data-field="crop" style="flex:1">
        ${['stretch','crop','pad'].map(m=>`<option value="${m}" ${d.crop===m?'selected':''}>${({stretch:'拉伸',crop:'裁剪',pad:'留白'})[m]}</option>`).join('')}
      </select></div>
      <div class="ed-port-row"><span class="pn">旋转°</span><input data-field="rotate" value="${esc(d.rotate||0)}"></div>
      <div class="ed-port-row"><span class="pn">翻转</span><label style="font-size:11px"><input type="checkbox" data-field="flipH" ${d.flipH?'checked':''}>水平</label> <label style="font-size:11px"><input type="checkbox" data-field="flipV" ${d.flipV?'checked':''}>垂直</label></div>
      <div class="ed-port-row"><span class="pn">格式</span><select data-field="format" style="flex:1">
        ${[['','保持'],['jpeg','JPEG'],['webp','WebP'],['png','PNG']].map(f=>`<option value="${f[0]}" ${d.format===f[0]?'selected':''}>${f[1]}</option>`).join('')}
      </select></div>
      ${ip('quality','质量',d.quality==null?80:d.quality,'1-100')}
    </div>`;
  }else if(n.type==='custom'){
    const d=state.defs[n.data.defId];
    if(!d){body=`<div class="hint" style="color:var(--danger)">定义缺失 ${esc(n.data.defId)}</div>`;}
    else{
      let rows='';
      d.ports.inputs.forEach(p=>{
        if((n.data.hiddenPorts||[]).includes(p.name))return;
        // skip ports that are connected (value comes from upstream)
        const connected=wf.edges.some(e=>e.to===n.id+'.'+p.name);
        if(connected)return;
        const v=n.data.portValues&&n.data.portValues[p.name]!=null?n.data.portValues[p.name]:p.default;
        rows+=`<div class="ed-port-row"><span class="pn">${esc(p.name)}</span><input data-port="${esc(p.name)}" value="${esc(v==null?'':v)}"></div>`;
      });
      body=`<div class="ed-ports">${rows||'<div class="hint">所有输入已连接</div>'}</div>`;
    }
  }
  let inHtml='<div class="ports-col in">';
  ins.forEach(p=>inHtml+=portHtml(p,false,n.id));
  inHtml+='</div>';
  let outHtml='<div class="ports-col out">';
  outs.forEach(p=>outHtml+=portHtml(p,true,n.id));
  outHtml+='</div>';
  const ico=n.type==='custom'?'🎨':(GENERIC.find(g=>g.type===n.type)||{}).ico||'◆';
  const title=n.type==='custom'?(state.defs[n.data.defId]&&state.defs[n.data.defId].name||'自定义节点'):((GENERIC.find(g=>g.type===n.type)||{}).name||n.type);
  el.innerHTML=`${badge}<div class="node-h"><span class="ico">${ico}</span><span class="title">${esc(title)}</span><span class="type-badge">${esc(n.type)}</span><span class="x">×</span></div>`+
    `<div class="node-body">${body}</div><div class="ports">${inHtml}${outHtml}</div>`+
    `<div class="node-handle" data-resize="${esc(n.id)}"></div>`;
  // events
  el.addEventListener('mousedown',e=>onNodeMouseDown(e,n),true);
  el.querySelector('.x').addEventListener('click',e=>{e.stopPropagation();deleteNode(n.id);});
  el.addEventListener('click',e=>{if(!e.target.closest('.pdot')&&!e.target.closest('button')&&!e.target.matches('input,textarea'))selectNode(n.id);});
  $$('.pick',el).forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();openPicker(b.dataset.pick,(path)=>{n.data.fileRef={rootId:'main',path};delete n.data.path;wf.dirty=true;renderCanvas();});}));
  $$('input[data-field]',el).forEach(inp=>inp.addEventListener('input',()=>{n.data[inp.dataset.field]=inp.value;wf.dirty=true;}));
  $$('select[data-field]',el).forEach(sel=>sel.addEventListener('change',()=>{n.data[sel.dataset.field]=sel.value;wf.dirty=true;}));
  $$('input[type=checkbox][data-field]',el).forEach(chk=>chk.addEventListener('change',()=>{n.data[chk.dataset.field]=chk.checked;wf.dirty=true;}));
  $$('textarea[data-field]',el).forEach(inp=>inp.addEventListener('input',()=>{n.data[inp.dataset.field]=inp.value;wf.dirty=true;}));
  $$('input[data-port]',el).forEach(inp=>inp.addEventListener('input',()=>{n.data.portValues=n.data.portValues||{};n.data.portValues[inp.dataset.port]=inp.value;wf.dirty=true;}));
  // resize handle
  const handle=el.querySelector('.node-handle');
  if(handle)handle.addEventListener('mousedown',e=>{
    e.stopPropagation();e.preventDefault();
    const v=state.viewport, rect=el.getBoundingClientRect();
    const sw=rect.width, sh=rect.height, sx=e.clientX, sy=e.clientY;
    document.body.style.userSelect='none';document.body.style.cursor='nwse-resize';
    const move=ev=>{
      const newW=Math.max(180*v.scale, sw+(ev.clientX-sx));
      const newH=Math.max(60*v.scale, sh+(ev.clientY-sy));
      el.style.width=(newW/v.scale)+'px';
      el.style.height=(newH/v.scale)+'px';
    };
    const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);document.body.style.userSelect='';document.body.style.cursor='';renderConnections();};
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  });
  return el;
}
function portHtml(p,isOut,nodeId){
  const t=p.type==='any'?'any':p.type;
  return `<div class="port ${t}" data-node="${nodeId}" data-port="${esc(p.name)}" data-out="${isOut?1:0}"><span class="pn">${esc(p.name)}</span><span class="pdot"></span></div>`;
}
function currentTaskNodeStatus(nodeId){
  if(!state.activeTaskNodeStatus)return null;
  return state.activeTaskNodeStatus[nodeId]||null;
}

// ---------- Connections ----------
function portCenter(nodeId,portName,isOut){
  const sel=`.port[data-node="${CSS.escape(nodeId)}"][data-port="${CSS.escape(portName)}"][data-out="${isOut?1:0}"]`;
  const el=dom.content.querySelector(sel); if(!el)return null;
  const cr=dom.content.getBoundingClientRect(), pr=el.getBoundingClientRect();
  const s=state.viewport.scale;
  return {x:(pr.left+pr.width/2-cr.left)/s, y:(pr.top+pr.height/2-cr.top)/s, type:el.classList[1]};
}
function renderConnections(){
  // keep defs, clear paths
  $$('#connLayer > path').forEach(p=>p.remove());
  const wf=activeWf(); if(!wf)return;
  wf.edges.forEach(e=>{
    const [fn,fp]=e.from.split('.'); const [tn,tp]=e.to.split('.');
    const a=portCenter(fn,fp,true), b=portCenter(tn,tp,false);
    if(!a||!b)return;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('class',`conn ${e.type}${e===state.selEdge?' selected':''}`);
    path.setAttribute('d',bezier(a,b));
    path.setAttribute('marker-end',`url(#ah-${e.type})`);
    path.dataset.edge=e.id;
    path.style.pointerEvents='stroke';
    path.addEventListener('click',ev=>{ev.stopPropagation();state.selEdge=e;renderConnections();});
    dom.conn.appendChild(path);
  });
}
function bezier(a,b){const dx=Math.abs(b.x-a.x)*0.5;return `M ${a.x} ${a.y} C ${a.x+dx} ${a.y}, ${b.x-dx} ${b.y}, ${b.x} ${b.y}`;}

// port drag to create connection — start from anywhere on a port row
dom.content.addEventListener('mousedown',e=>{
  const portEl=e.target.closest('.port'); if(!portEl)return;
  e.preventDefault(); e.stopPropagation();
  const isOut=portEl.dataset.out==='1';
  const nodeId=portEl.dataset.node, portName=portEl.dataset.port;
  const type=portEl.classList[1];
  state.dragging={fromNode:nodeId,fromPort:portName,fromType:type,fromIsOut:isOut};
  portEl.classList.add('drag-src');
  const move=ev=>{
    const p=screenToContent(ev.clientX,ev.clientY);
    drawTemp(isOut?{x:portCenter(nodeId,portName,true).x,y:portCenter(nodeId,portName,true).y,type}:null,p,isOut);
    // highlight compatible drop targets
    const hit=document.elementFromPoint(ev.clientX,ev.clientY);
    const hp=hit&&hit.closest('.port');
    $$('#canvasContent .port.drop-hot').forEach(x=>x.classList.remove('drop-hot'));
    if(hp&&hp!==portEl){
      const hIsOut=hp.dataset.out==='1', hType=hp.classList[1];
      const ok = isOut?(hIsOut?false:canConnect(type,hType)):(hIsOut?canConnect(hType,type):false);
      if(ok)hp.classList.add('drop-hot');
    }
  };
  const up=ev=>{
    document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
    clearTemp();
    portEl.classList.remove('drag-src');
    $$('#canvasContent .port.drop-hot').forEach(x=>x.classList.remove('drop-hot'));
    const tgt=document.elementFromPoint(ev.clientX,ev.clientY);
    const tpe=tgt&&tgt.closest('.port');
    if(tpe&&tpe!==portEl){
      const tIsOut=tpe.dataset.out==='1', tNode=tpe.dataset.node, tPort=tpe.dataset.port, tType=tpe.classList[1];
      // must connect out→in
      let from,to,fromType,toType;
      if(isOut&&!tIsOut){from={node:nodeId,port:portName};to={node:tNode,port:tPort};fromType=type;toType=tType;}
      else if(!isOut&&tIsOut){from={node:tNode,port:tPort};to={node:nodeId,port:portName};fromType=tType;toType=type;}
      else{return;}
      if(!canConnect(fromType,toType)){toast(`类型不兼容: ${fromType} → ${toType}`,'error');return;}
      addEdge(from.node,from.port,to.node,to.port,fromType);
    }
    state.dragging=null;
  };
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
});
function drawTemp(from,to,isOut){
  clearTemp();
  let a,b;
  if(isOut){a=portCenter(state.dragging.fromNode,state.dragging.fromPort,true);b=to;}
  else{a=to;b=portCenter(state.dragging.fromNode,state.dragging.fromPort,false);}
  if(!a||!b)return;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('class',`conn ${state.dragging.fromType}`);
  path.setAttribute('d',bezier(a,b));
  path.setAttribute('stroke-dasharray','5 4');
  path.id='_tempConn';
  dom.conn.appendChild(path);
}
function clearTemp(){const t=$('#_tempConn');if(t)t.remove();}
function addEdge(fn,fp,tn,tp,type){
  const wf=activeWf(); if(!wf)return;
  // remove existing edge into target port (single-input rule)
  wf.edges=wf.edges.filter(e=>e.to!==tn+'.'+tp);
  // no self loop
  if(fn===tn)return;
  const id='e'+(++nodeSeq);
  wf.edges.push({id,from:`${fn}.${fp}`,to:`${tn}.${tp}`,type});
  wf.dirty=true;
  // check cycle
  if(hasCycle(wf)){toast('连接会形成环路','error');wf.edges.pop();}
  renderCanvas();
}
function hasCycle(wf){
  const adj={};wf.nodes.forEach(n=>adj[n.id]=[]);
  wf.edges.forEach(e=>{const[f]=e.from.split('.');const[t]=e.to.split('.');adj[f].push(t);});
  const color={};let cyc=false;
  function dfs(u){color[u]=1;(adj[u]||[]).forEach(v=>{if(!color[v])dfs(v);else if(color[v]===1)cyc=true;});color[u]=2;}
  wf.nodes.forEach(n=>{if(!color[n.id])dfs(n.id);});
  return cyc;
}
function screenToContent(sx,sy){
  const cr=dom.content.getBoundingClientRect(), v=state.viewport;
  return {x:(sx-cr.left)/v.scale, y:(sy-cr.top)/v.scale};
}

// ---------- Node drag / select / delete ----------
function onNodeMouseDown(e,n){
  if(e.target.closest('.port')||e.target.closest('button')||e.target.matches('input,textarea'))return;
  const wf=activeWf(); if(!wf)return;
  selectNode(n.id);
  const startX=e.clientX, startY=e.clientY, ox=n.x, oy=n.y;
  const move=ev=>{n.x=ox+(ev.clientX-startX)/state.viewport.scale;n.y=oy+(ev.clientY-startY)/state.viewport.scale;wf.dirty=true;
    const el=dom.content.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`);if(el){el.style.left=n.x+'px';el.style.top=n.y+'px';}renderConnections();};
  const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);renderTabs();};
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
}
function selectNode(id){state.selNode=id;state.selEdge=null;$$('#canvasContent .node').forEach(el=>el.classList.toggle('selected',el.dataset.id===id));renderProperties();renderConnections();}
function deleteNode(id){
  const wf=activeWf();if(!wf)return;
  wf.nodes=wf.nodes.filter(n=>n.id!==id);
  wf.edges=wf.edges.filter(e=>!e.from.startsWith(id+'.')&&!e.to.startsWith(id+'.'));
  wf.dirty=true;renderCanvas();renderProperties();
}
function deleteEdge(edge){const wf=activeWf();if(!wf)return;wf.edges=wf.edges.filter(e=>e!==edge);wf.dirty=true;renderConnections();}

// ---------- Pan / zoom ----------
let panState=null;
dom.center.addEventListener('mousedown',e=>{
  if(e.target.closest('.node')||e.target.closest('.pdot')||e.target.closest('button'))return;
  panState={x:e.clientX,y:e.clientY,vx:state.viewport.x,vy:state.viewport.y};
  selectNode(null);
  const move=ev=>{state.viewport.x=panState.vx+(ev.clientX-panState.x);state.viewport.y=panState.vy+(ev.clientY-panState.y);applyViewport();};
  const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);panState=null;};
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
});
dom.center.addEventListener('wheel',e=>{
  e.preventDefault();
  const v=state.viewport, delta=-e.deltaY*0.001;
  const ns=Math.max(0.4,Math.min(2,v.scale*(1+delta)));
  // zoom toward cursor
  const cr=dom.center.getBoundingClientRect();
  const mx=e.clientX-cr.left, my=e.clientY-cr.top;
  v.x=mx-(mx-v.x)*(ns/v.scale); v.y=my-(my-v.y)*(ns/v.scale); v.scale=ns;
  applyViewport();renderConnections();
},{passive:false});

// ---------- Tabs ----------
function renderTabs(){
  let h='';
  state.tabs.forEach((t,i)=>{
    h+=`<div class="wf-tab ${i===state.activeIdx?'active':''}" data-tab="${i}"><span class="wt-name">${esc(t.name)}</span>${t.dirty?'<span class="wt-dirty" title="未保存"></span>':''}<span class="wt-x" data-close="${i}">×</span></div>`;
  });
  h+='<span class="wf-add" title="新建工作流">＋</span>';
  dom.tabs.innerHTML=h;
  $$('#wfTabs .wf-tab').forEach(el=>el.addEventListener('click',e=>{
    if(e.target.classList.contains('wt-x')){closeTab(+e.target.dataset.close);return;}
    switchTab(+el.dataset.tab);
  }));
  $('.wf-add',dom.tabs).addEventListener('click',()=>{state.tabs.push(newWorkflow());switchTab(state.tabs.length-1);renderTabs();});
  const wf=activeWf();
  dom.wfId.textContent=wf?(wf.id?`${wf.id} · ${wf.dirty?'未保存':'已保存'}`:'新工作流 · 未保存'):'';
  dom.btnSave.disabled=!wf||!wf.dirty;
}
function switchTab(i){state.activeIdx=i;state.activeTaskNodeStatus=null;renderCanvas();renderProperties();renderTabs();stopPoll();}
function closeTab(i){
  const t=state.tabs[i]; if(!t)return;
  if(t.dirty&&!confirm(`关闭「${t.name}」?未保存的改动将丢失`))return;
  state.tabs.splice(i,1);
  if(state.activeIdx>=state.tabs.length)state.activeIdx=state.tabs.length-1;
  renderCanvas();renderTabs();renderProperties();
}

// ---------- Right panel: properties / log ----------
$('.pane-right .tabs').addEventListener('click',e=>{
  const t=e.target.closest('.tab');
  if(!t||!t.dataset.rtab)return;
  $$('.pane-right .tabs .tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const k=t.dataset.rtab;
  $$('.rpane').forEach(p=>p.classList.toggle('hidden',p.dataset.rpane!==k));
});
function renderProperties(){
  const pane=$('.rpane[data-rpane="props"]');
  const wf=activeWf(); if(!wf){pane.innerHTML='<div class="hint">无打开的工作流</div>';return;}
  const n=state.selNode?wf.nodes.find(x=>x.id===state.selNode):null;
  if(!n){pane.innerHTML='<div class="hint">选中一个节点查看属性</div>';return;}
  let h=`<div class="pane-section"><h4>${esc(n.type==='custom'?(state.defs[n.data.defId]&&state.defs[n.data.defId].name||'自定义节点'):n.type)}</h4>`;
  h+=`<div class="prop-row"><span class="k">节点 ID</span><span class="v">${esc(n.id)}</span></div>`;
  h+=`<div class="prop-row"><span class="k">类型</span><span class="v">${esc(n.type)}</span></div>`;
  if(n.type==='custom')h+=`<div class="prop-row"><span class="k">定义</span><span class="v">${esc(n.data.defId)}</span></div>`;
  h+=`<div class="prop-row"><span class="k">位置</span><span class="v">${Math.round(n.x)}, ${Math.round(n.y)}</span></div></div>`;
  const ins=nodeInPorts(n),outs=nodeOutPorts(n);
  if(ins.length){h+=`<div class="pane-section"><h4>输入端口 (${ins.length})</h4>`;
    ins.forEach(p=>{const e=wf.edges.find(ed=>ed.to===n.id+'.'+p.name);h+=`<div class="prop-row"><span class="k">${esc(p.name)}</span><span class="v ${e?'accent':''}">${e?'← '+esc(e.from):'未连接'}</span></div>`;});h+='</div>';}
  if(outs.length){h+=`<div class="pane-section"><h4>输出端口 (${outs.length})</h4>`;
    outs.forEach(p=>{const es=wf.edges.filter(ed=>ed.from===n.id+'.'+p.name);h+=`<div class="prop-row"><span class="k">${esc(p.name)}</span><span class="v ${es.length?'accent':''}">${es.length?'→ '+es.map(e=>esc(e.to)).join(', '):'未连接'}</span></div>`;});h+='</div>';}
  pane.innerHTML=h;
}

// ---------- Save / load ----------
async function saveWf(){
  const wf=activeWf();if(!wf)return;
  try{
    if(wf.id){
      await api.putJson(`/api/ai/workflows/${wf.id}`,{name:wf.name,nodes:wf.nodes,edges:wf.edges});
    }else{
      const r=await api.postJson('/api/ai/workflows',{name:wf.name,nodes:wf.nodes,edges:wf.edges});
      wf.id=r.id;wf.name=r.name;
    }
    wf.dirty=false;wf.savedName=wf.name;renderTabs();toast('工作流已保存','success');loadWorkflowList();  }catch(e){toast(e.message,'error');}
}
async function saveAs(){
  const wf=activeWf();if(!wf)return;
  const name=prompt('另存为',wf.name+' 副本');if(!name)return;
  try{const r=await api.postJson('/api/ai/workflows',{name,nodes:wf.nodes,edges:wf.edges});
    state.tabs.push({id:r.id,name:r.name,nodes:wf.nodes,edges:wf.edges,dirty:false,savedName:r.name});
    switchTab(state.tabs.length-1);toast('已另存为 '+r.name,'success');loadWorkflowList();  }catch(e){toast(e.message,'error');}
}
function rename(){const wf=activeWf();if(!wf)return;const n=prompt('重命名工作流',wf.name);if(n){wf.name=n;wf.dirty=true;renderTabs();}}
async function loadWorkflowList(){
  try{
    const {workflows}=await api.getJson('/api/ai/workflows');
    const sel=$('#wfSelect');if(!sel)return;
    sel.innerHTML='<option value="">打开工作流...</option>';
    workflows.forEach(w=>{const o=document.createElement('option');o.value=w.id;o.textContent=`${w.name} (${w.id.slice(-10)})`;sel.appendChild(o);});
  }catch(e){toast(e.message,'error');}
}
async function openSelectedWorkflow(){
  const sel=$('#wfSelect');if(!sel||!sel.value)return;
  try{
    const w=await api.getJson(`/api/ai/workflows/${sel.value}`);
    state.tabs.push({id:w.id,name:w.name,nodes:w.nodes||[],edges:w.edges||[],dirty:false,savedName:w.name});
    switchTab(state.tabs.length-1);
    sel.value='';
  }catch(e){toast(e.message,'error');}
}
async function deleteWorkflow(){
  const sel=$('#wfSelect');if(!sel||!sel.value){toast('请先选择工作流','error');return;}
  const wname=sel.options[sel.selectedIndex].textContent;
  if(!confirm(`确定删除工作流「${wname}」?\n此操作不可撤销。`))return;
  try{await api.del(`/api/ai/workflows/${sel.value}`);toast('已删除','success');loadWorkflowList();}catch(e){toast(e.message,'error');}
}
async function deleteDef(defId){
  if(!confirm('确定删除该自定义节点定义?\n已使用该定义的工作流不受影响，但将无法执行。'))return;
  try{await api.del(`/api/ai/node-defs/${defId}`);await loadDefs();toast('已删除','success');}catch(e){toast(e.message,'error');}
}

// ---------- Resource library (right pane tab) ----------
let resCwd='';
async function browseResources(dir){
  resCwd=dir||'';
  const f=$('#resFilter'), s=$('#resSearch'), pathEl=$('#resPath'), grid=$('#resGrid');
  pathEl.textContent='📁 /'+resCwd;
  try{
    const data=await api.getJson(`/api/browse?path=${encodeURIComponent(resCwd)}`);
    const kind=f?f.value:'';
    const q=s?s.value.toLowerCase().trim():'';
    const dirs=data.entries.filter(e=>e.type==='directory');
    const files=data.entries.filter(e=>e.type==='file'&&matchesResourceKind(e.name,kind||'')&&(!q||e.name.toLowerCase().includes(q)));
    let h='';
    if(resCwd)h+=`<div class="res-item" data-nav="up"><div class="ri-thumb ph">📁</div><div class="ri-name">..</div></div>`;
    dirs.forEach(e=>h+=`<div class="res-item" data-nav="${esc(e.name)}"><div class="ri-thumb ph">📁</div><div class="ri-name">${esc(e.name)}</div></div>`);
    files.forEach(e=>{
      const isImg=/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(e.name);
      const url=`/api/file?path=${encodeURIComponent(resCwd?resCwd+'/'+e.name:e.name)}`;
      const th=isImg?`<img class="ri-thumb" src="${url}" alt="">`:`<div class="ri-thumb ph">🎬</div>`;
      h+=`<div class="res-item" data-file="${esc(e.name)}" data-path="${esc(resCwd?resCwd+'/'+e.name:e.name)}" data-kind="${isImg?'image':'video'}" draggable="true">${th}<div class="ri-name">${esc(e.name)}</div></div>`;
    });
    grid.innerHTML=h||'<div class="hint">空目录</div>';
    // click to navigate (folders / up)
    $$('#resGrid .res-item').forEach(el=>{
      el.addEventListener('click',()=>{
        if(el.dataset.nav==='up'){browseResources(resCwd.split('/').slice(0,-1).join('/'));return;}
        if(el.dataset.nav){browseResources(resCwd?resCwd+'/'+el.dataset.nav:el.dataset.nav);return;}
      });
    });
    bindResItems(grid);
  }catch(e){grid.innerHTML='<div class="hint">'+esc(e.message)+'</div>';}
}
function matchesResourceKind(name,kind){
  if(!kind||kind==='')return true;
  const ext=name.split('.').pop().toLowerCase();
  if(kind==='image')return ['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext);
  if(kind==='video')return ['mp4','webm','mov','avi','mkv'].includes(ext);
  return true;
}
$('#resFilter')?.addEventListener('change',()=>browseResources(resCwd));
$('#resSearch')?.addEventListener('input',()=>browseResources(resCwd));
$('#resUp')?.addEventListener('click',()=>browseResources(resCwd.split('/').slice(0,-1).join('/')));

// Resource library tab switching (file manager / historical task results)
$$('.rpane .tab[data-res-tab]').forEach(t=>t.addEventListener('click',()=>{
  $$('#rpaneBody .tab[data-res-tab]').forEach(x=>x.classList.remove('active'));t.classList.add('active');
  const isFm=t.dataset.resTab==='fm';
  $$('#rpaneBody [data-res-pane="fm"]').forEach(p=>p.style.display=isFm?'flex':'none');
  $$('#rpaneBody [data-res-pane="tasks"]').forEach(p=>p.style.display=isFm?'none':'flex');
  if(isFm)browseResources(resCwd);
  else browseTaskResourceResults();
}));
$('#resTaskFilter')?.addEventListener('change',()=>browseTaskResourceResults());

async function browseTaskResourceResults(){
  const grid=dom.resTaskGrid;if(!grid)return;
  grid.innerHTML='<div class="hint">加载中...</div>';
  const kind=dom.resTaskFilter?.value||'image';
  try{
    const {tasks}=await api.getJson('/api/ai/tasks');
    const completed=tasks.filter(t=>t.status==='completed'&&t.results&&t.results.length);
    if(!completed.length){grid.innerHTML='<div class="hint">无已完成任务的结果</div>';return;}
    let h='';
    completed.forEach(t=>{
      t.results.filter(r=>r.type===kind).forEach(r=>{
        const url=`/api/ai/file?path=${encodeURIComponent(r.file)}`;
        const th=kind==='image'?`<img class="ri-thumb" src="${url}" alt="">`:`<div class="ri-thumb ph">🎬</div>`;
        h+=`<div class="res-item" data-file="${esc(r.file.split('/').pop())}" data-path="${esc(r.file)}" data-kind="${esc(kind)}" draggable="true">${th}<div class="ri-name" title="任务: ${esc(t.workflowName)}">${esc(t.workflowName)} · ${esc(r.file.split('/').pop())}</div></div>`;
      });
    });
    grid.innerHTML=h||'<div class="hint">无匹配的结果文件</div>';
    bindResItems(grid);
  }catch(e){grid.innerHTML='<div class="hint">'+esc(e.message)+'</div>';}
}

function bindResItems(grid){
  $$('.res-item',grid).forEach(el=>{
    el.addEventListener('click',()=>{/* handled by dblclick */});
    el.addEventListener('dragstart',e=>{
      if(!el.dataset.file)return;
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain',JSON.stringify({kind:el.dataset.kind,path:el.dataset.path,name:el.dataset.file}));
      e.dataTransfer.effectAllowed='copy';
    });
    el.addEventListener('dragend',()=>el.classList.remove('dragging'));
    el.addEventListener('dblclick',()=>{
      if(!el.dataset.file)return;
      const wf=activeWf();if(!wf)return;
      const type=el.dataset.kind==='image'?'image-input':'video-input';
      const id=type.slice(0,4)+(++nodeSeq);
      const n={id,type,x:160+Math.random()*40,y:160+Math.random()*40,data:{fileRef:{rootId:'main',path:el.dataset.path}}};
      wf.nodes.push(n);wf.dirty=true;
      renderCanvas();renderTabs();
    });
  });
}

// patch existing browseResources to also use bindResItems
const _origBrowseResources=browseResources;
browseResources=function(dir){
  _origBrowseResources(dir);
  bindResItems(dom.resGrid);
};

// ---------- Execute + poll ----------
async function execute(){
  const wf=activeWf();if(!wf||!wf.id){toast('请先保存工作流','error');return;}
  try{validateWf(wf);}catch(e){toast(e.message,'error');return;}
  // auto-save if dirty so the server runs the latest canvas state
  if(wf.dirty){try{await api.putJson(`/api/ai/workflows/${wf.id}`,{name:wf.name,nodes:wf.nodes,edges:wf.edges});wf.dirty=false;}catch(e){toast('保存失败: '+e.message,'error');return;}}
  dom.btnRun.disabled=true;dom.btnRun.textContent='提交中…';
  const count=Math.max(1,Math.min(100,parseInt($('#execCount').value,10)||1));
  $('#execCount').value=count;
  let ok=0,fail=0;
  for(let i=0;i<count;i++){
    if(i>0)await new Promise(r=>setTimeout(r,2000));
    try{
      await api.postJson('/api/ai/tasks',{workflowId:wf.id});
      ok++;
    }catch(e){fail++;toast(`第 ${i+1} 次提交失败: ${e.message}`,'error');}
  }
  if(count>1)toast(`已提交 ${count} 次执行 (${ok} 提交 ${fail} 失败)`,'success');
  else if(ok)toast('任务已提交','success');
  dom.btnRun.disabled=false;dom.btnRun.textContent='▶ 执行';
  renderTaskDock();
}
function validateWf(wf){
  if(!wf.nodes.length)throw new Error('画布为空');
  if(!wf.nodes.some(n=>n.type==='output'))throw new Error('至少需要一个输出节点');
  if(hasCycle(wf))throw new Error('画布存在环路');
  for(const e of wf.edges){if(!wf.nodes.find(n=>n.id===e.from.split('.')[0])||!wf.nodes.find(n=>n.id===e.to.split('.')[0]))throw new Error('存在悬空连接');}
}
function startPoll(taskId){
  stopPoll();
  state.pollTimer=setInterval(()=>pollOnce(taskId),1000);
  pollOnce(taskId);
}
function stopPoll(){if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null;}}
async function pollOnce(taskId){
  try{
    const t=await api.getJson(`/api/ai/tasks/${taskId}`);
    updateQueueBar(t);
    updateNodeStatuses(t);
    if(['queued','running','paused','terminating'].includes(t.status)){dom.btnRun.disabled=true;dom.btnTerm.disabled=t.status==='terminating';}
    else{
      stopPoll();dom.btnRun.disabled=false;dom.btnTerm.disabled=true;
      if(t.status==='completed'){showResultPop(t);}else if(t.status==='failed'||t.status==='aborted'){toast(`任务${t.status==='aborted'?'已终止':'失败'}: ${t.error||''}`,'error');}
      renderTaskDock();
    }
    renderLog(t);
    renderTaskDock();
  }catch(_){}
}
function updateQueueBar(t){
  const active=['queued','running','paused','terminating'].includes(t.status);
  dom.qPill.classList.toggle('hidden',!active);
  if(active){dom.qCurId.textContent=t.id;dom.qCurStep.textContent=`${t.currentStep}/${t.stepCount}`;dom.qCurName.textContent=(t.steps&&t.steps[t.currentStep-1]&&t.steps[t.currentStep-1].nodeName)||t.status;}
  dom.qRunning.textContent=t.status==='running'?'1':'0';
}
function updateNodeStatuses(t){
  if(!t.steps||state.activeTaskWfId!==(activeWf()&&activeWf().id)){return;}
  const map={};t.steps.forEach(s=>{map[s.nodeId]=s.status;});
  state.activeTaskNodeStatus=map;
  // re-render badges without full rebuild
  $$('#canvasContent .node').forEach(el=>{
    const st=map[el.dataset.id];const old=el.querySelector('.status-badge');
    const classMap={queued:'queued',running:'running',completed:'done',failed:'failed',skipped:'skipped'};
    const txtMap={queued:'⏳ 排队',running:'运行中',completed:'✓',failed:'✗',skipped:'⤵'};
    if(st){el.classList.toggle('executing',st==='running');
      if(old){old.className='status-badge '+classMap[st];old.textContent=txtMap[st];}
      else{const b=document.createElement('div');b.className='status-badge '+classMap[st];b.textContent=txtMap[st];el.insertBefore(b,el.firstChild);}
    }else{if(old)old.remove();el.classList.remove('executing');}
  });
}
function renderLog(t){
  const pane=$('.rpane[data-rpane="log"]');
  if(!t){pane.innerHTML='<div class="hint">暂无日志</div>';return;}
  // fetch log text (only if task panel active) — for running tasks, fetch tail
  fetch(`/api/ai/tasks/${t.id}/log`).then(r=>r.text()).then(txt=>{
    const lines=txt.split('\n').filter(Boolean).slice(-200);
    let h='<div class="log-bar"><button class="btn" id="dlLog">下载日志</button></div><div class="log">';
    lines.forEach(l=>{const m=l.match(/\[(INFO|WARN|ERROR|OK)\]/i);const lv=m?m[1].toLowerCase():'info';
      h+=`<div class="ln"><span class="ts"></span><span class="lv ${lv==='error'?'err':lv}">${lv}</span><span class="st"></span>${esc(l)}</div>`;});
    h+='</div>';pane.innerHTML=h;
    const dl=$('#dlLog');if(dl)dl.addEventListener('click',()=>{window.open(`/api/ai/tasks/${t.id}/log`);});
    const logEl=pane.querySelector('.log');if(logEl)logEl.scrollTop=logEl.scrollHeight;
  }).catch(()=>{pane.innerHTML='<div class="hint">暂无日志</div>';});
}

// ---------- Task dock ----------
async function renderTaskDock(){
  let data;
  try{data=await api.getJson('/api/ai/tasks');}catch(_){return;}
  const all=[...data.live,...data.tasks];
  // dedupe by id (live overrides)
  const seen=new Set();const rows=[];
  data.live.forEach(t=>{seen.add(t.id);rows.push(t);});
  data.tasks.forEach(t=>{if(!seen.has(t.id)){seen.add(t.id);rows.push(t);}});
  // counts
  const cnt={running:0,queued:0,paused:0,terminating:0,completed:0,failed:0,aborted:0,cancelled:0};
  rows.forEach(t=>{cnt[t.status]=(cnt[t.status]||0)+1;});
  $('#dockRunning').textContent=(cnt.running||0)+(cnt.paused||0)+(cnt.terminating||0);
  $('#dockQueued').textContent=cnt.queued||0;
  $('#dockDone').textContent=cnt.completed||0;
  $('#dockFailed').textContent=(cnt.failed||0)+(cnt.aborted||0);
  let h='<table class="task-table"><thead><tr><th style="width:90px">状态</th><th style="width:130px">任务 ID</th><th>工作流</th><th style="width:150px">进度</th><th style="width:90px">执行耗时</th><th style="width:180px">操作</th></tr></thead><tbody>';
  rows.slice(0,20).forEach(t=>{
    const stCls=t.status;const stTxt={running:'运行中',queued:'排队',paused:'已暂停',terminating:'终止中',completed:'完成',failed:'失败',aborted:'已终止',cancelled:'已取消'}[t.status]||t.status;
    const prog=['running','paused','terminating'].includes(t.status)?`步骤 ${t.currentStep}/${t.stepCount}`:(t.stepCount?`${t.stepCount}步`:'');
    const dur=t.execDurationMs!=null?(t.execDurationMs/1000).toFixed(1)+'s':(t.durationMs?(t.durationMs/1000).toFixed(1)+'s':(['running','paused','terminating'].includes(t.status)?'…':''));
    let acts='';
    if(t.status==='queued')acts='<button class="btn danger" data-act="cancel">取消</button>';
    else if(t.status==='running')acts='<button class="btn" data-act="pause">暂停</button><button class="btn danger" data-act="term">⏹ 终止</button>';
    else if(t.status==='paused')acts='<button class="btn primary" data-act="resume">恢复</button><button class="btn danger" data-act="term">⏹ 终止</button>';
    else if(t.status==='terminating')acts='<button class="btn" disabled>终止中</button>';
    else if(t.status==='completed')acts='<button class="btn" data-act="dl">↓ 结果</button><button class="btn" data-act="log">日志</button>';
    else acts='<button class="btn" data-act="log">日志</button>';
    h+=`<tr class="${t.status==='running'?'running':''}" data-task="${esc(t.id)}"><td><span class="tstatus ${stCls}">${stTxt}</span></td><td class="tt-id">${esc(t.id.slice(-10))}</td><td class="tt-wf">${esc(t.workflowName)}</td><td class="tt-prog">${prog}</td><td class="tt-time">${dur}</td><td class="tt-actions">${acts}</td></tr>`;
  });
  h+='</tbody></table>';
  dom.dockBody.innerHTML=h;
  $$('#dockBody tr[data-task]').forEach(r=>r.addEventListener('click',e=>{
    if(e.target.closest('button')){const a=e.target.dataset.act;const id=r.dataset.task;
      if(a==='term'){taskControl(id,'terminate');}
      else if(a==='cancel'){taskControl(id,'cancel');}
      else if(a==='pause'){taskControl(id,'pause');}
      else if(a==='resume'){taskControl(id,'resume');}
      else if(a==='log')openDrawer(id);
      else if(a==='dl')openDrawer(id);
      return;
    }
    openDrawer(r.dataset.task);
  }));
}

// ---------- Task detail drawer ----------
async function openDrawer(taskId){
  dom.drawer.classList.add('show');dom.overlay.classList.add('show');
  dom.drawerTitle.innerHTML='任务详情 <span class="dt-id">'+esc(taskId.slice(-12))+'</span>';
  $$('.dpane').forEach(p=>p.classList.toggle('hidden',p.dataset.dpane!=='inputs'));
  dom.drawerTabs.forEach(t=>t.classList.toggle('active',t.dataset.dtab==='inputs'));
  $$('.dpane').forEach(p=>p.innerHTML='<div class="hint">加载中...</div>');
  try{
    const t=await api.getJson(`/api/ai/tasks/${taskId}`);
    let errBanner='', statBanner='';
    // exec duration
    if(t.execDurationMs!=null){
      const sec=(t.execDurationMs/1000).toFixed(1);
      statBanner='<div style="background:rgba(137,180,250,.08);border:1px solid var(--border);padding:8px 12px;border-radius:8px;margin-bottom:12px;font-size:12px;color:var(--text-2)">执行耗时：<b style="color:var(--accent)">'+sec+'秒</b></div>';
    }
    if(t.error){errBanner='<div style="background:rgba(243,139,168,.12);border:1px solid var(--danger);color:var(--danger);padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:12px">任务失败：'+esc(t.error)+'</div>';}
    renderDrawerInputs(t);renderDrawerResults(t);renderDrawerPrompt(t);renderDrawerLog(t);
    // prepend stat/error banners to each pane
    $$('.dpane').forEach(p=>{
      if(!p.querySelector('.err-banner')){
        if(statBanner){const b=document.createElement('div');b.className='err-banner';b.innerHTML=statBanner;p.insertBefore(b,p.firstChild);}
        if(errBanner){const b=document.createElement('div');b.className='err-banner';b.innerHTML=errBanner;p.insertBefore(b,p.firstChild);}
      }
    });
  }catch(e){dom.drawerBody.innerHTML='<div class="hint">'+esc(e.message)+'</div>';}
}
function renderDrawerInputs(t){
  const p=$('.dpane[data-dpane="inputs"]');
  if(!t.inputs||!t.inputs.length){p.innerHTML='<div class="hint">无输入资源</div>';return;}
  let h='<div class="pane-section"><h4>输入资源 ('+t.inputs.length+')</h4>';
  t.inputs.forEach(i=>{
    const ref=i.fileRef||(i.path?{rootId:'main',path:i.path}:null);
    if(ref){const dl=ref.rootId==='main'?`<a class="btn" href="/api/file?path=${encodeURIComponent(ref.path)}" download>↓</a>`:'';h+=`<div class="res-input-row"><div class="ri-thumb ph">${i.type==='image'?'🖼':'🎬'}</div><div class="ri-info"><div class="ri-node">${esc(i.nodeName)}</div><div class="ri-val">${esc(ref.path)}</div></div>${dl}</div>`;}
    else{h+=`<div class="res-input-row"><div class="ri-thumb ph">${i.type==='text'?'📝':'🔢'}</div><div class="ri-info"><div class="ri-node">${esc(i.nodeName)}</div><div class="ri-val">${esc(i.value)}</div></div></div>`;}
  });
  p.innerHTML=h+'</div>';
}
function renderDrawerResults(t){
  const p=$('.dpane[data-dpane="results"]');
  if(!t.results||!t.results.length){p.innerHTML='<div class="hint">无生成结果</div>';return;}
  let h='<div class="pane-section"><h4>生成结果 ('+t.results.length+')</h4>';
  h+='<div style="margin-bottom:10px"><a class="btn primary" href="/api/ai/tasks/'+t.id+'/results.zip" download>↓ 全部下载 (zip)</a></div><div class="res-grid">';
  t.results.forEach(r=>{
    const url=`/api/ai/file?path=${encodeURIComponent(r.file)}`;
    const th=r.type==='image'?`<img class="rc-thumb" src="${url}" alt="">`:r.type==='video'?`<div class="rc-thumb ph">🎬</div>`:`<div class="rc-thumb ph">📄</div>`;
    h+=`<div class="res-card">${th}<div class="rc-body"><div class="rc-name">${esc(r.file.split('/').pop())}</div><div class="rc-path">${esc(r.file)}</div><div class="rc-actions"><a class="btn" href="${url}" download>↓ 下载</a><button class="btn" data-open="${esc(r.file)}">在文件管理器中打开</button></div></div></div>`;
  });
  p.innerHTML=h+'</div></div>';
  $$('[data-open]',p).forEach(b=>b.addEventListener('click',()=>{window.location.href='/?#/'+b.dataset.open.replace(/\/[^/]*$/,'');}));
  // click to preview images/videos in detail drawer
  $$('.rc-thumb,.ri-thumb',p).forEach(el=>el.addEventListener('click',()=>previewMedia(el.src||el.currentSrc||'')));
}
function previewMedia(url){
  if(!url)return;
  const isVid=/\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url);
  const ov=$('#mediaPreviewOverlay'),img=$('#mediaPreviewImg'),vid=$('#mediaPreviewVid');
  ov.classList.add('show');ov.style.display='flex';
  if(isVid){vid.src=url;vid.hidden=false;img.hidden=true;vid.play().catch(()=>{});}
  else{img.src=url;img.hidden=false;vid.hidden=true;vid.pause();vid.removeAttribute('src');}
}
$('#mediaPreviewClose').addEventListener('click',()=>{$('#mediaPreviewOverlay').classList.remove('show');$('#mediaPreviewOverlay').style.display='none';$('#mediaPreviewVid').pause();});
$('#mediaPreviewOverlay').addEventListener('click',e=>{if(e.target===e.currentTarget){$('#mediaPreviewClose').click();}});

// Double-click image/video anywhere to open fullscreen preview
document.addEventListener('dblclick',e=>{
  const el=e.target;
  if(el.tagName==='IMG'&&el.src&&!el.src.startsWith('data:'))previewMedia(el.src);
  if(el.tagName==='VIDEO'&&el.src)previewMedia(el.src);
});

function renderDrawerLog(t){
  const p=$('.dpane[data-dpane="log"]');
  fetch(`/api/ai/tasks/${t.id}/log`).then(r=>r.text()).then(txt=>{
    const lines=txt.split('\n').filter(Boolean);
    let h='<div class="log-bar"><button class="btn" id="dlLogD">下载日志</button></div><div class="log">';
    lines.forEach(l=>{const m=l.match(/\[(INFO|WARN|ERROR|OK)\]/i);const lv=m?m[1].toLowerCase():'info';h+=`<div class="ln"><span class="lv ${lv==='error'?'err':lv}">${lv}</span>${esc(l)}</div>`;});
    p.innerHTML=h+'</div>';
    const dl=$('#dlLogD');if(dl)dl.addEventListener('click',()=>window.open(`/api/ai/tasks/${t.id}/log`));
  }).catch(()=>{p.innerHTML='<div class="hint">无日志</div>';});
}
function renderDrawerPrompt(t){
  const p=$('.dpane[data-dpane="prompt"]');
  fetch(`/api/ai/tasks/${t.id}/prompt`).then(r=>r.ok?r.json():null).then(data=>{
    if(!data||!data.length){p.innerHTML='<div class="hint">无提交的 prompt</div>';return;}
    let h='<div class="log-bar"><button class="btn" id="dlPrompt">下载 prompt JSON</button></div>';
    data.forEach(s=>{
      h+=`<div class="pane-section"><h4>步骤 ${s.step}: ${esc(s.nodeName)}</h4>`;
      h+='<pre class="log" style="white-space:pre-wrap;max-height:300px;overflow:auto">'+esc(JSON.stringify(s.prompt,null,2))+'</pre></div>';
    });
    p.innerHTML=h;
    const dl=$('#dlPrompt');if(dl)dl.addEventListener('click',()=>window.open(`/api/ai/tasks/${t.id}/prompt`));
  }).catch(()=>{p.innerHTML='<div class="hint">无提交的 prompt</div>';});
}
dom.drawerTabs.forEach(t=>t.addEventListener('click',()=>{
  dom.drawerTabs.forEach(x=>x.classList.remove('active'));t.classList.add('active');
  $$('.dpane').forEach(p=>p.classList.toggle('hidden',p.dataset.dpane!==t.dataset.dtab));
}));
dom.drawerClose.addEventListener('click',()=>{dom.drawer.classList.remove('show');dom.overlay.classList.remove('show');});

// ---------- Result popup ----------
function showResultPop(t){
  if(!t.results||!t.results.length)return;
  const r=t.results[0];const url=`/api/ai/file?path=${encodeURIComponent(r.file)}`;
  const img=$('#rpThumb');if(img)img.src=url;
  $('#rpDl').href=url;
  dom.resultPop.classList.add('show');
  setTimeout(()=>dom.resultPop.classList.remove('show'),8000);
}
if(dom.rpClose)dom.rpClose.addEventListener('click',()=>dom.resultPop.classList.remove('show'));
if(dom.rpDetail)dom.rpDetail.addEventListener('click',()=>{if(state.activeTaskId)openDrawer(state.activeTaskId);dom.resultPop.classList.remove('show');});

// ---------- File picker (browse file-manager) ----------
let pickerCwd='';
function openPicker(kind,callback){
  state.picker={kind,callback};
  pickerCwd='';
  dom.overlay.classList.add('show');dom.picker.classList.add('show');
  $$('.picker-tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  browsePicker('');
}
async function browsePicker(path){
  pickerCwd=path;
  try{
    const data=await api.getJson(`/api/browse?path=${encodeURIComponent(path)}`);
    dom.pickerPath.textContent='📁 /'+path;
    const items=data.entries.filter(e=>e.type==='directory'||matchesKind(e.name,state.picker.kind));
    let h='';
    if(path){const parent=path.split('/').slice(0,-1).join('/');h+=`<div class="pick-item" data-up="${esc(parent)}"><div class="pi-thumb ph">📁</div><span class="pi-name">..</span></div>`;}
    items.forEach(e=>{
      if(e.type==='directory'){h+=`<div class="pick-item" data-dir="${esc(e.name)}"><div class="pi-thumb ph">📁</div><span class="pi-name">${esc(e.name)}</span></div>`;}
      else{const p=path?path+'/'+e.name:e.name;h+=`<div class="pick-item" data-file="${esc(p)}"><div class="pi-thumb ph">${state.picker.kind==='image'?'🖼':'🎬'}</div><span class="pi-name">${esc(e.name)}</span></div>`;}
    });
    dom.pickerGrid.innerHTML=h||'<div class="hint">空目录</div>';
    $$('#pickerGrid .pick-item').forEach(el=>{
      el.addEventListener('click',()=>{
        if(el.dataset.dir){browsePicker(pickerCwd?pickerCwd+'/'+el.dataset.dir:el.dataset.dir);return;}
        if(el.dataset.up){browsePicker(el.dataset.up);return;}
        if(el.dataset.file){
          $$('#pickerGrid .pick-item').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');state.picker.selected=el.dataset.file;
        }
      });
    });
  }catch(e){dom.pickerGrid.innerHTML='<div class="hint">'+esc(e.message)+'</div>';}
}
function matchesKind(name,kind){
  const ext=name.split('.').pop().toLowerCase();
  if(kind==='image')return ['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext);
  if(kind==='video')return ['mp4','webm','mov','avi','mkv'].includes(ext);
  return false;
}
dom.pickerClose.addEventListener('click',closePicker);
dom.pickerCancel.addEventListener('click',closePicker);
dom.pickerOk.addEventListener('click',()=>{if(state.picker&&state.picker.callback&&state.picker.selected){state.picker.callback(state.picker.selected);}closePicker();});
function closePicker(){dom.overlay.classList.remove('show');dom.picker.classList.remove('show');state.picker=null;}

// Picker tab switching: file manager vs historical task results
$$('.picker-tab').forEach(t=>t.addEventListener('click',()=>{
  $$('.picker-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');
  pickerCwd='';
  if(t.dataset.ptab==='tasks')browseTaskResults();
  else browsePicker('');
}));
async function browseTaskResults(){
  dom.pickerPath.textContent='📁 历史任务结果';
  try{
    const {tasks}=await api.getJson('/api/ai/tasks');
    const completed=tasks.filter(t=>t.status==='completed'&&t.results&&t.results.length);
    if(!completed.length){dom.pickerGrid.innerHTML='<div class="hint">无已完成任务的结果</div>';return;}
    let h='';
    completed.forEach(t=>{
      const matching=t.results.filter(r=>(state.picker.kind==='image')?r.type==='image':r.type==='video');
      matching.forEach(r=>{
        const p=r.file;
        const url=`/api/ai/file?path=${encodeURIComponent(p)}`;
        const th=(r.type==='image')?`<img class="pi-thumb" src="${url}" alt="">`:`<div class="pi-thumb ph">🎬</div>`;
        h+=`<div class="pick-item" data-file="${esc(p)}">${th}<span class="pi-name">${esc(t.workflowName)} · ${esc(p.split('/').pop())}</span></div>`;
      });
    });
    dom.pickerGrid.innerHTML=h||'<div class="hint">无匹配的结果文件</div>';
    $$('#pickerGrid .pick-item').forEach(el=>el.addEventListener('click',()=>{
      $$('#pickerGrid .pick-item').forEach(x=>x.classList.remove('sel'));el.classList.add('sel');state.picker.selected=el.dataset.file;
    }));
  }catch(e){dom.pickerGrid.innerHTML='<div class="hint">'+esc(e.message)+'</div>';}
}

// ---------- Upload custom node def ----------
if(dom.libAdd)dom.libAdd.addEventListener('click',()=>dom.uploadInput.click());
if(dom.uploadInput)dom.uploadInput.addEventListener('change',async()=>{
  const f=dom.uploadInput.files[0];if(!f)return;
  let json;
  try{json=JSON.parse(await f.text());}
  catch(e){alert('JSON 解析失败：'+e.message);dom.uploadInput.value='';return;}
  const name=prompt('节点名称',f.name.replace(/\.json$/,''));
  if(!name){dom.uploadInput.value='';return;}
  try{
    const r=await api.postJson('/api/ai/node-defs',{name,json});
    await loadDefs();toast('节点定义已创建: '+r.name,'success');
  }catch(e){
    let msg=(e&&e.message)||String(e);
    let hint='';
    if(/404|Failed to fetch|NetworkError|ERR/i.test(msg)&&!/节点|格式|输出|class_type/.test(msg)){
      hint='\n\n↑ 这通常意味着服务端没有运行最新的 AI 工作台代码。\n请按以下步骤修复：\n  1. 在跑 server.js 的窗口按 Ctrl+C 停止\n  2. 执行：npm install\n  3. 执行：npm start\n  4. 浏览器硬刷新页面（Ctrl+Shift+R）';
    }
    console.error('[上传节点失败]',e);
    alert('上传失败：\n\n'+msg+hint);
  }
  dom.uploadInput.value='';
});
async function loadDefs(){
  const {defs}=await api.getJson('/api/ai/node-defs');
  state.defList=defs;
  state.defs={};
  await Promise.all(defs.map(async d=>{const full=await api.getJson(`/api/ai/node-defs/${d.id}`);state.defs[d.id]=full;}));
  renderLibrary();
}

// ---------- Canvas drop zone (consolidated: OS files, node library, resource library) ----------
let dragDepth=0;
function isFileDrag(e){return e.dataTransfer&&[...e.dataTransfer.types||[]].includes('Files');}
function isInternalDrag(e){return e.dataTransfer&&[...e.dataTransfer.types||[]].includes('text/plain');}
dom.center.addEventListener('dragenter',e=>{e.preventDefault();if(isFileDrag(e)||isInternalDrag(e)){dragDepth++;dom.dz.classList.add('show')}});
dom.center.addEventListener('dragover',e=>{e.preventDefault();if(isFileDrag(e))e.dataTransfer.dropEffect='copy';if(isInternalDrag(e))e.dataTransfer.dropEffect='copy'});
dom.center.addEventListener('dragleave',e=>{dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)dom.dz.classList.remove('show')});
dom.center.addEventListener('drop',e=>{
  e.preventDefault();dragDepth=0;dom.dz.classList.remove('show');
  const wf=activeWf();if(!wf){toast('请先打开或新建工作流','error');return;}
  // OS files: .json → upload as node-def; images/videos → create media input node
  const files=e.dataTransfer.files;
  if(files&&files.length){
    const p=screenToContent(e.clientX,e.clientY);
    [...files].forEach((f,i)=>{
      if(f.type==='application/json'||/\.json$/i.test(f.name)){
        // upload workflow JSON as custom node definition
        uploadNodeDefFromFile(f);
      }else if(f.type.startsWith('image/')||f.type.startsWith('video/')){
        const kind=f.type.startsWith('image/')?'image-input':'video-input';
        const id=kind==='image-input'?'imag'+(++nodeSeq):'vide'+(++nodeSeq);
        const n={id,type:kind,x:p.x-110+i*28,y:p.y-40+i*28,data:{fileRef:null,_droppedUrl:URL.createObjectURL(f)}};
        wf.nodes.push(n);
      }
    });
    if(wf.dirty){renderCanvas();renderTabs();}
    return;
  }
  // internal drag: node library or resource library
  try{
    const d=JSON.parse(e.dataTransfer.getData('text/plain'));
    if(!d)return;
    if(d.add){// node library: add generic/custom node at drop
      const p=screenToContent(e.clientX,e.clientY);
      if(d.add==='custom'){const n={id:'c'+(++nodeSeq),type:'custom',x:p.x-130,y:p.y-60,data:{defId:d.defId}};wf.nodes.push(n);}
      else{const g=GENERIC.find(x=>x.type===d.add);if(g){const id=g.type.replace(/-/,'').slice(0,4)+(++nodeSeq);wf.nodes.push({id,type:g.type,x:p.x-110,y:p.y-60,data:{}});}}
      wf.dirty=true;renderCanvas();renderTabs();
    }else if(d.kind&&d.path){// resource library: create media input node
      const p=screenToContent(e.clientX,e.clientY);
      const type=d.kind==='image'?'image-input':'video-input';
      const id=type.slice(0,4)+(++nodeSeq);
      wf.nodes.push({id,type,x:p.x-110,y:p.y-40,data:{fileRef:{rootId:'main',path:d.path}}});
      wf.dirty=true;renderCanvas();renderTabs();
    }
  }catch(_){}
});

async function uploadNodeDefFromFile(f){
  let json;
  try{json=JSON.parse(await f.text());}catch(e){alert('JSON 解析失败：'+e.message);return;}
  const name=prompt('节点名称',f.name.replace(/\.json$/,''));
  if(!name)return;
  try{
    const r=await api.postJson('/api/ai/node-defs',{name,json});
    await loadDefs();toast('节点定义已创建: '+r.name,'success');
  }catch(e){alert('上传失败：\n\n'+e.message);}
}
function vSplit(sp,target,side){
  sp.addEventListener('mousedown',e=>{
    e.preventDefault();const sx=e.clientX,sw=target.getBoundingClientRect().width;
    sp.classList.add('dragging');document.body.style.userSelect='none';document.body.style.cursor='col-resize';
    const move=ev=>{const w=Math.max(160,Math.min(520,side==='left'?sw+(ev.clientX-sx):sw-(ev.clientX-sx)));target.style.width=w+'px';target.style.minWidth=w+'px';renderConnections();};
    const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);sp.classList.remove('dragging');document.body.style.userSelect='';document.body.style.cursor='';renderConnections();};
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  });
}
function hSplit(sp,target){
  sp.addEventListener('mousedown',e=>{
    if(target.classList.contains('collapsed'))return;e.preventDefault();
    const sy=e.clientY,sh=target.getBoundingClientRect().height;
    sp.classList.add('dragging');target.classList.add('dragging');document.body.style.userSelect='none';document.body.style.cursor='row-resize';
    const move=ev=>{target.style.height=Math.max(80,Math.min(520,sh-(ev.clientY-sy)))+'px';};
    const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);sp.classList.remove('dragging');target.classList.remove('dragging');document.body.style.userSelect='';document.body.style.cursor='';};
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  });
}
if($('#splitLeft'))vSplit($('#splitLeft'),$('.pane-left'),'left');
if($('#splitRight'))vSplit($('#splitRight'),$('.pane-right'),'right');
if($('#splitDock'))hSplit($('#splitDock'),dom.taskDock);
if(dom.dockH)dom.dockH.addEventListener('click',()=>dom.taskDock.classList.toggle('collapsed'));

// overlay click closes overlays
dom.overlay.addEventListener('click',()=>{closePicker();dom.drawer.classList.remove('show');dom.overlay.classList.remove('show');});

// delete key
document.addEventListener('keydown',e=>{
  if(e.key==='Delete'||e.key==='Backspace'){
    if(e.target.matches('input,textarea'))return;
    if(state.selEdge){deleteEdge(state.selEdge);state.selEdge=null;}
    else if(state.selNode){deleteNode(state.selNode);state.selNode=null;}
  }
});

// ---------- Buttons ----------
dom.btnRun.addEventListener('click',execute);
// term/pause only in task dock — not topbar buttons
if(dom.btnTerm)dom.btnTerm.remove();
if(dom.btnPause)dom.btnPause.remove();
async function taskControl(taskId,action){
  const labels={terminate:'终止请求已发送',cancel:'任务已取消',pause:'暂停请求已发送',resume:'任务已恢复'};
  try{await api.postJson(`/api/ai/tasks/${taskId}/${action}`);toast(labels[action]||'操作成功','success');}
  catch(e){toast(e.message,'error');}
  renderTaskDock();renderCanvas();
}
dom.btnSave.addEventListener('click',saveWf);
dom.btnSaveAs.addEventListener('click',saveAs);
dom.btnRename.addEventListener('click',rename);
dom.btnClear.addEventListener('click',()=>{state.selNode=null;state.selEdge=null;renderCanvas();renderProperties();});
$('#btnOpenWf').addEventListener('click',openSelectedWorkflow);
// no auto-open on select change — user picks workflow then clicks Open or Delete
// delete button next to workflow selector
const delWfBtn=document.createElement('button');
delWfBtn.className='btn danger';delWfBtn.textContent='🗑';delWfBtn.title='删除选中工作流';delWfBtn.style.padding='6px 8px';
delWfBtn.addEventListener('click',deleteWorkflow);
$('#wfSelect').after(delWfBtn);

// ---------- AI settings ----------
const aiSettings={modal:$('#aiSettings'),url:$('#aiComfyUrl'),timeout:$('#aiExecTimeout'),workDir:$('#aiWorkDir'),status:$('#aiConnStatus'),
  open:$('#btnAiSettings'),close:$('#aiSettingsClose'),cancel:$('#aiSettingsCancel'),save:$('#aiSettingsSave'),test:$('#aiTestBtn')};
async function loadAiConfig(){
  try{const c=await api.getJson('/api/ai/config');aiSettings.url.value=c.comfyuiUrl||'http://127.0.0.1:8188';aiSettings.timeout.value=Math.round((c.execTimeoutMs||600000)/1000);aiSettings.workDir.value=c.workDir||'.aiworkbench';}
  catch(e){/* non-admin or error — leave defaults */}
}
aiSettings.open.addEventListener('click',()=>{loadAiConfig();aiSettings.modal.classList.add('show');dom.overlay.classList.add('show');aiSettings.status.textContent='未测试';aiSettings.status.style.color='var(--muted)';});
function closeAiSettings(){aiSettings.modal.classList.remove('show');dom.overlay.classList.remove('show');}
aiSettings.close.addEventListener('click',closeAiSettings);
aiSettings.cancel.addEventListener('click',closeAiSettings);
aiSettings.test.addEventListener('click',async()=>{
  aiSettings.status.textContent='测试中...';aiSettings.status.style.color='var(--muted)';
  try{
    const r=await api.postJson('/api/ai/config/test',{comfyuiUrl:aiSettings.url.value});
    if(r.ok){aiSettings.status.textContent=`✓ 已连接 · ${r.version||''} · ${r.latencyMs}ms`;aiSettings.status.style.color='var(--success)';}
    else{aiSettings.status.textContent='✗ 连接失败：'+(r.error||'');aiSettings.status.style.color='var(--danger)';}
  }catch(e){aiSettings.status.textContent='✗ '+e.message;aiSettings.status.style.color='var(--danger)';}
});
aiSettings.save.addEventListener('click',async()=>{
  try{
    await api.postJson('/api/ai/config',{comfyuiUrl:aiSettings.url.value,execTimeoutMs:parseInt(aiSettings.timeout.value,10)*1000,workDir:aiSettings.workDir.value||'.aiworkbench'});
    toast('设置已保存','success');closeAiSettings();refreshComfyStatus();
  }catch(e){toast(e.message,'error');}
});
async function refreshComfyStatus(){
  try{const r=await api.postJson('/api/ai/config/test',{});const el=$('#qComfy');if(el){el.textContent=r.ok?'● 已连接':'● 未连接';el.style.color=r.ok?'var(--success)':'var(--danger)';}}catch(_){}
}

// ---------- Toast ----------
function toast(msg,type='info'){
  let c=$('#toastC');if(!c){c=document.createElement('div');c.id='toastC';c.className='toast-container';c.style.cssText='position:fixed;top:20px;right:20px;z-index:3000;display:flex;flex-direction:column;gap:8px';document.body.appendChild(c);}
  const t=document.createElement('div');t.className='toast '+(type==='success'?'success':type==='error'?'error':'');t.style.cssText='background:var(--bg-tertiary);border:1px solid var(--border);border-left:3px solid '+(type==='success'?'var(--success)':type==='error'?'var(--danger)':'var(--accent)')+';border-radius:8px;padding:10px 14px;font-size:12px;min-width:200px;max-width:360px';
  t.textContent=msg;c.appendChild(t);setTimeout(()=>t.remove(),3500);
}

// ---------- Init ----------
async function init(){
  await fetchCsrf();
  try{const s=await api.getJson('/api/auth/session');state.user=s;}catch(_){window.location.href='/login.html';return;}
  await loadDefs();
  // start with one empty workflow
  state.tabs.push(newWorkflow());state.activeIdx=0;
  renderLibrary();renderTabs();renderCanvas();renderProperties();
  renderTaskDock();loadWorkflowList();browseResources('');
  refreshComfyStatus();
  // refresh dock periodically
  setInterval(renderTaskDock,3000);
}
init();
})();
