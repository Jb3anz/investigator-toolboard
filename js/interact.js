// =====================================================
// MOUSE / INTERACTION
// =====================================================
let mDown=false,mBtn=0;
let mStartSX=0,mStartSY=0;
let mLastSX=0,mLastSY=0;
let mMoved=false;
let iMode=null;  // 'pan'|'drag'|'resize'|'rotate'|'frame-draw'|'frame-drag'|'frame-resize'
let resizeTarget=null,rotateTarget=null,frameDragTarget=null,frameResizeTarget=null;
let _wpDragTarget=null,_wpDragStartW=null;
let dragSnap={},frameDragSnap={};
const dragSel={on:false,x0:0,y0:0,x1:0,y1:0};
const frameDraw={on:false,x0:0,y0:0,x1:0,y1:0};
let spaceDown=false;

// Cursor tracking
const cursorDot=document.getElementById('cursor-dot');
document.addEventListener('mousemove',e=>{
  cursorDot.style.left=e.clientX+'px';
  cursorDot.style.top=e.clientY+'px';
});

canvas.addEventListener('mousedown',e=>{
  if(e.button===2)return;
  e.preventDefault();
  mDown=true;mBtn=e.button;mMoved=false;
  const _p=cx(e);mStartSX=mLastSX=_p.x;mStartSY=mLastSY=_p.y;
  const w=cam.s2w(_p.x,_p.y);

  if(e.button===1||(e.button===0&&spaceDown)){iMode='pan';canvas.style.cursor='grabbing';return}

  // Check waypoint pin hit FIRST (in select mode, not during other special modes)
  if(mode==='select'&&!presentMode){
    const pinHit=hitWaypointPin(_p.x,_p.y);
    if(pinHit){
      // Check if click landed on the delete badge
      if(pinHit.delBx!==undefined&&Math.hypot(_p.x-pinHit.delBx,_p.y-pinHit.delBy)<=pinHit.delBr){
        const idx=pinHit.idx;
        const wp=waypoints[idx];
        hist.run(new Cmd(
          ()=>{waypoints.splice(idx,1);renderWaypointPins();toast('Waypoint removed');mark()},
          ()=>{waypoints.splice(idx,0,wp);renderWaypointPins();mark()}
        ));
        mDown=false;return;
      }
      presentWpIdx=pinHit.idx;
      if(e.detail>=2){
        mDown=false;
        openWpEditForIdx(pinHit.idx);
        mark();return;
      }
      // Single click — start drag so user can reposition pin.
      // If mouse doesn't move before mouseup, we'll fly to the waypoint instead.
      iMode='wp-drag';
      _wpDragTarget=pinHit;
      _wpDragStartW={x:pinHit.wp.worldX??((canvas.width/2-pinHit.wp.camX)/pinHit.wp.camZoom),
                     y:pinHit.wp.worldY??((canvas.height/2-pinHit.wp.camY)/pinHit.wp.camZoom)};
      mark();return;
    }
  }

  if(mode==='line'){
    const hit=hitNode(w.x,w.y);
    if(hit){
      if(!lineStart){lineStart=hit.id;toast('Click the destination node');mark()}
      else if(hit.id!==lineStart){
        const newEdge={id:mkEid(),startId:lineStart,endId:hit.id,color:ui.edgeColor,style:ui.lineStyle,arrowStyle:ui.arrowStyle,arrowSize:12,label:'',curve:0};
        const li=curLayerIdx;
        hist.run(new Cmd(
          ()=>{layers[li].edges.push(newEdge);indexEdge(newEdge);mark();markMM()},
          ()=>{layers[li].edges=layers[li].edges.filter(e=>e.id!==newEdge.id);unindexEdge(newEdge.id);mark();markMM()}
        ));
        lineStart=null;setMode('select');toast('Edge connected','success');
      }
    }
    return;
  }

  if(mode==='select'){
    for(const id of sel.nodes){
      const n=getNode(id);if(!n)continue;
      const h=getHandle(n,w.x,w.y);
      if(h==='resize'){iMode='resize';resizeTarget=n;canvas.style.cursor='nwse-resize';
        n._resizeBaseW=n.w;n._resizeBaseFont=n.fontSize||13;
        n._undoBefore={x:n.x,y:n.y,w:n.w,h:n.h,fontSize:n.fontSize||13};
        return}
      if(h==='rotate'){iMode='rotate';rotateTarget=n;canvas.style.cursor='grab';
        n._undoBefore={rot:n.rot};
        return}
    }
    const hitN=hitNode(w.x,w.y);
    if(hitN){
      if(!e.shiftKey&&!sel.nodes.has(hitN.id)){sel.nodes.clear();sel.edgeId=null}
      sel.nodes.add(hitN.id);sel.edgeId=null;
      iMode='drag';dragSnap={};
      sel.nodes.forEach(id=>{const n=getNode(id);if(n)dragSnap[id]={ox:n.x,oy:n.y}});
      mark();showProps();updateMediaBar();return;
    }
    const hitE=hitEdge(w.x,w.y);
    if(hitE){sel.nodes.clear();sel.edgeId=hitE.id;sel.frameId=null;mark();showProps();return}
    // Frame hit — check title bar / border
    const hitF=hitFrame(w.x,w.y);
    if(hitF){
      sel.nodes.clear();sel.edgeId=null;sel.frameId=hitF.id;
      // Check resize handle
      const hs=8/cam.zoom;
      if(w.x>=hitF.x+hitF.w-hs&&w.y>=hitF.y+hitF.h-hs){
        iMode='frame-resize';frameResizeTarget=hitF;
        // Snapshot before-state for undo
        hitF._undoBefore={x:hitF.x,y:hitF.y,w:hitF.w,h:hitF.h};
      }
      else{
        iMode='frame-drag';frameDragTarget=hitF;
        frameDragSnap={ox:hitF.x,oy:hitF.y};
        _frameDragLastDx=0;_frameDragLastDy=0;
        // Also snap all nodes inside; store node refs so mouseup can diff them
        // Move nodes whose CENTER is inside the frame (catches partial overlaps too)
        const inside=curLayer().nodes.filter(n=>{
          const ncx=n.x+n.w/2,ncy=n.y+n.h/2;
          return ncx>=hitF.x&&ncx<=hitF.x+hitF.w&&ncy>=hitF.y&&ncy<=hitF.y+hitF.h;
        });
        inside.forEach(n=>dragSnap[n.id]={ox:n.x,oy:n.y,node:n});
        // Snapshot before-state for undo
        hitF._undoBefore={x:hitF.x,y:hitF.y,w:hitF.w,h:hitF.h};
      }
      mark();showProps();return;
    }
    sel.nodes.clear();sel.edgeId=null;sel.frameId=null;
    dragSel.on=true;dragSel.x0=dragSel.x1=w.x;dragSel.y0=dragSel.y1=w.y;
    hideProps();updateMediaBar();mark();
  }
  if(mode==='frame'){
    frameDraw.on=true;frameDraw.x0=frameDraw.x1=w.x;frameDraw.y0=frameDraw.y1=w.y;
  }
  if(mode==='waypoint'){
    const wx=w.x,wy=w.y;
    const wp={id:mkWpid(),title:'Step '+(waypoints.length+1),note:'',
      worldX:wx,worldY:wy,
      camX:cam.x,camY:cam.y,camZoom:cam.zoom,spotlightNodeIds:[]};
    hist.run(new Cmd(
      ()=>{waypoints.push(wp);renderWaypointPins();toast('Waypoint pinned — double-click to edit','success');mark()},
      ()=>{waypoints.splice(waypoints.indexOf(wp),1);renderWaypointPins();mark()}
    ));
    mark();
  }
});

