// =====================================================
// KEYBOARD SHORTCUTS
// =====================================================
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(mode==='line'||mode==='frame'||mode==='waypoint')setMode('select');if(presentMode)exitPresent();document.getElementById('kbd-help').classList.remove('visible');document.getElementById('text-editor-overlay').classList.remove('visible');pendingTextAdd=false;return}
  if((e.key==='?'||e.key==='/')&&!isInputFocused()){document.getElementById('kbd-help').classList.toggle('visible');return}
  if(isInputFocused())return;
  if(e.ctrlKey||e.metaKey){
    if(e.key==='z'){e.preventDefault();hist.undo();mark();markMM()}
    else if(e.key==='y'){e.preventDefault();hist.redo();mark();markMM()}
    else if(e.key==='s'){e.preventDefault();document.getElementById('saveBtn').click()}
    else if(e.key==='d'){e.preventDefault();duplicateSelected()}
    else if(e.key==='a'){e.preventDefault();curLayer().nodes.forEach(n=>sel.nodes.add(n.id));mark();showProps()}
    else if(e.key==='0'){e.preventDefault();cam.reset();gridCache=null;mark();markMM()}
    else if(e.key==='f'||e.key==='F'){e.preventDefault();if(e.shiftKey)fitSelectedNodes();else fitAllNodes()}
    else if(e.key==='+'||e.key==='='){e.preventDefault();cam.zoomAt(1.2,canvas.width/2,canvas.height/2);gridCache=null;mark();markMM()}
    else if(e.key==='-'){e.preventDefault();cam.zoomAt(1/1.2,canvas.width/2,canvas.height/2);gridCache=null;mark();markMM()}
    return;
  }
  if(e.key==='Delete'||e.key==='Backspace'){deleteSelected();return}
  if(e.key==='v'||e.key==='V'){setMode('select');return}
  if(e.key==='l'||e.key==='L'){setMode('line');return}
  if(e.key==='t'||e.key==='T'){document.getElementById('addTextBtn').click();return}
  if(e.key==='f'||e.key==='F'){setMode(mode==='frame'?'select':'frame');return}
  if(e.key==='w'||e.key==='W'){setMode(mode==='waypoint'?'select':'waypoint');return}
  if(e.key==='g'||e.key==='G'){snapGrid=!snapGrid;document.getElementById('st-snap').textContent=snapGrid?'ON':'OFF';toast('Snap '+(snapGrid?'ON':'OFF'));return}
  if(e.key==='F2'){const n=curLayer().nodes.find(n=>n.id===Array.from(sel.nodes)[0]);if(n&&n.type==='text')openTextEditor(n);return}
  if(e.key===']'){
    const layer=curLayer();
    Array.from(sel.nodes).forEach(id=>{
      const i=layer.nodes.findIndex(n=>n.id===id);
      if(i<layer.nodes.length-1){
        const li=curLayerIdx,ni=i;
        hist.run(new Cmd(
          ()=>{const a=layers[li].nodes;[a[ni],a[ni+1]]=[a[ni+1],a[ni]];mark()},
          ()=>{const a=layers[li].nodes;[a[ni],a[ni+1]]=[a[ni+1],a[ni]];mark()}
        ));
      }
    });
    mark();return;
  }
  if(e.key==='['){
    const layer=curLayer();
    Array.from(sel.nodes).forEach(id=>{
      const i=layer.nodes.findIndex(n=>n.id===id);
      if(i>0){
        const li=curLayerIdx,ni=i;
        hist.run(new Cmd(
          ()=>{const a=layers[li].nodes;[a[ni-1],a[ni]]=[a[ni],a[ni-1]];mark()},
          ()=>{const a=layers[li].nodes;[a[ni-1],a[ni]]=[a[ni],a[ni-1]];mark()}
        ));
      }
    });
    mark();return;
  }
});
document.getElementById('fitBtn').addEventListener('click',()=>fitAllNodes());
// Waypoint pin mode button
document.getElementById('addWaypointBtn').addEventListener('click',()=>{
  setMode(mode==='waypoint'?'select':'waypoint');
  document.getElementById('addWaypointBtn').classList.toggle('active',mode==='waypoint');
});

