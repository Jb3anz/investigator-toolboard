const canvas=document.getElementById('main-canvas');
const ctx=canvas.getContext('2d',{alpha:false});
// Correct canvas-relative coords (canvas doesn't start at 0,0 — toolbar is above)
function cx(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
const mm=document.getElementById('minimap');
const mctx=mm.getContext('2d');
let dirty=true,mmDirty=true;
const mark=()=>{dirty=true;mmDirty=true;_qtDirty=true;};
const markMM=()=>{mmDirty=true};

// Offscreen grid cache
let gridCache=null,gridCacheKey='';
function buildGrid(){
  const gs=gridSize*cam.zoom;
  const ox=((cam.x%gs)+gs)%gs,oy=((cam.y%gs)+gs)%gs;
  const key=canvas.width+'|'+canvas.height+'|'+cam.zoom.toFixed(2)+'|'+ox.toFixed(1)+'|'+oy.toFixed(1);
  if(key===gridCacheKey&&gridCache)return gridCache;
  gridCacheKey=key;
  const off=new OffscreenCanvas(canvas.width,canvas.height);
  const g=off.getContext('2d');
  g.fillStyle='#0d0f14';g.fillRect(0,0,canvas.width,canvas.height);
  g.beginPath();g.strokeStyle='#1c1f2b';g.lineWidth=1;
  for(let x=ox;x<canvas.width+gs;x+=gs){g.moveTo(x,0);g.lineTo(x,canvas.height)}
  for(let y=oy;y<canvas.height+gs;y+=gs){g.moveTo(0,y);g.lineTo(canvas.width,y)}
  g.stroke();
  const op=cam.w2s(0,0);
  g.beginPath();g.arc(op.x,op.y,3.5,0,Math.PI*2);g.fillStyle='#e8c547';g.fill();
  gridCache=off;return off;
}

// =====================================================
// RENDER
// =====================================================
function render(){
  if(!dirty)return;
  dirty=false;
  ctx.drawImage(buildGrid(),0,0);
  ctx.save();
  ctx.translate(cam.x,cam.y);
  ctx.scale(cam.zoom,cam.zoom);
  const layer=curLayer();
  // Draw frames first (behind everything)
  (layer.frames||[]).forEach(f=>drawFrame(ctx,f));
  layer.edges.forEach(e=>drawEdge(ctx,e));
  if(mode==='line'&&lineStart){
    const sn=getNode(lineStart);
    if(sn){
      ctx.beginPath();ctx.moveTo(sn.x+sn.w/2,sn.y+sn.h/2);ctx.lineTo(lineTempX,lineTempY);
      ctx.strokeStyle=ui.edgeColor;ctx.lineWidth=2/cam.zoom;
      ctx.setLineDash([6/cam.zoom,4/cam.zoom]);ctx.stroke();ctx.setLineDash([]);
    }
  }
  layer.nodes.forEach(n=>drawNode(ctx,n));
  if(dragSel.on){
    const rx=Math.min(dragSel.x0,dragSel.x1),ry=Math.min(dragSel.y0,dragSel.y1);
    const rw=Math.abs(dragSel.x1-dragSel.x0),rh=Math.abs(dragSel.y1-dragSel.y0);
    ctx.fillStyle='rgba(232,197,71,.06)';ctx.strokeStyle='rgba(232,197,71,.45)';
    ctx.lineWidth=1/cam.zoom;ctx.fillRect(rx,ry,rw,rh);ctx.strokeRect(rx,ry,rw,rh);
  }
  if(frameDraw.on){
    const rx=Math.min(frameDraw.x0,frameDraw.x1),ry=Math.min(frameDraw.y0,frameDraw.y1);
    const rw=Math.abs(frameDraw.x1-frameDraw.x0),rh=Math.abs(frameDraw.y1-frameDraw.y0);
    ctx.fillStyle='rgba(91,141,238,.06)';ctx.strokeStyle='rgba(91,141,238,.6)';
    ctx.lineWidth=1.5/cam.zoom;ctx.setLineDash([8/cam.zoom,4/cam.zoom]);
    ctx.fillRect(rx,ry,rw,rh);ctx.strokeRect(rx,ry,rw,rh);ctx.setLineDash([]);
    ctx.font=`${Math.round(11/cam.zoom)}px IBM Plex Mono`;ctx.fillStyle='#5b8dee';
    ctx.textBaseline='top';ctx.fillText('Frame',rx+4/cam.zoom,ry+4/cam.zoom);
  }
  ctx.restore();
  // Draw waypoint pins on canvas (screen space, outside camera transform)
  if(!presentMode&&waypoints.length){
    drawWaypointPinsOnCanvas();
  }
  renderMinimap();
  updateStatus();
  // Keep spotlight aligned with current camera position (pan/zoom during present mode)
  if(presentMode&&_presentSpotlight&&waypoints[presentWpIdx]){
    drawSpotlight(waypoints[presentWpIdx]);
  }
}

// =====================================================
// NODE DRAWING
// =====================================================
function drawNode(ctx,n){
  const isSel=sel.nodes.has(n.id);
  ctx.save();
  ctx.translate(n.x+n.w/2,n.y+n.h/2);
  ctx.rotate(n.rot*Math.PI/180);
  ctx.globalAlpha=n.opacity;
  const hw=n.w/2,hh=n.h/2;
  if(n.type==='text'){
    ctx.fillStyle='rgba(13,15,20,.78)';ctx.fillRect(-hw-5,-hh-5,n.w+10,n.h+10);
    ctx.fillStyle=n.color||'#d8dce8';
    const fam=(n.fontFamily||'IBM Plex Mono')+',monospace';
    const fsz=n.fontSize||13;
    ctx.font=fsz+'px '+fam;
    ctx.textBaseline='top';
    const lh=fsz*1.5;
    const PAD=8;
    // Wrap text to fit in the node box
    const lines=wrapTextLines(n.content||'',n.fontFamily||'IBM Plex Mono',fsz,n.w-PAD*2);
    // Clip so text can't overflow the box
    ctx.save();
    ctx.beginPath();ctx.rect(-hw,-hh,n.w,n.h);ctx.clip();
    lines.forEach((line,i)=>ctx.fillText(line,-hw+PAD,-hh+PAD+i*lh));
    ctx.restore();
  }else if(n.type==='image'){
    const img=mediaReg.get(n.id);
    if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-hw,-hh,n.w,n.h);
    else drawPlaceholder(ctx,hw,hh,'IMG');
  }else if(n.type==='video'){
    const vid=mediaReg.get(n.id);
    if(vid&&vid.readyState>=2){ctx.drawImage(vid,-hw,-hh,n.w,n.h);if(!vid.paused)dirty=true;}
    else drawPlaceholder(ctx,hw,hh,'VIDEO');
  }else if(n.type==='audio'){
    ctx.fillStyle='#13161e';ctx.fillRect(-hw,-hh,n.w,n.h);
    ctx.font=`bold ${Math.round(14/cam.zoom)}px IBM Plex Mono,monospace`;ctx.textBaseline='middle';ctx.textAlign='center';
    ctx.fillStyle=n.color||'#e8c547';ctx.fillText('AUDIO',0,-8/cam.zoom);
    const med=mediaReg.get(n.id);
    ctx.font=`${Math.round(10/cam.zoom)}px IBM Plex Mono`;ctx.fillStyle='#8890a8';
    ctx.fillText(med&&!med.paused?'PLAYING':'PAUSED',0,11/cam.zoom);ctx.textAlign='start';
  }else if(n.type==='url'){
    ctx.fillStyle='#0e1520';ctx.fillRect(-hw,-hh,n.w,n.h);
    ctx.font=`bold ${Math.round(11/cam.zoom)}px IBM Plex Mono,monospace`;ctx.textBaseline='middle';ctx.textAlign='center';
    ctx.fillStyle='#5b8dee';ctx.fillText('WEB',-0,-14/cam.zoom);
    ctx.font=`${Math.round(9/cam.zoom)}px IBM Plex Mono`;ctx.fillStyle='#8890a8';
    const urlStr=(n.content||'').replace(/https?:\/\//,'');
    ctx.fillText(urlStr.length>32?urlStr.slice(0,32)+'…':urlStr,0,4/cam.zoom);
    ctx.fillStyle='#555d72';ctx.fillText('(live embed)',0,18/cam.zoom);
    ctx.textAlign='start';
  }else if(n.type==='pdfviewer'){
    ctx.fillStyle='#1a1020';ctx.fillRect(-hw,-hh,n.w,n.h);
    ctx.font=`bold ${Math.round(11/cam.zoom)}px IBM Plex Mono,monospace`;ctx.textBaseline='middle';ctx.textAlign='center';
    ctx.fillStyle='#e05252';ctx.fillText('PDF',0,-18/cam.zoom);
    ctx.font=`${Math.round(9/cam.zoom)}px IBM Plex Mono`;ctx.fillStyle='#d8dce8';
    ctx.fillText((n.content||'PDF').length>36?(n.content||'PDF').slice(0,36)+'…':(n.content||'PDF'),0,2/cam.zoom);
    ctx.fillStyle='#555d72';ctx.fillText(`page ${n.pdfCurPage||1}/${n.pdfTotalPages||'?'}`,0,18/cam.zoom);
    ctx.textAlign='start';
  }else if(n.type==='pdf'){
    const img=mediaReg.get(n.id);
    if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-hw,-hh,n.w,n.h);
    else drawPlaceholder(ctx,hw,hh,'PDF');
  }
  ctx.globalAlpha=n.opacity;
  ctx.strokeStyle=isSel?'#ffffff':(n.color||'#e8c547');
  ctx.lineWidth=isSel?2.5/cam.zoom:1.5/cam.zoom;
  if(isSel)ctx.setLineDash([5/cam.zoom,3/cam.zoom]);
  ctx.strokeRect(-hw,-hh,n.w,n.h);
  ctx.setLineDash([]);
  if(n.label){
    ctx.globalAlpha=.85;ctx.font='9px IBM Plex Mono';ctx.fillStyle='#fff';
    ctx.textBaseline='bottom';ctx.fillText(n.label,-hw+3,-hh-2);
  }
  if(isSel){
    const hs=7/cam.zoom;
    ctx.fillStyle='#ffffff';
    [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].forEach(([hx,hy])=>ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs));
    ctx.beginPath();ctx.arc(0,-hh-16/cam.zoom,6/cam.zoom,0,Math.PI*2);ctx.fillStyle='#e8c547';ctx.fill();
    // Rotate symbol inside circle
    ctx.save();ctx.strokeStyle='#000';ctx.lineWidth=1.2/cam.zoom;
    ctx.beginPath();ctx.arc(0,-hh-16/cam.zoom,3/cam.zoom,0.4,Math.PI*1.8);ctx.stroke();
    ctx.restore();
    ctx.strokeStyle='#e8c54760';ctx.lineWidth=1/cam.zoom;
    ctx.beginPath();ctx.moveTo(0,-hh-10/cam.zoom);ctx.lineTo(0,-hh);ctx.stroke();
    // Blue resize handle
    ctx.fillStyle='#5b8dee';ctx.fillRect(hw-hs,hh-hs,hs,hs);
  }
  ctx.restore();
}