canvas.addEventListener('mousemove',e=>{
  const _mp=cx(e);
  const w=cam.s2w(_mp.x,_mp.y);
  document.getElementById('st-x').textContent=Math.round(w.x);
  document.getElementById('st-y').textContent=Math.round(w.y);
  // Hover cursor: change cursor over handles
  if(!mDown&&mode==='select'){
    let hov=null;
    for(const id of sel.nodes){const n=getNode(id);if(n)hov=hov||getHandle(n,w.x,w.y)}
    canvas.style.cursor=hov==='rotate'?'grab':hov==='resize'?'nwse-resize':'default';
  }
  if(mode==='line'&&lineStart){lineTempX=snap(w.x);lineTempY=snap(w.y);mark()}
  if(!mDown)return;
  mMoved=true;
  const dx=_mp.x-mLastSX,dy=_mp.y-mLastSY;
  mLastSX=_mp.x;mLastSY=_mp.y;
  const curW=cam.s2w(_mp.x,_mp.y);
  const startW=cam.s2w(mStartSX,mStartSY);
  if(iMode==='pan'){cam.pan(dx,dy);gridCache=null;gridCacheKey='';mark();markMM();return}
  if(iMode==='drag'){
    const tdx=curW.x-startW.x,tdy=curW.y-startW.y;
    sel.nodes.forEach(id=>{const n=getNode(id);if(n&&dragSnap[id]){n.x=snap(dragSnap[id].ox+tdx);n.y=snap(dragSnap[id].oy+tdy)}});
    mark();markMM();return;
  }
  if(iMode==='resize'&&resizeTarget){
    const n=resizeTarget,_cx=n.x+n.w/2,_cy=n.y+n.h/2;
    const r=-n.rot*Math.PI/180;
    const ddx=curW.x-_cx,ddy=curW.y-_cy;
    const lx=ddx*Math.cos(r)-ddy*Math.sin(r);
    const ly=ddx*Math.sin(r)+ddy*Math.cos(r);
    const oldW=n.w,oldH=n.h;
    n.w=Math.max(30,Math.abs(lx)*2);n.h=Math.max(20,Math.abs(ly)*2);
    n.x=_cx-n.w/2;n.y=_cy-n.h/2;
    // Scale font size proportionally for text nodes
    if(n.type==='text'&&oldW>0&&n._resizeBaseFont){
      const scale=n.w/n._resizeBaseW;
      n.fontSize=Math.max(8,Math.round(n._resizeBaseFont*scale));
    }
    mark();return;
  }
  if(iMode==='rotate'&&rotateTarget){
    canvas.style.cursor='grabbing';
    const n=rotateTarget,rcx=n.x+n.w/2,rcy=n.y+n.h/2;
    n.rot=Math.atan2(curW.y-rcy,curW.x-rcx)*180/Math.PI+90;mark();return;
  }
  if(dragSel.on){
    dragSel.x1=curW.x;dragSel.y1=curW.y;
    const mnX=Math.min(dragSel.x0,dragSel.x1),mxX=Math.max(dragSel.x0,dragSel.x1);
    const mnY=Math.min(dragSel.y0,dragSel.y1),mxY=Math.max(dragSel.y0,dragSel.y1);
    sel.nodes.clear();
    rebuildQT();const qIds=_qt.queryRect(mnX,mnY,mxX-mnX,mxY-mnY);
    curLayer().nodes.forEach(n=>{if(qIds.has(n.id)&&n.x<mxX&&n.x+n.w>mnX&&n.y<mxY&&n.y+n.h>mnY)sel.nodes.add(n.id)});
    mark();
  }
  if(iMode==='wp-drag'&&_wpDragTarget){
    const wp=_wpDragTarget.wp;
    wp.worldX=curW.x;wp.worldY=curW.y;
    // Re-bake camera state using the CURRENT zoom so that clicking "fly to this
    // waypoint" later lands at the right zoom level, not the zoom at creation time.
    wp.camZoom=cam.zoom;
    wp.camX=canvas.width/2-wp.worldX*cam.zoom;
    wp.camY=canvas.height/2-wp.worldY*cam.zoom;
    mark();return;
  }
  if(iMode==='frame-drag'&&frameDragTarget){
    const tdx=curW.x-startW.x,tdy=curW.y-startW.y;
    frameDragTarget.x=frameDragSnap.ox+tdx;frameDragTarget.y=frameDragSnap.oy+tdy;
    const layer=curLayer();
    const ddx=tdx-_frameDragLastDx,ddy=tdy-_frameDragLastDy;
    const movedIds=[];
    layer.nodes.forEach(n=>{if(dragSnap[n.id]){n.x=dragSnap[n.id].ox+tdx;n.y=dragSnap[n.id].oy+tdy;movedIds.push(n.id)}});
    if(ddx||ddy)shiftWaypointsForNodes(movedIds,ddx,ddy);
    _frameDragLastDx=tdx;_frameDragLastDy=tdy;
    mark();markMM();return;
  }
  if(iMode==='frame-resize'&&frameResizeTarget){
    const f=frameResizeTarget;
    f.w=Math.max(80,curW.x-f.x);f.h=Math.max(60,curW.y-f.y);
    mark();return;
  }
  if(frameDraw.on){
    frameDraw.x1=curW.x;frameDraw.y1=curW.y;mark();
  }
});

