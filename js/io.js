// =====================================================
// INDEXEDDB — persist media blobs across save/load
// =====================================================
const DB_NAME='Investig8rDB',DB_VER=2,STORE='media',BOARD_STORE='boards';
let db=null;
const dbReady=new Promise((res,rej)=>{
  const req=indexedDB.open(DB_NAME,DB_VER);
  req.onupgradeneeded=e=>{
    const db=e.target.result;
    if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
    if(!db.objectStoreNames.contains(BOARD_STORE))db.createObjectStore(BOARD_STORE,{keyPath:'id'});
  };
  req.onsuccess=e=>{db=e.target.result;res(db)};
  req.onerror=()=>rej(new Error('IndexedDB failed'));
});
async function dbPut(id,blob){await dbReady;return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');const req=tx.objectStore(STORE).put({id,blob});req.onsuccess=()=>res();req.onerror=()=>rej(req.error)});}
async function dbGet(id){await dbReady;return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly');const req=tx.objectStore(STORE).get(id);req.onsuccess=()=>res(req.result?.blob||null);req.onerror=()=>rej(req.error)});}
async function dbDel(id){await dbReady;return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');const req=tx.objectStore(STORE).delete(id);req.onsuccess=()=>res();req.onerror=()=>rej(req.error)});}
async function dbClear(){await dbReady;return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');const req=tx.objectStore(STORE).clear();req.onsuccess=()=>res();req.onerror=()=>rej(req.error)});}
// Board JSON storage in IndexedDB (no 5MB localStorage limit)
async function dbPutBoard(data){await dbReady;return new Promise((res,rej)=>{const tx=db.transaction(BOARD_STORE,'readwrite');const req=tx.objectStore(BOARD_STORE).put({id:'main',data});req.onsuccess=()=>res();req.onerror=()=>rej(req.error)});}
async function dbGetBoard(){await dbReady;return new Promise((res,rej)=>{const tx=db.transaction(BOARD_STORE,'readonly');const req=tx.objectStore(BOARD_STORE).get('main');req.onsuccess=()=>res(req.result?.data||null);req.onerror=()=>rej(req.error);});}

// =====================================================
// SAVE / LOAD / EXPORT
// =====================================================
function serialize(){
  return{v:4,camera:cam.save(),curLayerIdx,nid,eid,fid,wpid,waypoints:waypoints.map(w=>({...w})),layers:layers.map(l=>({id:l.id,name:l.name,visible:l.visible,
    nodes:l.nodes.map(n=>{
      // Snapshot iframe current URL if accessible (same-origin)
      let iframeCurrentUrl=null;
      if(n.type==='url'){
        const els=iframeEls.get(n.id);
        if(els&&els.iframe){
          try{iframeCurrentUrl=els.iframe.contentWindow.location.href;}catch(e){iframeCurrentUrl=n.content;}
        }
      }
      return{id:n.id,type:n.type,x:n.x,y:n.y,w:n.w,h:n.h,
        content:n.content,
        color:n.color,opacity:n.opacity,rot:n.rot,label:n.label,fontFamily:n.fontFamily,fontSize:n.fontSize,
        hasSavedMedia:['image','video','audio','pdfviewer'].includes(n.type),
        pdfCurPage:n.pdfCurPage,pdfTotalPages:n.pdfTotalPages,
        iframeCurrentUrl:iframeCurrentUrl||n.iframeCurrentUrl||null
      };
    }),
    edges:l.edges.map(e=>({...e})),frames:(l.frames||[]).map(f=>({...f}))}))};
}

document.getElementById('saveBtn').addEventListener('click',async()=>{
  try{
    toast('Saving…');
    const saveJobs=[];
    layers.forEach(l=>l.nodes.forEach(n=>{
      if(['image','video','audio'].includes(n.type)){
        const url=urlReg.get(n.id);
        if(url){saveJobs.push(fetch(url).then(r=>r.blob()).then(blob=>dbPut(n.id,blob)));}
      }
    }));
    await Promise.all(saveJobs);
    await dbPutBoard(serialize());
    // Also keep a tiny fallback in localStorage for offline detection
    try{localStorage.setItem('inv4_board_exists','1');}catch(e){}
    toast('Saved ✓','success');
  }catch(e){toast('Save failed: '+e.message,'error')}
});

document.getElementById('loadBtn').addEventListener('click',async()=>{
  try{
    toast('Loading…');
    // Try IndexedDB first, fall back to localStorage for older saves
    let d=await dbGetBoard();
    if(!d){
      const raw=localStorage.getItem('inv4_board');
      if(!raw){toast('No saved board','error');return}
      d=JSON.parse(raw);
    }
    urlReg.forEach(u=>URL.revokeObjectURL(u));urlReg.clear();mediaReg.clear();blobReg.clear();
    Object.assign(cam,Camera.load(d.camera));
    curLayerIdx=d.curLayerIdx||0;nid=d.nid||nid;eid=d.eid||eid;
    layers=d.layers.map(l=>({...l,nodes:l.nodes.map(n=>({...n})),edges:l.edges.map(e=>({...e})),frames:(l.frames||[]).map(f=>({...f}))}));
    waypoints=(d.waypoints||[]).map(w=>({...w}));
    fid=d.fid||fid;wpid=d.wpid||wpid;
    sel.nodes.clear();sel.edgeId=null;sel.frameId=null;gridCache=null;gridCacheKey='';
    rebuildIndex();
    rebuildIndex();renderLayersUI();hideProps();mark();markMM();renderWaypointPins();
    const restoreJobs=[];
    layers.forEach(l=>l.nodes.forEach(n=>{
      if(['image','video','audio'].includes(n.type)&&n.hasSavedMedia){
        restoreJobs.push(
          dbGet(n.id).then(blob=>{
            if(!blob)return;
            blobReg.set(n.id,blob);
            const url=URL.createObjectURL(blob);
            urlReg.set(n.id,url);
            if(n.type==='image'){
              const img=new Image();
              img.onload=()=>{mediaReg.set(n.id,img);mark()};
              img.src=url;
            }else if(n.type==='video'){
              const vid=document.createElement('video');
              vid.muted=false;vid.loop=true;vid.crossOrigin='anonymous';
              vid.onloadedmetadata=()=>{mediaReg.set(n.id,vid);mark()};
              vid.src=url;
            }else{
              const aud=new Audio();
              aud.onloadedmetadata=()=>{mediaReg.set(n.id,aud);mark()};
              aud.src=url;
            }
          }).catch(()=>{})
        );
      }
    }));
    await Promise.all(restoreJobs);
    toast('Loaded ✓','success');
  }catch(e){toast('Load failed: '+e.message,'error')}
});

// ── FULL CANVAS EXPORT ──
// Returns a regular <canvas> element sized to ALL content across all layers/nodes
// Async export — builds a canvas from ALL nodes across all layers.
// Uses createImageBitmap() so images never taint the canvas (toBlob works).
async function exportFullCanvas(){
  const allNodes=layers.flatMap(l=>l.nodes);
  if(!allNodes.length){toast('Nothing on the board to export','error');return null}

  // World-space bounding box (rotated AABB per node)
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  allNodes.forEach(n=>{
    const ncx=n.x+n.w/2,ncy=n.y+n.h/2;
    const hw=n.w/2,hh=n.h/2;
    const co=Math.abs(Math.cos((n.rot||0)*Math.PI/180));
    const si=Math.abs(Math.sin((n.rot||0)*Math.PI/180));
    const ew=hw*co+hh*si, eh=hw*si+hh*co;
    minX=Math.min(minX,ncx-ew); minY=Math.min(minY,ncy-eh);
    maxX=Math.max(maxX,ncx+ew); maxY=Math.max(maxY,ncy+eh);
  });
  const PAD=80;
  minX-=PAD; minY-=PAD; maxX+=PAD; maxY+=PAD;
  const W=Math.ceil(maxX-minX), H=Math.ceil(maxY-minY);

  // Pre-load all image bitmaps from blobReg (doesn't taint canvas)
  const bitmaps=new Map();
  await Promise.all(allNodes.map(async n=>{
    if(!['image','pdf'].includes(n.type)) return;
    const blob=blobReg.get(n.id);
    if(blob){
      try{ bitmaps.set(n.id, await createImageBitmap(blob)); }catch(e){}
    } else {
      // fallback: grab from the already-loaded img element via blob
      const imgEl=mediaReg.get(n.id);
      if(imgEl && imgEl.complete && imgEl.naturalWidth>0){
        try{ bitmaps.set(n.id, await createImageBitmap(imgEl)); }catch(e){}
      }
    }
  }));

  const ec=document.createElement('canvas');
  ec.width=W; ec.height=H;
  const g=ec.getContext('2d');

  // Dark background
  g.fillStyle='#0d0f14'; g.fillRect(0,0,W,H);

  // Grid
  g.strokeStyle='#1c1f2b'; g.lineWidth=1;
  const gs=50;
  for(let x=Math.floor(minX/gs)*gs; x<=maxX; x+=gs){
    g.beginPath(); g.moveTo(x-minX,0); g.lineTo(x-minX,H); g.stroke();
  }
  for(let y=Math.floor(minY/gs)*gs; y<=maxY; y+=gs){
    g.beginPath(); g.moveTo(0,y-minY); g.lineTo(W,y-minY); g.stroke();
  }
  // Origin dot
  if(-minX>=0&&-minX<=W&&-minY>=0&&-minY<=H){
    g.beginPath(); g.arc(-minX,-minY,5,0,Math.PI*2);
    g.fillStyle='#e8c547'; g.fill();
  }

  // Draw all visible layers
  layers.forEach(layer=>{
    if(!layer.visible) return;
    (layer.frames||[]).forEach(f=>drawFrameOnCtx(g,f,minX,minY));
    layer.edges.forEach(e=>drawEdgeOnCtx(g,e,layer,minX,minY));
    layer.nodes.forEach(n=>drawNodeOnCtxExport(g,n,minX,minY,bitmaps));
  });

  // Close bitmaps
  bitmaps.forEach(bm=>bm.close&&bm.close());
  return ec;
}

// Same as drawEdge but accepts a custom ctx, layer and world offset
function drawFrameOnCtx(g,f,minX,minY){
  g.save();
  const col=f.color||'#5b8dee';
  g.fillStyle=col+'18';g.strokeStyle=col;g.lineWidth=1.5;
  g.setLineDash([8,4]);
  g.fillRect(f.x-minX,f.y-minY,f.w,f.h);
  g.strokeRect(f.x-minX,f.y-minY,f.w,f.h);
  g.setLineDash([]);
  g.fillStyle=col+'30';g.fillRect(f.x-minX,f.y-minY,f.w,24);
  g.font='bold 11px IBM Plex Mono,monospace';g.fillStyle=col;
  g.textBaseline='middle';g.fillText(f.title||'Frame',f.x-minX+8,f.y-minY+12);
  g.restore();
}

function drawEdgeOnCtx(g,edge,layer,minX=0,minY=0){
  const sn=layer.nodes.find(n=>n.id===edge.startId),en=layer.nodes.find(n=>n.id===edge.endId);
  if(!sn||!en)return;
  const sx=sn.x+sn.w/2-minX,sy=sn.y+sn.h/2-minY,ex=en.x+en.w/2-minX,ey=en.y+en.h/2-minY;
  const curve=edge.curve||0;
  const mx=(sx+ex)/2,my=(sy+ey)/2;
  const dx=ex-sx,dy=ey-sy,len=Math.hypot(dx,dy)||1;
  const cpx=mx-dy/len*curve,cpy=my+dx/len*curve;
  g.save();g.strokeStyle=edge.color;g.lineWidth=2;
  if(edge.style==='dashed')g.setLineDash([8,4]);else if(edge.style==='dotted')g.setLineDash([2,5]);
  g.beginPath();g.moveTo(sx,sy);
  if(curve){g.quadraticCurveTo(cpx,cpy,ex,ey);}else{g.lineTo(ex,ey);}
  g.stroke();g.setLineDash([]);
  // Arrow angle from bezier tangent at t=0.97
  const t=0.97,it=1-t;
  const ang=Math.atan2(2*it*(cpy-sy)+2*t*(ey-cpy),2*it*(cpx-sx)+2*t*(ex-cpx));
  const sz=12;
  const drawAH=(x,y,angle,style)=>{
    const x1=x-sz*Math.cos(angle-Math.PI/6),y1=y-sz*Math.sin(angle-Math.PI/6);
    const x2=x-sz*Math.cos(angle+Math.PI/6),y2=y-sz*Math.sin(angle+Math.PI/6);
    g.beginPath();g.moveTo(x,y);g.lineTo(x1,y1);
    if(style==='filled'){g.lineTo(x2,y2);g.closePath();g.fillStyle=edge.color;g.fill()}
    else{g.moveTo(x,y);g.lineTo(x2,y2)}
    g.strokeStyle=edge.color;g.lineWidth=2;g.stroke();
  };
  if(edge.arrowStyle!=='none')drawAH(ex,ey,ang,edge.arrowStyle);
  if(edge.arrowStyle==='double')drawAH(sx,sy,ang+Math.PI,'open');
  // Label
  if(edge.label){
    const lx=(sx+ex)/2+(cpx-(sx+ex)/2)*0,ly=(sy+ey)/2+(cpy-(sy+ey)/2)*0;
    const mp=bezierPt(sx,sy,cpx,cpy,ex,ey,0.5);
    g.font='10px IBM Plex Mono,monospace';
    const tw=g.measureText(edge.label).width;
    g.fillStyle='rgba(13,15,20,.85)';g.fillRect(mp.x-tw/2-4,mp.y-8,tw+8,16);
    g.strokeStyle=edge.color;g.lineWidth=0.8;g.strokeRect(mp.x-tw/2-4,mp.y-8,tw+8,16);
    g.fillStyle=edge.color;g.textAlign='center';g.textBaseline='middle';
    g.fillText(edge.label,mp.x,mp.y);g.textAlign='start';
  }
  g.restore();
}

// Live canvas draw (uses mediaReg img elements directly)
function drawNodeOnCtx(g,n,minX=0,minY=0){
  drawNodeOnCtxExport(g,n,minX,minY,null);
}

// Export draw — accepts pre-built ImageBitmap map (doesn't taint canvas)
function drawNodeOnCtxExport(g,n,minX,minY,bitmaps){
  g.save();
  g.translate(n.x+n.w/2-minX, n.y+n.h/2-minY);
  g.rotate((n.rot||0)*Math.PI/180);
  g.globalAlpha=n.opacity||1;
  const hw=n.w/2, hh=n.h/2;

  if(n.type==='text'){
    g.fillStyle='rgba(13,15,20,.78)';
    g.fillRect(-hw-5,-hh-5,n.w+10,n.h+10);
    g.fillStyle=n.color||'#d8dce8';
    const fsz=n.fontSize||13;
    g.font=fsz+'px '+(n.fontFamily||'IBM Plex Mono')+',monospace';
    g.textBaseline='top';
    const lh=fsz*1.5;
    const PAD=8;
    const lines=wrapTextLines(n.content||'',n.fontFamily||'IBM Plex Mono',fsz,n.w-PAD*2);
    g.save();g.beginPath();g.rect(-hw,-hh,n.w,n.h);g.clip();
    lines.forEach((line,i)=>g.fillText(line,-hw+PAD,-hh+PAD+i*lh));
    g.restore();
  } else if(n.type==='image'||n.type==='pdf'){
    const bm = bitmaps&&bitmaps.get(n.id);
    if(bm){
      g.drawImage(bm,-hw,-hh,n.w,n.h);
    } else {
      const img=mediaReg.get(n.id);
      if(img&&img.complete&&img.naturalWidth>0) g.drawImage(img,-hw,-hh,n.w,n.h);
      else{
        g.fillStyle='#1a1d28';g.fillRect(-hw,-hh,n.w,n.h);
        g.fillStyle='#555d72';g.font='11px IBM Plex Mono';
        g.textAlign='center';g.textBaseline='middle';
        g.fillText(n.type==='pdf'?'PDF':'IMG',0,0);g.textAlign='start';
      }
    }
  } else if(n.type==='video'){
    const vid=mediaReg.get(n.id);
    if(vid&&vid.readyState>=2) g.drawImage(vid,-hw,-hh,n.w,n.h);
    else{
      g.fillStyle='#1a1d28';g.fillRect(-hw,-hh,n.w,n.h);
      g.fillStyle='#555d72';g.font='11px IBM Plex Mono';
      g.textAlign='center';g.textBaseline='middle';g.fillText('VIDEO',0,0);g.textAlign='start';
    }
  } else if(n.type==='audio'){
    g.fillStyle='#13161e';g.fillRect(-hw,-hh,n.w,n.h);
    g.font='20px sans-serif';g.textBaseline='middle';g.textAlign='center';
    g.fillStyle=n.color||'#e8c547';g.fillText('\u266A',0,-8);
    g.font='10px IBM Plex Mono';g.fillStyle='#8890a8';g.fillText('AUDIO',0,11);g.textAlign='start';
  } else if(n.type==='url'){
    g.fillStyle='#0e1520';g.fillRect(-hw,-hh,n.w,n.h);
    g.font='bold 12px IBM Plex Mono,monospace';g.textBaseline='middle';g.textAlign='center';
    g.fillStyle='#5b8dee';g.fillText('WEB',0,-12);
    g.font='10px IBM Plex Mono';g.fillStyle='#8890a8';
    const u=(n.content||'').replace(/https?:\/\//,'');
    g.fillText(u.length>40?u.slice(0,40)+'…':u,0,8);g.textAlign='start';
  } else if(n.type==='pdfviewer'){
    // Export: draw current page from the viewer canvas if available
    const state=pdfViewerEls.get(n.id);
    if(state&&state.canvas&&state.canvas.width>0){
      g.drawImage(state.canvas,-hw,-hh,n.w,n.h);
    } else {
      g.fillStyle='#1a1020';g.fillRect(-hw,-hh,n.w,n.h);
      g.font='bold 14px IBM Plex Mono,monospace';g.textBaseline='middle';g.textAlign='center';
      g.fillStyle='#e05252';g.fillText('PDF',0,0);g.textAlign='start';
    }
  }

  // Border + label
  g.globalAlpha=n.opacity||1;
  g.strokeStyle=n.color||'#e8c547';g.lineWidth=1.5;
  g.strokeRect(-hw,-hh,n.w,n.h);
  if(n.label){
    g.globalAlpha=.85;g.font='9px IBM Plex Mono';g.fillStyle='#fff';
    g.textBaseline='bottom';g.fillText(n.label,-hw+3,-hh-2);
  }
  g.restore();
}

// Helper: convert Blob/File to base64 data URL
function blobToDataURL(blob){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>res(fr.result);
    fr.onerror=()=>rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

document.getElementById('exportBtn').addEventListener('click',async()=>{
  const fmt=document.getElementById('exportFmt').value;

  if(fmt==='png'){
    // ── FULL BOARD PNG (async — waits for all images, uses ImageBitmap) ──
    toast('Building full-board PNG…');
    let ec;
    try{ ec=await exportFullCanvas(); }catch(err){ toast('Export error: '+err.message,'error');return; }
    if(!ec){return;}
    // toBlob is async — use Promise wrapper so we can await it
    const blob=await new Promise(res=>ec.toBlob(res,'image/png',1.0));
    if(!blob||blob.size===0){
      toast('PNG came out empty — board may have no visible content','error');return;
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.download='board.png';a.href=url;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    toast(`PNG exported — ${(blob.size/1024).toFixed(0)} KB ✓`,'success');

  }else if(fmt==='json'){
    const blob=new Blob([JSON.stringify(serialize(),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.download='board.json';a.href=url;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    toast('JSON exported','success');

  }else if(fmt==='jizz'){
    // ── .JIZZ = full board JSON + all media embedded as base64 ──
    toast('Building .jizz… (this may take a moment for large files)');
    try{
      const data=serialize();
      const embedJobs=[];
      // For each media node, read the blob from blobReg (original file stored on add/load)
      // and embed as base64 data URL directly into the serialized node
      data.layers.forEach(layer=>layer.nodes.forEach(node=>{
        if(!['image','video','audio','pdfviewer'].includes(node.type))return;
        const blob=blobReg.get(node.id);
        if(blob){
          embedJobs.push(
            blobToDataURL(blob).then(dataUrl=>{
              node.mediaB64=dataUrl;  // e.g. "data:image/jpeg;base64,/9j/4AA..."
            })
          );
        }else{
          // Fallback: try fetching the object URL
          const url=urlReg.get(node.id);
          if(url){
            embedJobs.push(
              fetch(url)
                .then(r=>{if(!r.ok)throw new Error('fetch failed');return r.blob()})
                .then(b=>blobToDataURL(b))
                .then(dataUrl=>{node.mediaB64=dataUrl})
                .catch(()=>{/* skip if unreachable */})
            );
          }
        }
      }));
      await Promise.all(embedJobs);
      const embeddedCount=data.layers.flatMap(l=>l.nodes).filter(n=>n.mediaB64).length;
      const jizzPayload=JSON.stringify({format:'jizz',version:2,...data});
      const outBlob=new Blob([jizzPayload],{type:'application/octet-stream'});
      const outUrl=URL.createObjectURL(outBlob);
      const a=document.createElement('a');a.download='board.jizz';a.href=outUrl;a.click();
      setTimeout(()=>URL.revokeObjectURL(outUrl),5000);
      toast(`.jizz exported — ${embeddedCount} media file(s) embedded ✓`,'success');
    }catch(err){toast('Export failed: '+err.message,'error')}

  }else if(fmt==='html'){
    // ── STANDALONE HTML VIEWER ──
    // Warn about live-embed nodes that can't be reproduced in the viewer
    const liveNodes=layers.flatMap(l=>l.nodes).filter(n=>n.type==='url'||n.type==='pdfviewer');
    if(liveNodes.length>0){
      const kinds=[...new Set(liveNodes.map(n=>n.type==='url'?'website embeds':'PDF viewers'))].join(' and ');
      toast(`Note: ${liveNodes.length} ${kinds} will appear as placeholder boxes in the exported HTML — live embeds can't be included in a static file.`);
      // Short delay so the toast is readable before the download starts
      await new Promise(r=>setTimeout(r,1800));
    }
    // Builds a self-contained read-only HTML file embedding all media as base64.
    // The viewer supports pan/zoom and the full canvas render — no app needed.
    toast('Building standalone HTML…');
    try{
      const data=serialize();
      // Embed all media blobs as base64 into node data
      const embedJobs=[];
      data.layers.forEach(layer=>layer.nodes.forEach(node=>{
        if(!['image','video','audio','pdfviewer'].includes(node.type))return;
        const blob=blobReg.get(node.id);
        if(blob){
          embedJobs.push(blobToDataURL(blob).then(dataUrl=>{node.mediaB64=dataUrl;}));
        }else{
          const url=urlReg.get(node.id);
          if(url)embedJobs.push(fetch(url).then(r=>r.blob()).then(b=>blobToDataURL(b)).then(d=>{node.mediaB64=d;}).catch(()=>{}));
        }
      }));
      await Promise.all(embedJobs);
      const boardJSON=JSON.stringify({format:'jizz',version:2,...data});
      // Safely escape for embedding inside a JS string: escape backticks, backslashes, and ${
      const safeBoardJSON=boardJSON
        .replace(/\\/g,'\\\\')
        .replace(/`/g,'\\`')
        .replace(/\$\{/g,'\\${');
      const html=buildStandaloneHTML(safeBoardJSON);
      const outBlob=new Blob([html],{type:'text/html'});
      const outUrl=URL.createObjectURL(outBlob);
      const a=document.createElement('a');a.download='board.html';a.href=outUrl;a.click();
      setTimeout(()=>URL.revokeObjectURL(outUrl),5000);
      toast('Standalone HTML exported ✓','success');
    }catch(err){toast('HTML export failed: '+err.message,'error')}
  }
});

// ── STANDALONE HTML BUILDER ──
const VIEWER_JS_CODE='\'use strict\';\nconst BOARD=JSON.parse(document.getElementById(\'board-data\').textContent);\nconst cam={x:0,y:0,zoom:1};\nif(BOARD.camera){cam.x=BOARD.camera.x;cam.y=BOARD.camera.y;cam.zoom=BOARD.camera.zoom;}\nconst w2s=(wx,wy)=>({x:wx*cam.zoom+cam.x,y:wy*cam.zoom+cam.y});\nconst s2w=(sx,sy)=>({x:(sx-cam.x)/cam.zoom,y:(sy-cam.y)/cam.zoom});\nconst c=document.getElementById(\'c\');\nconst ctx=c.getContext(\'2d\',{alpha:false});\nif(!CanvasRenderingContext2D.prototype.roundRect){\n  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){\n    if(w<2*r)r=w/2;if(h<2*r)r=h/2;\n    this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);\n    this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath();return this;\n  };\n}\nconst mm=document.getElementById(\'mm\');\nconst mctx=mm.getContext(\'2d\');\nconst mediaReg=new Map();\nlet dirty=true;\nconst mark=()=>{dirty=true;};\nfunction resize(){c.width=c.parentElement.clientWidth;c.height=c.parentElement.clientHeight;mark();}\nwindow.addEventListener(\'resize\',resize);resize();\nconst layers=BOARD.layers||[];\nlayers.forEach(l=>(l.nodes||[]).forEach(n=>{\n  if(!n.mediaB64)return;\n  if(n.type===\'image\'||n.type===\'pdf\'){const img=new Image();img.onload=()=>{mediaReg.set(n.id,img);mark();};img.src=n.mediaB64;}\n  else if(n.type===\'video\'){const v=document.createElement(\'video\');v.loop=true;v.muted=true;v.onloadedmetadata=()=>{mediaReg.set(n.id,v);mark();};v.src=n.mediaB64;}\n  else if(n.type===\'audio\'){const a=new Audio();a.onloadedmetadata=()=>{mediaReg.set(n.id,a);mark();};a.src=n.mediaB64;}\n}));\nlet gCache=null,gKey=\'\';\nfunction buildGrid(){\n  const gs=50*cam.zoom,ox=((cam.x%gs)+gs)%gs,oy=((cam.y%gs)+gs)%gs;\n  const key=c.width+\'|\'+c.height+\'|\'+cam.zoom.toFixed(2)+\'|\'+ox.toFixed(1)+\'|\'+oy.toFixed(1);\n  if(key===gKey&&gCache)return gCache;\n  gKey=key;\n  const off=new OffscreenCanvas(c.width,c.height),g=off.getContext(\'2d\');\n  g.fillStyle=\'#0d0f14\';g.fillRect(0,0,c.width,c.height);\n  g.beginPath();g.strokeStyle=\'#1c1f2b\';g.lineWidth=1;\n  for(let x=ox;x<c.width+gs;x+=gs){g.moveTo(x,0);g.lineTo(x,c.height);}\n  for(let y=oy;y<c.height+gs;y+=gs){g.moveTo(0,y);g.lineTo(c.width,y);}\n  g.stroke();\n  const op=w2s(0,0);g.beginPath();g.arc(op.x,op.y,3.5,0,Math.PI*2);g.fillStyle=\'#e8c547\';g.fill();\n  gCache=off;return off;\n}\nfunction bezierPt(sx,sy,cpx,cpy,ex,ey,t){const it=1-t;return{x:it*it*sx+2*it*t*cpx+t*t*ex,y:it*it*sy+2*it*t*cpy+t*t*ey};}\nfunction edgeCP(sx,sy,ex,ey,curve){\n  if(!curve)return{cpx:(sx+ex)/2,cpy:(sy+ey)/2};\n  const dx=ex-sx,dy=ey-sy,len=Math.hypot(dx,dy)||1;\n  return{cpx:(sx+ex)/2-dy/len*curve,cpy:(sy+ey)/2+dx/len*curve};\n}\nfunction drawFrame(ctx,f){\n  const col=f.color||\'#5b8dee\';ctx.save();\n  ctx.fillStyle=col+\'18\';ctx.strokeStyle=col;ctx.lineWidth=1.5/cam.zoom;ctx.setLineDash([8/cam.zoom,4/cam.zoom]);\n  ctx.fillRect(f.x,f.y,f.w,f.h);ctx.strokeRect(f.x,f.y,f.w,f.h);ctx.setLineDash([]);\n  ctx.fillStyle=col+\'30\';ctx.fillRect(f.x,f.y,f.w,24/cam.zoom);\n  ctx.font=\'bold \'+Math.round(11/cam.zoom)+\'px IBM Plex Mono,monospace\';ctx.fillStyle=col;ctx.textBaseline=\'middle\';\n  ctx.fillText(f.title||\'Frame\',f.x+8/cam.zoom,f.y+12/cam.zoom);ctx.restore();\n}\nfunction drawEdge(ctx,edge,nodeMap){\n  const sn=nodeMap.get(edge.startId),en=nodeMap.get(edge.endId);if(!sn||!en)return;\n  const sx=sn.x+sn.w/2,sy=sn.y+sn.h/2,ex=en.x+en.w/2,ey=en.y+en.h/2;\n  const{cpx,cpy}=edgeCP(sx,sy,ex,ey,edge.curve||0);\n  ctx.save();ctx.strokeStyle=edge.color||\'#f07a3a\';ctx.lineWidth=2/cam.zoom;\n  if(edge.style===\'dashed\')ctx.setLineDash([8/cam.zoom,4/cam.zoom]);\n  else if(edge.style===\'dotted\')ctx.setLineDash([2/cam.zoom,5/cam.zoom]);\n  ctx.beginPath();ctx.moveTo(sx,sy);\n  if(edge.curve||0)ctx.quadraticCurveTo(cpx,cpy,ex,ey);else ctx.lineTo(ex,ey);\n  ctx.stroke();ctx.setLineDash([]);\n  const t=0.97,it=1-t,ang=Math.atan2(2*it*(cpy-sy)+2*t*(ey-cpy),2*it*(cpx-sx)+2*t*(ex-cpx)),sz=12/cam.zoom;\n  if(edge.arrowStyle&&edge.arrowStyle!==\'none\'){\n    const x1=ex-sz*Math.cos(ang-Math.PI/6),y1=ey-sz*Math.sin(ang-Math.PI/6);\n    const x2=ex-sz*Math.cos(ang+Math.PI/6),y2=ey-sz*Math.sin(ang+Math.PI/6);\n    ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(x1,y1);\n    if(edge.arrowStyle===\'filled\'){ctx.lineTo(x2,y2);ctx.closePath();ctx.fillStyle=edge.color||\'#f07a3a\';ctx.fill();}\n    else{ctx.moveTo(ex,ey);ctx.lineTo(x2,y2);}\n    ctx.stroke();\n  }\n  if(edge.label){\n    const mid=bezierPt(sx,sy,cpx,cpy,ex,ey,0.5);\n    ctx.font=Math.round(11/cam.zoom)+\'px IBM Plex Mono,monospace\';\n    const tw=ctx.measureText(edge.label).width,pad=5/cam.zoom,ph=14/cam.zoom;\n    ctx.fillStyle=\'rgba(13,15,20,.85)\';ctx.beginPath();ctx.roundRect(mid.x-tw/2-pad,mid.y-ph/2,tw+pad*2,ph,ph/2);ctx.fill();\n    ctx.strokeStyle=edge.color||\'#f07a3a\';ctx.lineWidth=0.8/cam.zoom;ctx.stroke();\n    ctx.fillStyle=edge.color||\'#f07a3a\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';ctx.fillText(edge.label,mid.x,mid.y);ctx.textAlign=\'start\';\n  }\n  ctx.restore();\n}\nfunction drawNode(ctx,n){\n  ctx.save();ctx.translate(n.x+n.w/2,n.y+n.h/2);ctx.rotate((n.rot||0)*Math.PI/180);ctx.globalAlpha=n.opacity||1;\n  const hw=n.w/2,hh=n.h/2;\n  if(n.type===\'text\'){\n    ctx.fillStyle=\'rgba(13,15,20,.78)\';ctx.fillRect(-hw-5,-hh-5,n.w+10,n.h+10);\n    ctx.fillStyle=n.color||\'#d8dce8\';const fsz=n.fontSize||13;\n    ctx.font=fsz+\'px \'+(n.fontFamily||\'IBM Plex Mono\')+\',monospace\';ctx.textBaseline=\'top\';\n    const lh=fsz*1.5,maxW=n.w-16,lines=[];\n    for(const hard of (n.content||\'\').split(\'\\n\')){\n      let cur=\'\';\n      for(const w of hard.split(\' \')){const t=cur?cur+\' \'+w:w;if(ctx.measureText(t).width<=maxW)cur=t;else{if(cur)lines.push(cur);cur=w;}}\n      lines.push(cur);\n    }\n    ctx.save();ctx.beginPath();ctx.rect(-hw,-hh,n.w,n.h);ctx.clip();\n    lines.forEach((l,i)=>ctx.fillText(l,-hw+8,-hh+8+i*lh));ctx.restore();\n  }else if(n.type===\'image\'||n.type===\'pdf\'){\n    const img=mediaReg.get(n.id);\n    if(img&&img.complete&&img.naturalWidth>0)ctx.drawImage(img,-hw,-hh,n.w,n.h);\n    else{ctx.fillStyle=\'#1a1d28\';ctx.fillRect(-hw,-hh,n.w,n.h);ctx.fillStyle=\'#555d72\';ctx.font=\'10px IBM Plex Mono\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';ctx.fillText(\'IMG\',0,0);ctx.textAlign=\'start\';}\n  }else if(n.type===\'video\'){\n    const v=mediaReg.get(n.id);\n    if(v&&v.readyState>=2){ctx.drawImage(v,-hw,-hh,n.w,n.h);if(!v.paused)dirty=true;}\n    else{ctx.fillStyle=\'#1a1d28\';ctx.fillRect(-hw,-hh,n.w,n.h);ctx.fillStyle=\'#555d72\';ctx.font=\'10px IBM Plex Mono\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';ctx.fillText(\'VIDEO\',0,0);ctx.textAlign=\'start\';}\n  }else if(n.type===\'audio\'){\n    ctx.fillStyle=\'#13161e\';ctx.fillRect(-hw,-hh,n.w,n.h);ctx.font=\'bold 12px IBM Plex Mono\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';\n    ctx.fillStyle=n.color||\'#e8c547\';ctx.fillText(\'AUDIO\',0,-8);\n    const a=mediaReg.get(n.id);ctx.font=\'9px IBM Plex Mono\';ctx.fillStyle=\'#8890a8\';\n    ctx.fillText(a&&!a.paused?\'PLAYING\':\'(click to play)\',0,8);ctx.textAlign=\'start\';\n  }else if(n.type===\'url\'){\n    ctx.fillStyle=\'#0e1520\';ctx.fillRect(-hw,-hh,n.w,n.h);ctx.font=\'bold 11px IBM Plex Mono\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';\n    ctx.fillStyle=\'#5b8dee\';ctx.fillText(\'WEB\',0,-12);ctx.font=\'9px IBM Plex Mono\';ctx.fillStyle=\'#8890a8\';\n    const u=(n.content||\'\').replace(/https?:\\/\\//,\'\');\n    ctx.fillText(u.length>30?u.slice(0,30)+\'\\u2026\':u,0,4);ctx.fillStyle=\'#363a4d\';ctx.fillText(\'(live embed)\',0,18);ctx.textAlign=\'start\';\n  }else if(n.type===\'pdfviewer\'){\n    ctx.fillStyle=\'#1a1020\';ctx.fillRect(-hw,-hh,n.w,n.h);ctx.font=\'bold 11px IBM Plex Mono\';ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';\n    ctx.fillStyle=\'#e05252\';ctx.fillText(\'PDF\',0,-14);ctx.font=\'9px IBM Plex Mono\';ctx.fillStyle=\'#d8dce8\';\n    ctx.fillText((n.content||\'\').slice(0,32)||\'PDF viewer\',0,2);ctx.textAlign=\'start\';\n  }\n  ctx.globalAlpha=n.opacity||1;ctx.strokeStyle=n.color||\'#e8c547\';ctx.lineWidth=1.5/cam.zoom;ctx.strokeRect(-hw,-hh,n.w,n.h);\n  if(n.label){ctx.globalAlpha=.85;ctx.font=\'9px IBM Plex Mono\';ctx.fillStyle=\'#fff\';ctx.textBaseline=\'bottom\';ctx.fillText(n.label,-hw+3,-hh-2);}\n  ctx.restore();\n}\nconst waypoints=BOARD.waypoints||[];\nfunction drawWaypointPins(){\n  waypoints.forEach((wp,i)=>{\n    const wx=wp.worldX!==undefined?wp.worldX:(c.width/2-wp.camX)/wp.camZoom;\n    const wy=wp.worldY!==undefined?wp.worldY:(c.height/2-wp.camY)/wp.camZoom;\n    const sp=w2s(wx,wy),r=11;\n    ctx.save();ctx.shadowColor=\'rgba(0,0,0,.5)\';ctx.shadowBlur=6;\n    ctx.beginPath();ctx.arc(sp.x,sp.y,r,0,Math.PI*2);ctx.fillStyle=\'#e8c547\';ctx.fill();\n    ctx.shadowBlur=0;ctx.fillStyle=\'#000\';ctx.font=\'bold \'+r+\'px IBM Plex Mono,monospace\';\n    ctx.textAlign=\'center\';ctx.textBaseline=\'middle\';ctx.fillText(i+1,sp.x,sp.y+0.5);\n    if(wp.title){\n      ctx.font=\'9px IBM Plex Mono\';ctx.fillStyle=\'#e8c547\';ctx.textAlign=\'center\';ctx.textBaseline=\'top\';\n      ctx.shadowColor=\'rgba(0,0,0,.8)\';ctx.shadowBlur=4;\n      ctx.fillText(wp.title.length>20?wp.title.slice(0,20)+\'\\u2026\':wp.title,sp.x,sp.y+r+4);\n      ctx.shadowBlur=0;\n    }\n    ctx.restore();\n  });\n}\nfunction render(){\n  if(!dirty)return;dirty=false;\n  ctx.drawImage(buildGrid(),0,0);\n  ctx.save();ctx.translate(cam.x,cam.y);ctx.scale(cam.zoom,cam.zoom);\n  layers.forEach(layer=>{\n    if(!layer.visible)return;\n    const nodeMap=new Map((layer.nodes||[]).map(n=>[n.id,n]));\n    (layer.frames||[]).forEach(f=>drawFrame(ctx,f));\n    (layer.edges||[]).forEach(e=>drawEdge(ctx,e,nodeMap));\n    (layer.nodes||[]).forEach(n=>drawNode(ctx,n));\n  });\n  ctx.restore();\n  if(waypoints.length)drawWaypointPins();\n  const mW=140,mH=96;\n  mctx.fillStyle=\'#0d0f14\';mctx.fillRect(0,0,mW,mH);\n  const allN=layers.flatMap(l=>l.nodes||[]);\n  if(allN.length){\n    let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;\n    allN.forEach(n=>{mnX=Math.min(mnX,n.x);mnY=Math.min(mnY,n.y);mxX=Math.max(mxX,n.x+n.w);mxY=Math.max(mxY,n.y+n.h);});\n    mnX-=40;mnY-=40;mxX+=40;mxY+=40;\n    const sc=Math.min(mW/(mxX-mnX),mH/(mxY-mnY)),ox=(mW-(mxX-mnX)*sc)/2,oy=(mH-(mxY-mnY)*sc)/2;\n    const toMM=(wx,wy)=>({x:(wx-mnX)*sc+ox,y:(wy-mnY)*sc+oy});\n    allN.forEach(n=>{const p=toMM(n.x,n.y);mctx.fillStyle=(n.color||\'#e8c547\')+\'88\';mctx.fillRect(p.x,p.y,n.w*sc,n.h*sc);});\n    const tl=s2w(0,0),br=s2w(c.width,c.height),vtl=toMM(tl.x,tl.y),vbr=toMM(br.x,br.y);\n    mctx.strokeStyle=\'rgba(232,197,71,.7)\';mctx.lineWidth=1;mctx.strokeRect(vtl.x,vtl.y,vbr.x-vtl.x,vbr.y-vtl.y);\n  }\n  mctx.strokeStyle=\'#252836\';mctx.lineWidth=1;mctx.strokeRect(0,0,mW,mH);\n  document.getElementById(\'sz\').textContent=Math.round(cam.zoom*100)+\'%\';\n}\nfunction fitAll(){\n  const allN=layers.flatMap(l=>l.nodes||[]);\n  if(!allN.length){cam.x=0;cam.y=0;cam.zoom=1;mark();return;}\n  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;\n  allN.forEach(n=>{mnX=Math.min(mnX,n.x);mnY=Math.min(mnY,n.y);mxX=Math.max(mxX,n.x+n.w);mxY=Math.max(mxY,n.y+n.h);});\n  const pad=80,bw=mxX-mnX+pad*2,bh=mxY-mnY+pad*2;\n  cam.zoom=Math.max(0.05,Math.min(4,Math.min(c.width/bw,c.height/bh)));\n  cam.x=c.width/2-(mnX-pad+bw/2)*cam.zoom;cam.y=c.height/2-(mnY-pad+bh/2)*cam.zoom;\n  gCache=null;mark();\n}\ndocument.getElementById(\'hdr-fit\').addEventListener(\'click\',fitAll);\nlet mDown=false,spaceDown=false,lastX=0,lastY=0;\ndocument.addEventListener(\'keydown\',e=>{if(e.code===\'Space\'&&document.activeElement===document.body){e.preventDefault();spaceDown=true;c.style.cursor=\'grab\';}});\ndocument.addEventListener(\'keyup\',e=>{if(e.code===\'Space\'){spaceDown=false;c.style.cursor=\'default\';}});\nc.addEventListener(\'mousedown\',e=>{if(e.button===0||e.button===1){mDown=true;lastX=e.clientX;lastY=e.clientY;if(e.button===0&&spaceDown)c.style.cursor=\'grabbing\';}});\ndocument.addEventListener(\'mousemove\',e=>{\n  if(mDown&&(e.button===1||(e.buttons===1&&spaceDown))){cam.x+=e.clientX-lastX;cam.y+=e.clientY-lastY;gCache=null;mark();}\n  lastX=e.clientX;lastY=e.clientY;\n});\ndocument.addEventListener(\'mouseup\',()=>{mDown=false;c.style.cursor=spaceDown?\'grab\':\'default\';});\nc.addEventListener(\'wheel\',e=>{\n  e.preventDefault();\n  const r=c.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;\n  const bx=(sx-cam.x)/cam.zoom,by=(sy-cam.y)/cam.zoom;\n  cam.zoom=Math.max(0.05,Math.min(10,cam.zoom*(e.deltaY<0?1.12:1/1.12)));\n  cam.x=sx-bx*cam.zoom;cam.y=sy-by*cam.zoom;gCache=null;mark();\n},{passive:false});\nlet lastTouch=null;\nc.addEventListener(\'touchstart\',e=>{if(e.touches.length===1)lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});\nc.addEventListener(\'touchmove\',e=>{\n  if(e.touches.length===1&&lastTouch){cam.x+=e.touches[0].clientX-lastTouch.x;cam.y+=e.touches[0].clientY-lastTouch.y;lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};gCache=null;mark();}\n},{passive:true});\nfunction loop(){render();requestAnimationFrame(loop);}\nloop();fitAll();';

function buildStandaloneHTML(boardJSON){
  // The viewer JS is stored as a module-level constant (VIEWER_JS_CODE) 
  // so no template literals or escaping issues exist here.
  const safeJSON=boardJSON.replace(/<\/script/gi,'<\\/script');
  return '<!DOCTYPE html>\n'
    +'<html lang="en">\n<head>\n<meta charset="UTF-8">\n'
    +'<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    +'<title>INVESTIG8R \u2014 Shared Board</title>\n<style>\n'
    +'*{box-sizing:border-box;margin:0;padding:0}\n'
    +'html,body{width:100%;height:100%;overflow:hidden;background:#0d0f14;display:flex;flex-direction:column;font-family:\'IBM Plex Mono\',monospace}\n'
    +'#hdr{height:40px;background:#13161e;border-bottom:1px solid #252836;display:flex;align-items:center;padding:0 14px;gap:12px;flex-shrink:0;user-select:none}\n'
    +'#hdr-title{font-size:12px;font-weight:700;color:#e8c547;letter-spacing:.05em}\n'
    +'#hdr-hint{font-size:10px;color:#555d72;margin-left:auto}\n'
    +'#hdr-fit{padding:3px 10px;background:#1a1d28;border:1px solid #363a4d;border-radius:4px;color:#8890a8;font-family:\'IBM Plex Mono\',monospace;font-size:10px;cursor:pointer}\n'
    +'#hdr-fit:hover{border-color:#e8c547;color:#e8c547}\n'
    +'#wrap{flex:1;position:relative;overflow:hidden}\n'
    +'canvas{display:block;position:absolute;top:0;left:0;cursor:default}\n'
    +'#mm{position:absolute;bottom:12px;left:12px;border:1px solid #363a4d;border-radius:5px;background:#13161e}\n'
    +'#st{position:absolute;bottom:0;left:0;right:0;height:24px;background:#13161e;border-top:1px solid #252836;'
    +'display:flex;align-items:center;padding:0 10px;gap:16px;font-size:9px;color:#555d72}\n'
    +'#st span{color:#8890a8}\n'
    +'</style>\n</head>\n<body>\n'
    +'<div id="hdr">\n'
    +'  <span id="hdr-title">INVESTIG8R</span>\n'
    +'  <span style="font-size:10px;color:#363a4d">READ-ONLY SHARED BOARD</span>\n'
    +'  <button id="hdr-fit">&#x229E; Fit All</button>\n'
    +'  <span id="hdr-hint">Scroll to zoom &amp;middot; Space+drag to pan</span>\n'
    +'</div>\n'
    +'<div id="wrap">\n'
    +'  <canvas id="c"></canvas>\n'
    +'  <canvas id="mm" width="140" height="96"></canvas>\n'
    +'</div>\n'
    +'<div id="st">ZOOM <span id="sz">100%</span> &amp;nbsp; X <span id="sx">0</span> &amp;nbsp; Y <span id="sy">0</span></div>\n'
    +'<script type="application/json" id="board-data">'+safeJSON+'<\/script>\n'
    +'<script>\n'+VIEWER_JS_CODE+'\n<\/script>\n'
    +'</body>\n</html>';
}

// ── OPEN .JIZZ FILE ──
async function openJizzFile(file){
  toast('Opening .jizz file…');
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    if(data.format!=='jizz'){toast('Not a valid .jizz file','error');return}
    // Clear existing state
    urlReg.forEach(u=>URL.revokeObjectURL(u));
    urlReg.clear();mediaReg.clear();blobReg.clear();
    // Restore camera & layers
    Object.assign(cam,Camera.load(data.camera));
    curLayerIdx=data.curLayerIdx||0;
    nid=data.nid||nid;eid=data.eid||eid;
    layers=data.layers.map(l=>({...l,nodes:l.nodes.map(n=>({...n})),edges:l.edges.map(e=>({...e})),frames:(l.frames||[]).map(f=>({...f}))}));
    waypoints=(data.waypoints||[]).map(w=>({...w}));
    fid=data.fid||fid;wpid=data.wpid||wpid;
    sel.nodes.clear();sel.edgeId=null;sel.frameId=null;gridCache=null;gridCacheKey='';
    // Restore embedded media
    const restoreJobs=[];
    data.layers.forEach((srcLayer,li)=>{
      srcLayer.nodes.forEach(srcNode=>{
        if(!['image','video','audio','pdfviewer'].includes(srcNode.type)||!srcNode.mediaB64)return;
        const id=srcNode.id;
        restoreJobs.push(new Promise(res=>{
          // Convert base64 data URL back to Blob → object URL
          fetch(srcNode.mediaB64)
            .then(r=>r.blob())
            .then(blob=>{
              blobReg.set(id,blob);
              const url=URL.createObjectURL(blob);
              urlReg.set(id,url);
              const type=srcNode.type;
              if(type==='pdfviewer'){
                // Re-init the PDF doc from the blob
                if(typeof pdfjsLib!=='undefined'){
                  blob.arrayBuffer().then(buf=>pdfjsLib.getDocument({data:buf}).promise).then(doc=>{
                    mediaReg.set(id,doc);res();
                  }).catch(()=>res());
                }else res();
              } else if(type==='image'){
                const img=new Image();
                img.onload=()=>{mediaReg.set(id,img);mark();res()};
                img.onerror=()=>res();
                img.src=url;
              }else if(type==='video'){
                const vid=document.createElement('video');
                vid.muted=false;vid.loop=true;
                vid.onloadedmetadata=()=>{mediaReg.set(id,vid);mark();res()};
                vid.onerror=()=>res();
                vid.src=url;
              }else{
                const aud=new Audio();
                aud.onloadedmetadata=()=>{mediaReg.set(id,aud);mark();res()};
                aud.onerror=()=>res();
                aud.src=url;
              }
            })
            .catch(()=>res());
        }));
      });
    });
    await Promise.all(restoreJobs);
    rebuildIndex();renderLayersUI();hideProps();mark();markMM();renderWaypointPins();
    const mediaCount=restoreJobs.length;
    toast(`.jizz loaded — ${mediaCount} media file(s) restored ✓`,'success');
  }catch(err){toast('Failed to open .jizz: '+err.message,'error')}
}
document.getElementById('openJizzInput').addEventListener('change',e=>{
  const f=e.target.files[0];if(f)openJizzFile(f);e.target.value='';
});