function drawPlaceholder(ctx,hw,hh,label){
  ctx.fillStyle='#1a1d28';ctx.fillRect(-hw,-hh,hw*2,hh*2);
  ctx.fillStyle='#555d72';ctx.font='11px IBM Plex Mono';
  ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(label,0,0);ctx.textAlign='start';
}

// =====================================================
// EDGE DRAWING — curved bezier + labels
// =====================================================
// Returns bezier control point for an edge (perpendicular offset)
function edgeCtrlPt(sx,sy,ex,ey,curve){
  if(!curve)return{cx:(sx+ex)/2,cy:(sy+ey)/2}; // straight — midpoint is "ctrl"
  const mx=(sx+ex)/2,my=(sy+ey)/2;
  const dx=ex-sx,dy=ey-sy,len=Math.hypot(dx,dy)||1;
  // Perpendicular offset
  return{cx:mx-dy/len*curve,cy:my+dx/len*curve};
}
// Point on quadratic bezier at t
function bezierPt(sx,sy,cx,cy,ex,ey,t){
  const it=1-t;
  return{x:it*it*sx+2*it*t*cx+t*t*ex, y:it*it*sy+2*it*t*cy+t*t*ey};
}
// Tangent angle at t on bezier
function bezierAngle(sx,sy,cx,cy,ex,ey,t){
  const it=1-t;
  const dxt=2*it*(cx-sx)+2*t*(ex-cx);
  const dyt=2*it*(cy-sy)+2*t*(ey-cy);
  return Math.atan2(dyt,dxt);
}