canvas.addEventListener('mouseup',e=>{
  if(!mDown)return;mDown=false;
  // Commit resize undo
  if(iMode==='resize'&&mMoved&&resizeTarget){
    const n=resizeTarget;
    const before=n._undoBefore||{};
    const after={x:n.x,y:n.y,w:n.w,h:n.h,fontSize:n.fontSize||13};
    if(after.w!==before.w||after.h!==before.h){
      const cmd=new Cmd(
        ()=>{n.x=after.x;n.y=after.y;n.w=after.w;n.h=after.h;n.fontSize=after.fontSize;mark()},
        ()=>{n.x=before.x;n.y=before.y;n.w=before.w;n.h=before.h;n.fontSize=before.fontSize;mark()}
      );
      hist.cmds.splice(hist.ptr+1);
      if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(cmd);
    }
    delete n._undoBefore;
  }
  // Commit rotate undo
  if(iMode==='rotate'&&mMoved&&rotateTarget){
    const n=rotateTarget;
    const before=n._undoBefore||{rot:0};
    const after={rot:n.rot};
    if(Math.abs(after.rot-before.rot)>0.01){
      const cmd=new Cmd(
        ()=>{n.rot=after.rot;mark()},
        ()=>{n.rot=before.rot;mark()}
      );
      hist.cmds.splice(hist.ptr+1);
      if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(cmd);
    }
    delete n._undoBefore;
  }
  if(frameDraw.on){
    frameDraw.on=false;
    const fx=Math.min(frameDraw.x0,frameDraw.x1),fy=Math.min(frameDraw.y0,frameDraw.y1);
    const fw=Math.abs(frameDraw.x1-frameDraw.x0),fh=Math.abs(frameDraw.y1-frameDraw.y0);
    if(fw>40&&fh>30){
      const frame={id:mkFid(),x:fx,y:fy,w:fw,h:fh,title:'Frame',color:'#5b8dee',collapsed:false};
      const li=curLayerIdx;
      if(!layers[li].frames)layers[li].frames=[];
      const frames=layers[li].frames;
      hist.run(new Cmd(()=>{frames.push(frame);sel.frameId=frame.id;mark()},()=>{const i=frames.findIndex(f=>f.id===frame.id);if(i>-1)frames.splice(i,1);sel.frameId=null;mark()}));
      setMode('select');showProps();
    }else{setMode('select');}
    mark();return;
  }
  if(iMode==='frame-drag'&&mMoved&&frameDragTarget){
    const f=frameDragTarget;
    const before=f._undoBefore||{x:frameDragSnap.ox,y:frameDragSnap.oy,w:f.w,h:f.h};
    const after={x:f.x,y:f.y,w:f.w,h:f.h};
    // Capture node displacements
    const nodeSnap={};
    Object.entries(dragSnap).forEach(([id,s])=>{
      if(s.node){nodeSnap[id]={ox:s.ox,oy:s.oy,nx:s.node.x,ny:s.node.y,node:s.node};}
    });
    const li=curLayerIdx;
    if(after.x!==before.x||after.y!==before.y){
      const cmd=new Cmd(
        ()=>{f.x=after.x;f.y=after.y;Object.values(nodeSnap).forEach(s=>{s.node.x=s.nx;s.node.y=s.ny;});mark();markMM();},
        ()=>{f.x=before.x;f.y=before.y;Object.values(nodeSnap).forEach(s=>{s.node.x=s.ox;s.node.y=s.oy;});mark();markMM();}
      );
      hist.cmds.splice(hist.ptr+1);
      if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(cmd);
    }
    delete f._undoBefore;
    frameDragTarget=null;dragSnap={};
  } else if(iMode==='frame-drag'){
    delete frameDragTarget?._undoBefore;
    frameDragTarget=null;dragSnap={};
  }
  if(iMode==='frame-resize'&&mMoved&&frameResizeTarget){
    const f=frameResizeTarget;
    const before=f._undoBefore||{x:f.x,y:f.y,w:f.w,h:f.h};
    const after={x:f.x,y:f.y,w:f.w,h:f.h};
    if(after.w!==before.w||after.h!==before.h){
      const cmd=new Cmd(
        ()=>{f.w=after.w;f.h=after.h;mark();},
        ()=>{f.w=before.w;f.h=before.h;mark();}
      );
      hist.cmds.splice(hist.ptr+1);
      if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(cmd);
    }
    delete f._undoBefore;
    frameResizeTarget=null;
  } else if(iMode==='frame-resize'){
    delete frameResizeTarget?._undoBefore;
    frameResizeTarget=null;
  }
  if(iMode==='drag'&&mMoved){
    const snapShot={};
    sel.nodes.forEach(id=>{const n=getNode(id);if(n)snapShot[id]={ox:dragSnap[id]&&dragSnap[id].ox,oy:dragSnap[id]&&dragSnap[id].oy,nx:n.x,ny:n.y}});
    const li=curLayerIdx;
    // Shift waypoints for dragged nodes by their total displacement.
    // All selected nodes share the same delta, so using first node's diff is fine.
    const movedIds=Object.keys(snapShot);
    if(movedIds.length>0){
      const firstSnap=snapShot[movedIds[0]];
      const ddx=firstSnap?firstSnap.nx-firstSnap.ox:0;
      const ddy=firstSnap?firstSnap.ny-firstSnap.oy:0;
      if(ddx||ddy)shiftWaypointsForNodes(movedIds,ddx,ddy);
    }
    const cmd=new Cmd(
      ()=>{Object.entries(snapShot).forEach(([id,s])=>{const n=getNode(id);if(n){n.x=s.nx;n.y=s.ny}});mark();markMM()},
      ()=>{Object.entries(snapShot).forEach(([id,s])=>{const n=getNode(id);if(n){n.x=s.ox;n.y=s.oy}});mark();markMM()}
    );
    // Push without re-executing
    hist.cmds.splice(hist.ptr+1);
    if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
    hist.cmds.push(cmd);
  }
  // wp-drag with no movement = click → fly to that waypoint
  if(iMode==='wp-drag'&&_wpDragTarget&&!mMoved){
    animateCameraTo(_wpDragTarget.wp.camX,_wpDragTarget.wp.camY,_wpDragTarget.wp.camZoom,600);
  }
  dragSel.on=false;iMode=null;resizeTarget=null;rotateTarget=null;frameDragTarget=null;frameResizeTarget=null;_wpDragTarget=null;_wpDragStartW=null;
  canvas.style.cursor=mode==='line'||mode==='frame'||mode==='waypoint'?'crosshair':'default';
  mark();
  if(sel.nodes.size>0){showProps();updateMediaBar()}
});

