function openWpEditForIdx(i){
  _wpEditTarget=i;
  const wp=waypoints[i];
  document.getElementById('wp-edit-title').value=wp.title||'';
  document.getElementById('wp-edit-note').value=wp.note||'';
  document.getElementById('wp-edit-form').classList.add('visible');
  document.getElementById('wp-modal').classList.add('visible');
  renderWpModalList();
}

document.getElementById('wp-edit-save').addEventListener('click',()=>{
  if(_wpEditTarget!==null){
    waypoints[_wpEditTarget].title=document.getElementById('wp-edit-title').value.trim()||('Step '+(_wpEditTarget+1));
    waypoints[_wpEditTarget].note=document.getElementById('wp-edit-note').value;
    _wpEditTarget=null;
  }
  document.getElementById('wp-edit-form').classList.remove('visible');
  renderWpModalList();renderWaypointPins();
});
document.getElementById('wp-edit-cancel').addEventListener('click',()=>{
  _wpEditTarget=null;document.getElementById('wp-edit-form').classList.remove('visible');
});

function renderWpModalList(){
  const list=document.getElementById('wp-list');
  list.innerHTML='';
  if(!waypoints.length){list.innerHTML='<div style="padding:14px;font-family:var(--font-mono);font-size:10px;color:var(--text3)">No waypoints yet. Click "+ Add Waypoint at Current View" or use the Pin tool on the toolbar and click on the canvas.</div>';return;}
  waypoints.forEach((wp,i)=>{
    const row=document.createElement('div');
    row.className='wp-row';
    row.innerHTML=`<div class="wp-num">${i+1}</div><div class="wp-info"><div class="wp-name">${esc(wp.title||'Step '+(i+1))}</div><div class="wp-note-prev">${esc(wp.note||'—')}</div></div><button class="wp-del" data-i="${i}" title="Delete">x</button>`;
    row.addEventListener('dblclick',()=>openWpEditForIdx(i));
    row.addEventListener('click',e=>{if(e.target.classList.contains('wp-del'))return;
      animateCameraTo(wp.camX,wp.camY,wp.camZoom,600);
    });
    row.querySelector('.wp-del').addEventListener('click',e=>{e.stopPropagation();waypoints.splice(i,1);renderWpModalList();renderWaypointPins();});
    list.appendChild(row);
  });
}

document.getElementById('wp-record-btn').addEventListener('click',()=>{
  // Anchor pin to center of current view in world space
  const _vcx=(canvas.width/2-cam.x)/cam.zoom;
  const _vcy=(canvas.height/2-cam.y)/cam.zoom;
  const wp={id:mkWpid(),title:'Step '+(waypoints.length+1),note:'',
    worldX:_vcx,worldY:_vcy,
    camX:cam.x,camY:cam.y,camZoom:cam.zoom,spotlightNodeIds:[]};
  waypoints.push(wp);
  renderWpModalList();renderWaypointPins();
  toast('Waypoint captured at current view','success');
});

document.getElementById('wp-close').addEventListener('click',()=>{
  document.getElementById('wp-modal').classList.remove('visible');
  document.getElementById('wp-edit-form').classList.remove('visible');
  _wpEditTarget=null;
});

document.getElementById('wpManagerBtn').addEventListener('click',()=>{
  renderWpModalList();
  document.getElementById('wp-modal').classList.add('visible');
});

document.getElementById('presentBtn').addEventListener('click',togglePresent);

// =====================================================
// PRESENTATION MODE
// =====================================================
// (presentMode, presentWpIdx, _presentSpotlight, _camAnimRAF declared in STATE section above)

function animateCameraTo(tx,ty,tz,dur=700,onDone){
  if(_camAnimRAF)cancelAnimationFrame(_camAnimRAF);
  const sx=cam.x,sy=cam.y,sz=cam.zoom;
  const start=performance.now();
  function step(now){
    const t=Math.min(1,(now-start)/dur);
    const ease=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2; // easeInOutQuad
    cam.x=sx+(tx-sx)*ease;
    cam.y=sy+(ty-sy)*ease;
    cam.zoom=sz+(tz-sz)*ease;
    gridCache=null;mark();markMM();
    if(t<1)_camAnimRAF=requestAnimationFrame(step);
    else{_camAnimRAF=null;if(onDone)onDone();}
  }
  _camAnimRAF=requestAnimationFrame(step);
}

function togglePresent(){
  if(!waypoints.length){toast('Add waypoints first (Waypoints button)','error');return;}
  if(presentMode)exitPresent();
  else startPresent();
}

function startPresent(){
  if(!waypoints.length)return;
  presentMode=true;presentWpIdx=0;
  _presentSpotlight=false;
  document.getElementById('present-bar').classList.add('visible');
  document.getElementById('toolbar').style.opacity='0.3';
  document.getElementById('toolbar').style.pointerEvents='none';
  document.getElementById('side-panel').style.opacity='0';
  document.getElementById('side-panel').style.pointerEvents='none';
  document.getElementById('minimap').style.opacity='0.4';
  // Remove waypoint pins
  document.querySelectorAll('.wp-pin').forEach(p=>p.remove());
  updatePresentUI();
  animateCameraTo(waypoints[0].camX,waypoints[0].camY,waypoints[0].camZoom,700);
}