function drawEdge(ctx,edge){
  const layer=curLayer();
  const sn=getNode(edge.startId);
  const en=getNode(edge.endId);
  if(!sn||!en)return;
  const sx=sn.x+sn.w/2,sy=sn.y+sn.h/2;
  const ex=en.x+en.w/2,ey=en.y+en.h/2;
  const curve=edge.curve||0;
  const{cx,cy}=edgeCtrlPt(sx,sy,ex,ey,curve);
  const isSel=edge.id===sel.edgeId;
  ctx.save();
  ctx.strokeStyle=isSel?'#fff':edge.color;
  ctx.lineWidth=(isSel?3:2)/cam.zoom;
  if(edge.style==='dashed')ctx.setLineDash([8/cam.zoom,4/cam.zoom]);
  else if(edge.style==='dotted')ctx.setLineDash([2/cam.zoom,5/cam.zoom]);
  ctx.beginPath();ctx.moveTo(sx,sy);
  if(curve){ctx.quadraticCurveTo(cx,cy,ex,ey);}
  else{ctx.lineTo(ex,ey);}
  ctx.stroke();ctx.setLineDash([]);
  const endAngle=bezierAngle(sx,sy,cx,cy,ex,ey,0.97);
  const startAngle=bezierAngle(sx,sy,cx,cy,ex,ey,0.03)+Math.PI;
  if(edge.arrowStyle!=='none')drawArrow(ctx,ex,ey,endAngle,12,edge.arrowStyle,edge.color);
  if(edge.arrowStyle==='double')drawArrow(ctx,sx,sy,startAngle,12,'open',edge.color);
  // Label — two modes: 'pill' (default) or 'along' (text follows edge path)
  if(edge.label){
    const mid=bezierPt(sx,sy,cx,cy,ex,ey,0.5);
    const angle=bezierAngle(sx,sy,cx,cy,ex,ey,0.5);
    ctx.save();
    ctx.font=`${Math.round(11/cam.zoom)}px IBM Plex Mono,monospace`;
    if(edge.labelMode==='along'){
      // Draw text rotated along the edge
      ctx.translate(mid.x,mid.y);
      // Keep text readable (flip if angle points left)
      const normAngle=((angle%(Math.PI*2))+Math.PI*2)%(Math.PI*2);
      const flip=normAngle>Math.PI/2&&normAngle<3*Math.PI/2;
      ctx.rotate(flip?angle+Math.PI:angle);
      const tw=ctx.measureText(edge.label).width;
      ctx.fillStyle='rgba(13,15,20,.7)';
      ctx.fillRect(-tw/2-3,-12/cam.zoom,tw+6,14/cam.zoom);
      ctx.fillStyle=isSel?'#fff':edge.color;
      ctx.textAlign='center';ctx.textBaseline='bottom';
      ctx.fillText(edge.label,0,0);
    }else{
      // Pill label (default)
      const tw=ctx.measureText(edge.label).width;
      const pad=5/cam.zoom,ph=14/cam.zoom;
      ctx.fillStyle=isSel?'rgba(255,255,255,.12)':'rgba(13,15,20,.82)';
      ctx.beginPath();
      const rx=mid.x-tw/2-pad,ry=mid.y-ph/2;
      const rr=ph/2;
      ctx.roundRect(rx,ry,tw+pad*2,ph,rr);
      ctx.fill();
      ctx.strokeStyle=edge.color;ctx.lineWidth=0.8/cam.zoom;ctx.stroke();
      ctx.fillStyle=isSel?'#fff':edge.color;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(edge.label,mid.x,mid.y);
    }
    ctx.textAlign='start';
    ctx.restore();
  }
  ctx.restore();
}