canvas.addEventListener('dblclick',e=>{
  const _dp=cx(e);const w=cam.s2w(_dp.x,_dp.y);
  const hit=hitNode(w.x,w.y);
  if(hit&&hit.type==='text'){openTextEditor(hit);return;}
  const hitE=hitEdge(w.x,w.y);
  if(hitE){openEdgeLabelEditor(hitE,_dp.x,_dp.y);return;}
  // Double-click on frame title bar → rename
  const hitF=hitFrame(w.x,w.y);
  if(hitF){
    showRenameModal('FRAME TITLE', hitF.title||'Frame', newName=>{
      const oldTitle=hitF.title;
      hist.run(new Cmd(()=>{hitF.title=newName;mark()},()=>{hitF.title=oldTitle;mark()}));
    });
  }
});

canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const _wp=cx(e);cam.zoomAt(e.deltaY<0?1.12:1/1.12,_wp.x,_wp.y);
  gridCache=null;gridCacheKey='';mark();markMM();
},{passive:false});

canvas.addEventListener('contextmenu',e=>{
  e.preventDefault();
  const _cp=cx(e);const w=cam.s2w(_cp.x,_cp.y);
  const hit=hitNode(w.x,w.y);
  if(!hit)return;
  if(!sel.nodes.has(hit.id)){sel.nodes.clear();sel.nodes.add(hit.id);mark()}
  const ctxEl=document.getElementById('ctx-menu');
  document.getElementById('ctx-edit-text').style.display=hit.type==='text'?'':'none';
  ctxEl.style.left=Math.min(e.clientX,window.innerWidth-180)+'px';
  ctxEl.style.top=Math.min(e.clientY,window.innerHeight-200)+'px';
  ctxEl.classList.add('visible');
  showProps();
});