// Toolbar dropdown toggles — click to open, click outside to close
['addGroupBtn','styleGroupBtn','zoomGroupBtn','fileGroupBtn'].forEach(btnId=>{
  const btn=document.getElementById(btnId);
  const menuId=btnId.replace('Btn','Menu');
  const menu=document.getElementById(menuId);
  if(!btn||!menu)return;
  btn.addEventListener('click',e=>{
    e.stopPropagation();
    const isOpen=menu.classList.contains('open');
    // Close all
    document.querySelectorAll('.tb-dropdown').forEach(m=>m.classList.remove('open'));
    document.querySelectorAll('.tb-overflow-btn').forEach(b=>b.classList.remove('active'));
    if(!isOpen){menu.classList.add('open');btn.classList.add('active');}
  });
});
document.addEventListener('click',()=>{
  document.querySelectorAll('.tb-dropdown').forEach(m=>m.classList.remove('open'));
  document.querySelectorAll('.tb-overflow-btn').forEach(b=>b.classList.remove('active'));
});
// Stop clicks inside dropdowns from closing them
document.querySelectorAll('.tb-dropdown').forEach(m=>m.addEventListener('click',e=>e.stopPropagation()));
function fitSelectedNodes(){
  const ids=Array.from(sel.nodes);
  if(!ids.length){fitAllNodes();return;}
  const nodes=ids.map(id=>getNode(id)).filter(Boolean);
  if(!nodes.length)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n=>{minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+n.h)});
  const pad=80,bw=maxX-minX+pad*2,bh=maxY-minY+pad*2;
  const zx=canvas.width/bw,zy=canvas.height/bh;
  cam.zoom=Math.max(0.05,Math.min(4,Math.min(zx,zy)));
  cam.x=canvas.width/2-(minX-pad+bw/2)*cam.zoom;
  cam.y=canvas.height/2-(minY-pad+bh/2)*cam.zoom;
  gridCache=null;mark();markMM();toast('Fit selection');
}
document.getElementById('fitSelBtn').addEventListener('click',fitSelectedNodes);
document.getElementById('zoomResetBtn').addEventListener('click',()=>{cam.reset();gridCache=null;mark();markMM()});
document.getElementById('zoomInBtn').addEventListener('click',()=>{cam.zoomAt(1.25,canvas.width/2,canvas.height/2);gridCache=null;mark();markMM()});
document.getElementById('zoomOutBtn').addEventListener('click',()=>{cam.zoomAt(1/1.25,canvas.width/2,canvas.height/2);gridCache=null;mark();markMM()});
document.getElementById('helpBtn').addEventListener('click',()=>document.getElementById('kbd-help').classList.toggle('visible'));
document.addEventListener('keydown',e=>{
  if(isInputFocused())return;
  if(e.shiftKey&&(e.key==='P'||e.key==='p')){e.preventDefault();togglePresent();return;}
  if(presentMode){
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();presentNext();return;}
    if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();presentPrev();return;}
  }
});
document.getElementById('kbd-close').addEventListener('click',()=>document.getElementById('kbd-help').classList.remove('visible'));

// =====================================================
// TOAST
// =====================================================
function toast(msg,type){
  const c=document.getElementById('toast-container');
  const el=document.createElement('div');
  el.className='toast'+(type?' '+type:'');
  el.textContent=msg;
  c.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),350)},2400);
}

// =====================================================
// INLINE RENAME MODAL (replaces all prompt() calls)
// =====================================================
function showRenameModal(title, defaultVal, onOk){
  const modal=document.getElementById('rename-modal');
  const inp=document.getElementById('rename-modal-input');
  const okBtn=document.getElementById('rename-modal-ok');
  const cancelBtn=document.getElementById('rename-modal-cancel');
  document.getElementById('rename-modal-title').textContent=title;
  inp.value=defaultVal||'';
  modal.classList.add('visible');
  setTimeout(()=>{inp.focus();inp.select();},60);
  function cleanup(){modal.classList.remove('visible');okBtn.onclick=null;cancelBtn.onclick=null;inp.onkeydown=null;}
  okBtn.onclick=()=>{const v=inp.value.trim();cleanup();if(v)onOk(v);};
  cancelBtn.onclick=()=>cleanup();
  inp.onkeydown=e=>{if(e.key==='Enter'){okBtn.onclick();}else if(e.key==='Escape'){cancelBtn.onclick();}};
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// =====================================================
// RESIZE
// =====================================================
function resizeCanvas(){
  _canvasOffDirty=true;
  const ws=document.getElementById('workspace');
  const panelW=document.getElementById('side-panel').classList.contains('collapsed')?0:(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--panel-w'))||210);
  const oldW=canvas.width||1;
  const newW=Math.max(100,ws.clientWidth-panelW);
  const newH=Math.max(100,ws.clientHeight);
  // Adjust camera.x so the world-center of the viewport stays the same
  // worldCenter.x = (canvas.width/2 - cam.x) / cam.zoom
  // After resize: cam.x_new = newW/2 - worldCenter.x * cam.zoom
  if(oldW!==newW&&canvas.width>0){
    const worldCenterX=(canvas.width/2-cam.x)/cam.zoom;
    const worldCenterY=(canvas.height/2-cam.y)/cam.zoom;
    cam.x=newW/2-worldCenterX*cam.zoom;
    cam.y=newH/2-worldCenterY*cam.zoom;
  }
  canvas.width=newW;
  canvas.height=newH;
  const toggle=document.getElementById('panel-toggle');
  if(toggle)toggle.style.right=(panelOpen?panelW:0)+'px';
  gridCache=null;gridCacheKey='';mark();markMM();
}
window.addEventListener('resize',resizeCanvas);