function drawArrow(ctx,x,y,angle,size,style,color){
  const s=size/cam.zoom;
  const x1=x-s*Math.cos(angle-Math.PI/6),y1=y-s*Math.sin(angle-Math.PI/6);
  const x2=x-s*Math.cos(angle+Math.PI/6),y2=y-s*Math.sin(angle+Math.PI/6);
  ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x1,y1);
  if(style==='filled'){ctx.lineTo(x2,y2);ctx.closePath();ctx.fillStyle=color;ctx.fill();}
  else{ctx.moveTo(x,y);ctx.lineTo(x2,y2);}
  ctx.strokeStyle=color;ctx.lineWidth=2/cam.zoom;ctx.stroke();
}

// =====================================================
// FRAME DRAWING
// =====================================================
function drawFrame(ctx,f){
  const isSel=sel.frameId===f.id;
  const collapsed=f.collapsed||(cam.zoom<0.25);
  ctx.save();
  // Translucent fill
  const col=f.color||'#5b8dee';
  ctx.fillStyle=col+'18';
  ctx.strokeStyle=isSel?'#fff':col;
  ctx.lineWidth=(isSel?2:1.5)/cam.zoom;
  if(!collapsed){
    ctx.setLineDash([8/cam.zoom,4/cam.zoom]);
    ctx.fillRect(f.x,f.y,f.w,f.h);
    ctx.strokeRect(f.x,f.y,f.w,f.h);
    ctx.setLineDash([]);
    // Title bar
    ctx.fillStyle=col+'30';
    const tbH=24/cam.zoom;
    ctx.fillRect(f.x,f.y,f.w,tbH);
    // Title text
    ctx.font=`bold ${Math.round(11/cam.zoom)}px IBM Plex Mono,monospace`;
    ctx.fillStyle=col;ctx.textBaseline='middle';
    ctx.fillText(f.title||'Frame',f.x+8/cam.zoom,f.y+tbH/2);
    // Resize handle
    if(isSel){
      const hs=7/cam.zoom;
      ctx.fillStyle='#5b8dee';
      ctx.fillRect(f.x+f.w-hs,f.y+f.h-hs,hs,hs);
    }
  }else{
    // Collapsed: just a labeled rounded rect
    ctx.lineWidth=2/cam.zoom;
    const pad=14/cam.zoom;
    ctx.font=`bold ${Math.round(12/cam.zoom)}px IBM Plex Mono,monospace`;
    const tw=ctx.measureText(f.title||'Frame').width;
    const bw=tw+pad*2,bh=28/cam.zoom;
    ctx.fillRect(f.x,f.y,bw,bh);
    ctx.strokeRect(f.x,f.y,bw,bh);
    ctx.fillStyle=col;ctx.textBaseline='middle';ctx.textAlign='center';
    ctx.fillText(f.title||'Frame',f.x+bw/2,f.y+bh/2);
    ctx.textAlign='start';
  }
  ctx.restore();
}