document.addEventListener('click',()=>document.getElementById('ctx-menu').classList.remove('visible'));

document.getElementById('ctx-menu').addEventListener('click',e=>{
  const item=e.target.closest('.ctx-item');if(!item)return;
  const action=item.dataset.action;
  const layer=curLayer(),ids=Array.from(sel.nodes);
  if(action==='delete')deleteSelected();
  else if(action==='duplicate')duplicateSelected();
  if(action==='front'){
    ids.forEach(id=>{
      const i=layer.nodes.findIndex(n=>n.id===id);
      if(i>-1){
        const n=layer.nodes[i];const li=curLayerIdx;
        hist.run(new Cmd(
          ()=>{const a=layers[li].nodes,ci=a.findIndex(x=>x.id===id);if(ci>-1){a.splice(ci,1);a.push(n)}mark()},
          ()=>{const a=layers[li].nodes,ci=a.findIndex(x=>x.id===id);if(ci>-1){a.splice(ci,1);a.splice(i,0,n)}mark()}
        ));
      }
    });mark();
  }
  else if(action==='back'){
    ids.forEach(id=>{
      const i=layer.nodes.findIndex(n=>n.id===id);
      if(i>-1){
        const n=layer.nodes[i];const li=curLayerIdx;
        hist.run(new Cmd(
          ()=>{const a=layers[li].nodes,ci=a.findIndex(x=>x.id===id);if(ci>-1){a.splice(ci,1);a.unshift(n)}mark()},
          ()=>{const a=layers[li].nodes,ci=a.findIndex(x=>x.id===id);if(ci>-1){a.splice(ci,1);a.splice(i,0,n)}mark()}
        ));
      }
    });mark();
  }
  else if(action==='edit-text'){const n=layer.nodes.find(n=>n.id===ids[0]);if(n)openTextEditor(n)}
  else if(action==='edit-label'){const n=layer.nodes.find(n=>n.id===ids[0]);if(n)openLabelEditor(n)}
  else if(action==='save-template'){
    showRenameModal('SAVE AS TEMPLATE', 'My Board', name=>{
      const tpl={
        id:'user_'+Date.now(),builtin:false,
        name:name,desc:'Saved from board',created:Date.now(),
        data:serializeAsTemplate()
      };
      const existing=loadUserTemplates();existing.push(tpl);saveUserTemplates(existing);
      toast('Template saved: '+name,'success');
    });
  }
  else if(action==='add-waypoint'){
    const n=layer.nodes.find(n=>n.id===ids[0]);
    if(n){
      // Zoom to frame the node; store resulting camera state as waypoint
      const padding=80;
      const targetZoom=Math.min(4,Math.min(canvas.width/(n.w+padding*2),canvas.height/(n.h+padding*2)));
      const targetX=canvas.width/2-(n.x+n.w/2)*targetZoom;
      const targetY=canvas.height/2-(n.y+n.h/2)*targetZoom;
      const wp={id:mkWpid(),title:(n.label||(n.content||'').split('\n')[0]||('Step '+(waypoints.length+1))).slice(0,40),note:'',
        worldX:n.x+n.w/2,worldY:n.y+n.h/2,
        camX:targetX,camY:targetY,camZoom:targetZoom,spotlightNodeIds:[n.id]};
      waypoints.push(wp);
      renderWaypointPins();
      toast('Node added as waypoint','success');
    }
  }
});