function exitPresent(){
  presentMode=false;
  if(_camAnimRAF)cancelAnimationFrame(_camAnimRAF);
  document.getElementById('present-bar').classList.remove('visible');
  document.getElementById('present-note').classList.remove('visible');
  document.getElementById('toolbar').style.opacity='';
  document.getElementById('toolbar').style.pointerEvents='';
  document.getElementById('side-panel').style.opacity='';
  document.getElementById('side-panel').style.pointerEvents='';
  document.getElementById('minimap').style.opacity='';
  drawSpotlight(null);
  renderWaypointPins();
  mark();
}

function updatePresentUI(){
  const wp=waypoints[presentWpIdx];
  if(!wp)return;
  document.getElementById('pb-counter').textContent=`${presentWpIdx+1} / ${waypoints.length}`;
  document.getElementById('pb-title').textContent=wp.title||'';
  // Note card
  const noteEl=document.getElementById('present-note');
  const noteText=wp.note||'';
  if(noteText){
    document.getElementById('pn-title').textContent=wp.title||'';
    document.getElementById('pn-text').textContent=noteText;
    noteEl.classList.add('visible');
  }else{noteEl.classList.remove('visible');}
  // Spotlight
  if(_presentSpotlight)drawSpotlight(wp);
  mark();
}

function presentNext(){
  if(presentWpIdx<waypoints.length-1){
    presentWpIdx++;
    updatePresentUI();
    const wp=waypoints[presentWpIdx];
    animateCameraTo(wp.camX,wp.camY,wp.camZoom,700);
  }
}
function presentPrev(){
  if(presentWpIdx>0){
    presentWpIdx--;
    updatePresentUI();
    const wp=waypoints[presentWpIdx];
    animateCameraTo(wp.camX,wp.camY,wp.camZoom,700);
  }
}

document.getElementById('pb-next').addEventListener('click',presentNext);
document.getElementById('pb-prev').addEventListener('click',presentPrev);
document.getElementById('pb-exit').addEventListener('click',exitPresent);
document.getElementById('pb-spotlight').addEventListener('click',()=>{
  _presentSpotlight=!_presentSpotlight;
  document.getElementById('pb-spotlight').style.borderColor=_presentSpotlight?'var(--accent)':'';
  if(_presentSpotlight)drawSpotlight(waypoints[presentWpIdx]);
  else drawSpotlight(null);
});

function drawSpotlight(wp){
  const sl=document.getElementById('spotlight-overlay');
  if(!wp){
    sl.style.display='none';sl.width=0;sl.height=0;return;
  }
  sl.style.display='block';sl.style.position='fixed';sl.style.inset='0';sl.style.zIndex='55';sl.style.pointerEvents='none';
  sl.width=window.innerWidth;sl.height=window.innerHeight;
  const g=sl.getContext('2d');
  g.clearRect(0,0,sl.width,sl.height);
  // Derive the world-space center of this waypoint's content, then project to screen
  const worldPos=worldPosOfWaypoint(wp);
  const scr=cam.w2s(worldPos.x,worldPos.y);
  // Offset by canvas position relative to viewport
  const cr=canvas.getBoundingClientRect();
  const cx=scr.x+cr.left, cy=scr.y+cr.top;
  const r=Math.min(sl.width,sl.height)*0.32;
  const grad=g.createRadialGradient(cx,cy,r*0.25,cx,cy,r*1.2);
  grad.addColorStop(0,'rgba(0,0,0,0)');
  grad.addColorStop(0.55,'rgba(0,0,0,0.25)');
  grad.addColorStop(1,'rgba(0,0,0,0.82)');
  g.fillStyle=grad;
  g.fillRect(0,0,sl.width,sl.height);
}

// =====================================================
// TOOLBAR WIRING — Frame + present buttons
// =====================================================
document.getElementById('addFrameBtn').addEventListener('click',()=>{
  setMode(mode==='frame'?'select':'frame');
});

// Add "Group into frame" to context menu
const ctxMenu=document.getElementById('ctx-menu');
const ctxGroupItem=document.createElement('div');
ctxGroupItem.className='ctx-item';ctxGroupItem.dataset.action='group-frame';
ctxGroupItem.innerHTML='<span>Group into Frame</span>';
// Insert before delete
const ctxDel=ctxMenu.querySelector('[data-action="delete"]');
if(ctxDel){const sep=document.createElement('div');sep.className='ctx-sep';ctxMenu.insertBefore(sep,ctxDel);ctxMenu.insertBefore(ctxGroupItem,sep);}

// Extend context menu handler
document.getElementById('ctx-menu').addEventListener('click',e=>{
  const item=e.target.closest('.ctx-item');if(!item)return;
  if(item.dataset.action==='group-frame')groupSelectionIntoFrame();
});

// Also handle Delete key for frames
const _origKbdDel=()=>{
  if(sel.frameId){deleteSelectedFrame();return;}
};
// Patch keyboard handler — frame delete
document.addEventListener('keydown',e=>{
  if(isInputFocused())return;
  if((e.key==='Delete'||e.key==='Backspace')&&sel.frameId&&!sel.nodes.size){deleteSelectedFrame();}
},true);