// =====================================================
// MINIMAP
// =====================================================
function renderMinimap(){
  if(!mmDirty)return;mmDirty=false;
  const mW=mm.width,mH=mm.height;
  mctx.fillStyle='#0d0f14';mctx.fillRect(0,0,mW,mH);
  const allNodes=layers.flatMap(l=>l.nodes);
  if(!allNodes.length){mctx.strokeStyle='#252836';mctx.strokeRect(0,0,mW,mH);return}
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  allNodes.forEach(n=>{minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+n.h)});
  minX-=60;minY-=60;maxX+=60;maxY+=60;
  const sc=Math.min(mW/(maxX-minX),mH/(maxY-minY));
  const offX=(mW-(maxX-minX)*sc)/2,offY=(mH-(maxY-minY)*sc)/2;
  const toMM=(wx,wy)=>({x:(wx-minX)*sc+offX,y:(wy-minY)*sc+offY});
  // Draw edges first (behind nodes)
  layers.forEach((layer,li)=>{
    const isActive=li===curLayerIdx;
    layer.edges.forEach(e=>{
      const sn=layer.nodes.find(n=>n.id===e.startId),en=layer.nodes.find(n=>n.id===e.endId);
      if(!sn||!en)return;
      const sp=toMM(sn.x+sn.w/2,sn.y+sn.h/2),ep=toMM(en.x+en.w/2,en.y+en.h/2);
      const curve=e.curve||0;
      mctx.save();
      mctx.globalAlpha=isActive?.55:.15;
      mctx.strokeStyle=e.color||'#f07a3a';
      mctx.lineWidth=isActive?1.2:0.6;
      if(curve){
        const mx=(sp.x+ep.x)/2,my=(sp.y+ep.y)/2;
        const dx=ep.x-sp.x,dy=ep.y-sp.y,len=Math.hypot(dx,dy)||1;
        const cpx=mx-dy/len*curve*sc,cpy=my+dx/len*curve*sc;
        mctx.beginPath();mctx.moveTo(sp.x,sp.y);mctx.quadraticCurveTo(cpx,cpy,ep.x,ep.y);
      }else{
        mctx.beginPath();mctx.moveTo(sp.x,sp.y);mctx.lineTo(ep.x,ep.y);
      }
      mctx.stroke();
      mctx.restore();
    });
  });
  // Draw nodes on top
  layers.forEach((layer,li)=>{
    const isActive=li===curLayerIdx;
    layer.nodes.forEach(n=>{
      const p=toMM(n.x,n.y);
      mctx.fillStyle=n.color||'#e8c547';mctx.globalAlpha=isActive?.65:.2;
      mctx.fillRect(p.x,p.y,Math.max(2,n.w*sc),Math.max(2,n.h*sc));
    });
  });
  mctx.globalAlpha=1;
  const vTL=cam.s2w(0,0),vBR=cam.s2w(canvas.width,canvas.height);
  const vtl=toMM(vTL.x,vTL.y),vbr=toMM(vBR.x,vBR.y);
  mctx.strokeStyle='rgba(232,197,71,.6)';mctx.lineWidth=1;
  mctx.strokeRect(vtl.x,vtl.y,vbr.x-vtl.x,vbr.y-vtl.y);
  mctx.strokeStyle='#252836';mctx.strokeRect(0,0,mW,mH);
}