document.addEventListener('keydown',e=>{if(e.code==='Space'&&!isInputFocused()){spaceDown=true;if(!mDown)canvas.style.cursor='grab'}});
document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;if(!mDown)canvas.style.cursor=mode==='line'?'crosshair':'default'}});

function isInputFocused(){return['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)}

// =====================================================
// PROPERTIES PANEL
// =====================================================
// Track last rendered selection to avoid full DOM rebuilds
let _propsLastKey='';

function showProps(){
  const panel=document.getElementById('props-inner');
  const ids=Array.from(sel.nodes);
  if(ids.length===0&&!sel.edgeId&&!sel.frameId){hideProps();return;}

  // Build a key that identifies what is selected and its type
  const selKey=ids.length>0?'node:'+ids.join(','):sel.edgeId?'edge:'+sel.edgeId:'frame:'+sel.frameId;

  if(selKey===_propsLastKey){
    // Same selection — just sync values (no DOM rebuild, no flicker)
    _syncProps(ids);
    return;
  }
  _propsLastKey=selKey;

  // Full rebuild only when selection changes
  let html='';
  if(ids.length>0){
    const n=getNode(ids[0]);if(!n)return;
    html+=pRow('Label',`<input class="prop-input" id="pp-label" value="${esc(n.label||'')}">`)
        +pRow('X',`<input class="prop-input" id="pp-x" type="number" value="${Math.round(n.x)}">`)
        +pRow('Y',`<input class="prop-input" id="pp-y" type="number" value="${Math.round(n.y)}">`)
        +pRow('W',`<input class="prop-input" id="pp-w" type="number" value="${Math.round(n.w)}">`)
        +pRow('H',`<input class="prop-input" id="pp-h" type="number" value="${Math.round(n.h)}">`)
        +pRow('Rot',`<input class="prop-input" id="pp-rot" type="number" value="${Math.round(n.rot||0)}">`)
        +pRow('Opac',`<input class="prop-input" id="pp-op" type="number" min="0" max="1" step="0.05" value="${n.opacity}">`)
        +pRow('Color',`<input class="prop-input" id="pp-color" type="color" value="${n.color||'#e8c547'}">`);
    if(n.type==='text'){
      const fonts=['IBM Plex Mono','IBM Plex Sans','Space Mono','Crimson Pro','Georgia','Arial','Courier New','Impact'];
      html+=pRow('Font',`<select class="prop-input" id="pp-font">${fonts.map(f=>`<option${n.fontFamily===f?' selected':''}>${f}</option>`).join('')}</select>`)
          +pRow('Size',`<input class="prop-input" id="pp-fsize" type="number" min="8" max="96" value="${n.fontSize||13}">`);
    }
  }else if(sel.edgeId){
    const edge=getEdge(sel.edgeId);if(!edge)return;
    html+=pRow('Label',`<input class="prop-input" id="pp-elabel" value="${esc(edge.label||'')}">`)
        +pRow('Color',`<input class="prop-input" id="pp-ecolor" type="color" value="${edge.color}">`)
        +pRow('Style',`<select class="prop-input" id="pp-estyle">${['solid','dashed','dotted'].map(s=>`<option${edge.style===s?' selected':''}>${s}</option>`).join('')}</select>`)
        +pRow('Curve',`<input class="prop-input" id="pp-ecurve" type="range" min="-200" max="200" step="10" value="${edge.curve||0}" style="padding:0"><span id="pp-ecurve-val" style="font-family:var(--font-mono);font-size:10px;color:var(--text2);min-width:28px;text-align:right">${edge.curve||0}</span>`)
        +pRow('Mode',`<select class="prop-input" id="pp-elmode"><option value="pill"${(edge.labelMode||'pill')==='pill'?' selected':''}>Pill</option><option value="along"${edge.labelMode==='along'?' selected':''}>Along edge</option></select>`);
  }else if(sel.frameId){
    const frame=(curLayer().frames||[]).find(f=>f.id===sel.frameId);if(!frame)return;
    html+=pRow('Title',`<input class="prop-input" id="pp-ftitle" value="${esc(frame.title||'')}">`)
        +pRow('Color',`<input class="prop-input" id="pp-fcolor" type="color" value="${frame.color||'#5b8dee'}">`)
        +pRow('',`<button class="prop-input" id="pp-fgroup" style="cursor:pointer;background:var(--accent);color:#000;border:none;padding:5px;">Group selection into frame</button>`);
  }
  panel.innerHTML=html;
  _bindProps(ids);
}

// Update input values in-place without touching the DOM structure
function _syncProps(ids){
  if(ids.length>0){
    const n=getNode(ids[0]);if(!n)return;
    const set=(id,v)=>{const el=document.getElementById(id);if(el&&document.activeElement!==el)el.value=v;};
    set('pp-x',Math.round(n.x));set('pp-y',Math.round(n.y));
    set('pp-w',Math.round(n.w));set('pp-h',Math.round(n.h));
    set('pp-rot',Math.round(n.rot||0));set('pp-op',n.opacity);
  }
}

// Wire up all event listeners after a full rebuild
function _bindProps(ids){
  const bind=(elId,applyFn)=>{
    const el=document.getElementById(elId);if(!el)return;
    el.addEventListener('change',()=>applyFn(el.value));
    el.addEventListener('input',()=>applyFn(el.value));
  };
  if(ids.length>0){
    // Helpers for undoable property changes
    const applyNow=(prop,parse)=>val=>{
      ids.forEach(id=>{const n=getNode(id);if(n)n[prop]=parse?parse(val):val});mark();
    };
    const applyUndo=(prop,parse)=>val=>{
      const parsed=parse?parse(val):val;
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,old:n[prop],n}:null}).filter(Boolean);
      snaps.forEach(s=>s.n[prop]=parsed);
      mark();
      // Debounce undo recording: only commit to history on 'change' (not 'input')
    };
    const commitUndo=(prop,parse)=>()=>{
      const val=document.getElementById('pp-'+prop)?.value;if(val===undefined)return;
      const parsed=parse?parse(val):val;
      const li=curLayerIdx;
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,before:n[prop],after:parsed}:null}).filter(Boolean);
      hist.cmds.splice(hist.ptr+1);
      if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(new Cmd(
        ()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n)n[prop]=s.after});mark()},
        ()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n)n[prop]=s.before});mark()}
      ));
    };

    // label: no live preview needed, just undo on change
    bind('pp-label',v=>{
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,old:n.label,n}:null}).filter(Boolean);
      snaps.forEach(s=>s.n.label=v);mark();
    });
    document.getElementById('pp-label')?.addEventListener('change',()=>{
      const v=document.getElementById('pp-label').value;
      const li=curLayerIdx;
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,before:n.label,after:v}:null}).filter(Boolean);
      hist.cmds.splice(hist.ptr+1);if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(new Cmd(()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n)n.label=s.after});mark()},()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n)n.label=s.before});mark()}));
    });

    // Numeric props: live update on input, undo on change
    ['x','y','w','h','rot'].forEach(prop=>{
      const parse=prop==='w'||prop==='h'?v=>Math.max(10,parseFloat(v)):parseFloat;
      bind('pp-'+prop,applyNow(prop,parse));
      document.getElementById('pp-'+prop)?.addEventListener('change',commitUndo(prop,parse));
    });

    // Opacity: live + undo
    bind('pp-op',applyNow('opacity',parseFloat));
    document.getElementById('pp-op')?.addEventListener('change',commitUndo('opacity',parseFloat));

    // Color: live + undo
    const colorSnaps=ids.map(id=>{const n=getNode(id);return n?{id,old:n.color}:null}).filter(Boolean);
    const colorEl=document.getElementById('pp-color');
    if(colorEl){
      colorEl.addEventListener('input',()=>{ids.forEach(id=>{const n=getNode(id);if(n)n.color=colorEl.value});mark();});
      colorEl.addEventListener('change',()=>{
        const v=colorEl.value;
        const snaps=ids.map(id=>{const n=getNode(id);return n?{id,before:colorSnaps.find(s=>s.id===id)?.old||v,after:v}:null}).filter(Boolean);
        hist.cmds.splice(hist.ptr+1);if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
        hist.cmds.push(new Cmd(()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n)n.color=s.after});mark()},()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n)n.color=s.before});mark()}));
      });
    }

    // Font/size
    bind('pp-font',v=>{
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,old:n.fontFamily,n}:null}).filter(Boolean);
      snaps.forEach(s=>{s.n.fontFamily=v;if(s.n.type==='text'){const{h}=measureTextBox(s.n.content||'',v,s.n.fontSize||13,s.n.w);s.n.h=h;}});
      mark();
    });
    document.getElementById('pp-font')?.addEventListener('change',()=>{
      const v=document.getElementById('pp-font').value;
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,before:n.fontFamily,after:v,n}:null}).filter(Boolean);
      hist.cmds.splice(hist.ptr+1);if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(new Cmd(
        ()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n){n.fontFamily=s.after;if(n.type==='text'){const{h}=measureTextBox(n.content||'',s.after,n.fontSize||13,n.w);n.h=h;}}});mark()},
        ()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n){n.fontFamily=s.before;if(n.type==='text'){const{h}=measureTextBox(n.content||'',s.before,n.fontSize||13,n.w);n.h=h;}}});mark()}
      ));
    });

    bind('pp-fsize',v=>{
      const fs=parseInt(v);
      ids.forEach(id=>{const n=getNode(id);if(n){n.fontSize=fs;if(n.type==='text'){const{h}=measureTextBox(n.content||'',n.fontFamily||'IBM Plex Mono',fs,n.w);n.h=h;}}});
      mark();
    });
    document.getElementById('pp-fsize')?.addEventListener('change',()=>{
      const fs=parseInt(document.getElementById('pp-fsize').value);
      const snaps=ids.map(id=>{const n=getNode(id);return n?{id,before:n.fontSize,after:fs,bh:n.h,n}:null}).filter(Boolean);
      hist.cmds.splice(hist.ptr+1);if(hist.cmds.length>=hist.max)hist.cmds.shift();else hist.ptr++;
      hist.cmds.push(new Cmd(
        ()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n){n.fontSize=s.after;if(n.type==='text'){const{h}=measureTextBox(n.content||'',n.fontFamily||'IBM Plex Mono',s.after,n.w);n.h=h;}}});mark()},
        ()=>{snaps.forEach(s=>{const n=getNode(s.id);if(n){n.fontSize=s.before;n.h=s.bh;}});mark()}
      ));
    });

  }else if(sel.edgeId){
    const edge=getEdge(sel.edgeId);
    if(edge){
      bind('pp-elabel',v=>{edge.label=v;mark()});
      bind('pp-ecolor',v=>{edge.color=v;mark()});
      bind('pp-estyle',v=>{edge.style=v;mark()});
      bind('pp-ecurve',v=>{edge.curve=parseFloat(v);const lbl=document.getElementById('pp-ecurve-val');if(lbl)lbl.textContent=v;mark()});
      bind('pp-elmode',v=>{edge.labelMode=v;mark()});
    }
  }else if(sel.frameId){
    const frame=(curLayer().frames||[]).find(f=>f.id===sel.frameId);
    if(frame){
      bind('pp-ftitle',v=>{frame.title=v;mark()});
      bind('pp-fcolor',v=>{frame.color=v;mark()});
      const gb=document.getElementById('pp-fgroup');
      if(gb)gb.addEventListener('click',()=>groupSelectionIntoFrame());
    }
  }
}
function pRow(l,inp){return`<div class="prop-row"><span class="prop-label">${l}</span>${inp}</div>`}
function hideProps(){document.getElementById('props-inner').innerHTML='<div style="padding:12px;font-family:var(--font-mono);font-size:10px;color:var(--text3)">Nothing selected</div>'}

