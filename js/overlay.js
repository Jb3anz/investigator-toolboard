// =====================================================
// RENDER LOOP
// =====================================================
let _lastCamState='',_lastWpCount=0;
function loop(){
  render();
  // Always reposition overlays every frame — ensures smooth movement during drag
  // (Previously only ran on camera/sel state change, causing iframe to lag behind cursor)
  updateIframePositions();
  // Still track state for mark/minimap dirty flagging
  const camState=cam.x.toFixed(1)+','+cam.y.toFixed(1)+','+cam.zoom.toFixed(4);
  const wpCount=waypoints.length;
  if(camState!==_lastCamState){mark();markMM();_lastCamState=camState;}
  if(wpCount!==_lastWpCount){_lastWpCount=wpCount;}
  requestAnimationFrame(loop);
}

// ── IFRAME DOM OVERLAY MANAGEMENT ──
const iframeEls=new Map(); // nodeId → {wrap, iframe, overlay}

// Single shared CSP violation handler — checks all active iframes, no leak
window.addEventListener('securitypolicyviolation',evt=>{
  if(!evt.blockedURI)return;
  iframeEls.forEach(els=>{
    if(els.iframe&&els.iframe._blockedSrc&&els.iframe._blockedSrc.startsWith(evt.blockedURI.slice(0,30))){
      els.blockedCard.style.display='flex';
      els.iframe.style.opacity='0';
    }
  });
});

// Cached canvas offset — recomputed only when needed (declared at top level)
function getCanvasOff(){
  // canvas is position:absolute;top:0;left:0 inside workspace — offset is always 0,0
  // No getBoundingClientRect needed, avoids forced layout reflow
  _canvasOffX=0; _canvasOffY=0;
}

// Convert world node rect → workspace-local screen rect
function nodeToScreen(n){
  getCanvasOff();
  return{
    x: n.x*cam.zoom+cam.x+_canvasOffX,
    y: n.y*cam.zoom+cam.y+_canvasOffY,
    w: n.w*cam.zoom,
    h: n.h*cam.zoom
  };
}

// Check if a screen rect is visible enough to show (clamp + cull)
function overlayVisible(r,cw,ch){
  if(r.w < 8 || r.h < 8) return false; // too small to see or interact
  if(r.x+r.w < -50 || r.y+r.h < -50) return false; // off left/top
  if(r.x > cw+50 || r.y > ch+50) return false; // off right/bottom
  return true;
}

let _lastOverlayNodeCount=-1;
let _cachedAllNodeIds=new Set();

function updateIframePositions(){
  const layer=curLayer();
  const cw=canvas.width,ch=canvas.height;

  // Rebuild the global node set only when node count changes (avoids per-frame flatMap allocation)
  const totalNodes=layers.reduce((a,l)=>a+l.nodes.length,0);
  if(totalNodes!==_lastOverlayNodeCount){
    _lastOverlayNodeCount=totalNodes;
    _cachedAllNodeIds=new Set(layers.flatMap(l=>l.nodes).map(n=>n.id));
  }

  // Remove overlays for nodes no longer in ANY layer
  iframeEls.forEach((els,id)=>{
    if(!_cachedAllNodeIds.has(id)){els.wrap.remove();iframeEls.delete(id);}
  });
  pdfViewerEls.forEach((state,id)=>{
    if(!_cachedAllNodeIds.has(id)){state.wrap.remove();pdfViewerEls.delete(id);}
  });

  // Create/update overlays
  layer.nodes.forEach(n=>{
    if(n.type==='pdfviewer'){updatePdfViewerOverlay(n,cw,ch);return;}
    if(n.type!=='url')return;

    const r=nodeToScreen(n);
    let els=iframeEls.get(n.id);

    if(!els){
      // Build iframe overlay once
      const ws=document.getElementById('workspace');
      const wrap=document.createElement('div');
      const nW=Math.max(4,n.w),nH=Math.max(4,n.h);
      wrap.style.cssText=`position:absolute;left:0;top:0;width:${nW}px;height:${nH}px;border:2px solid #363a4d;border-radius:3px;background:#0e1520;overflow:hidden;transform-origin:top left;will-change:transform;`;
      const iframe=document.createElement('iframe');
      const iframeSrc=n.iframeCurrentUrl||n.content;
      iframe.src=iframeSrc;
      iframe.sandbox='allow-scripts allow-same-origin allow-forms allow-popups';
      iframe.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:none;display:block;';

      // Fallback card for sites that block framing (GitHub, Twitter, etc.)
      const blockedCard=document.createElement('div');
      blockedCard.style.cssText='position:absolute;inset:0;z-index:3;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#0e1520;padding:16px;text-align:center;';
      const blockedIcon=document.createElement('div');
      blockedIcon.textContent='🔒';blockedIcon.style.fontSize='28px';
      const blockedMsg=document.createElement('div');
      blockedMsg.style.cssText='font-family:IBM Plex Mono,monospace;font-size:11px;color:#8890a8;line-height:1.5;';
      blockedMsg.textContent='This site blocks embedding.\nOpen it in a new tab instead.';
      blockedMsg.style.whiteSpace='pre-line';
      const blockedUrl=document.createElement('div');
      blockedUrl.style.cssText='font-family:IBM Plex Mono,monospace;font-size:9px;color:#555d72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90%;';
      blockedUrl.textContent=iframeSrc;
      const openBtn=document.createElement('a');
      openBtn.href=iframeSrc;openBtn.target='_blank';openBtn.rel='noopener noreferrer';
      openBtn.textContent='Open in new tab ↗';
      openBtn.style.cssText='display:inline-block;margin-top:4px;padding:5px 12px;background:#1a1d28;border:1px solid #363a4d;border-radius:4px;color:#e8c547;font-family:IBM Plex Mono,monospace;font-size:10px;text-decoration:none;cursor:pointer;transition:border-color .12s;';
      openBtn.addEventListener('mouseenter',()=>openBtn.style.borderColor='#e8c547');
      openBtn.addEventListener('mouseleave',()=>openBtn.style.borderColor='#363a4d');
      blockedCard.appendChild(blockedIcon);blockedCard.appendChild(blockedMsg);blockedCard.appendChild(blockedUrl);blockedCard.appendChild(openBtn);

      // Detect framing block via load event (no network error = page loaded but may be blank due to CSP)
      iframe.addEventListener('load',()=>{
        // Try to detect blocked frames: if contentDocument is null or has no body, show fallback
        try{
          const doc=iframe.contentDocument||iframe.contentWindow.document;
          // If we can access it, it loaded fine — hide fallback
          if(doc&&doc.body){blockedCard.style.display='none';iframe.style.opacity='1';}
        }catch(e){
          // Cross-origin — we can't read it, but it probably loaded OK; don't show fallback
          blockedCard.style.display='none';iframe.style.opacity='1';
        }
      });
      iframe.addEventListener('error',()=>{
        blockedCard.style.display='flex';iframe.style.opacity='0';
      });
      // CSP violations: stored on the iframe element itself so the shared handler can find it
      iframe._blockedSrc=iframeSrc;

      const overlay=document.createElement('div');
      overlay.style.cssText='position:absolute;inset:0;z-index:4;cursor:move;';
      overlay.title='Double-click to interact, single-click to move';

      function fwdDown(evt){
        evt.stopPropagation();
        canvas.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,
          clientX:evt.clientX,clientY:evt.clientY,button:evt.button,shiftKey:evt.shiftKey}));
      }
      function fwdMove(evt){
        if(evt.buttons) canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,
          clientX:evt.clientX,clientY:evt.clientY,buttons:evt.buttons}));
      }
      function fwdUp(evt){
        canvas.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,
          clientX:evt.clientX,clientY:evt.clientY,button:evt.button}));
      }
      overlay.addEventListener('mousedown',fwdDown);
      overlay.addEventListener('mousemove',fwdMove);
      overlay.addEventListener('mouseup',fwdUp);
      overlay.addEventListener('dblclick',evt=>{
        evt.stopPropagation();
        overlay.style.pointerEvents='none';
        const revert=()=>{overlay.style.pointerEvents='';document.removeEventListener('mousedown',revert);};
        setTimeout(()=>document.addEventListener('mousedown',revert),200);
      });
      const reloadBtn=document.createElement('button');
      reloadBtn.textContent='↻';reloadBtn.title='Reload';
      reloadBtn.style.cssText='position:absolute;top:3px;right:3px;z-index:5;background:rgba(13,15,20,.85);border:1px solid #363a4d;border-radius:3px;color:#8890a8;font-size:11px;cursor:pointer;padding:1px 5px;line-height:1.4;';
      reloadBtn.addEventListener('click',evt=>{evt.stopPropagation();iframe.src=iframe.src;});
      wrap.appendChild(iframe);wrap.appendChild(blockedCard);wrap.appendChild(overlay);wrap.appendChild(reloadBtn);
      ws.appendChild(wrap);
      els={wrap,iframe,overlay,blockedCard,_nativeW:nW,_nativeH:nH,_lastTfm:'',_lastBc:'',_lastOp:1};
      iframeEls.set(n.id,els);
    }

    // Cull / hide when off-screen or too tiny
    const vis=overlayVisible(r,cw,ch);
    if(!vis){if(els.wrap.style.display!=='none')els.wrap.style.display='none';return;}
    if(els.wrap.style.display==='none')els.wrap.style.display='';

    // Use transform-only positioning — no width/height changes = no layout reflow
    // The iframe itself is sized to the node's world dimensions once at creation;
    // we scale it with CSS transform to match the current zoom
    const scaleX=r.w/els._nativeW, scaleY=r.h/els._nativeH;
    const tx=r.x, ty=r.y;
    const tfm=`translate(${tx}px,${ty}px) scale(${scaleX},${scaleY})`;
    if(els._lastTfm!==tfm){els.wrap.style.transform=tfm;els._lastTfm=tfm;}
    const bc=sel.nodes.has(n.id)?'#e8c547':'#363a4d';
    if(els._lastBc!==bc){els.wrap.style.borderColor=bc;els._lastBc=bc;}
    if(els._lastOp!==n.opacity){els.wrap.style.opacity=n.opacity;els._lastOp=n.opacity;}
  });
}

function removeIframe(nodeId){
  const els=iframeEls.get(nodeId);
  if(els){els.wrap.remove();iframeEls.delete(nodeId);}
}

// ── PDF VIEWER DOM OVERLAY ──
const pdfViewerEls=new Map(); // nodeId → {wrap, canvas, pageInfo, pdfDoc}

async function renderPdfViewerPage(nodeId){
  const state=pdfViewerEls.get(nodeId);if(!state)return;
  if(state._rendering)return; // prevent concurrent renders
  state._rendering=true;
  try{
    const node=layers.flatMap(l=>l.nodes).find(n=>n.id===nodeId);if(!node){state._rendering=false;return;}
    let pdfDoc=state.pdfDoc;
    if(!pdfDoc){
      const blob=blobReg.get(nodeId);
      if(!blob){state._rendering=false;return;}
      const buf=await blob.arrayBuffer();
      pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
      state.pdfDoc=pdfDoc;mediaReg.set(nodeId,pdfDoc);
    }
    const pg=Math.max(1,Math.min(node.pdfCurPage||1,pdfDoc.numPages));
    node.pdfCurPage=pg;node.pdfTotalPages=pdfDoc.numPages;
    const page=await pdfDoc.getPage(pg);
    // Render at node's world width (capped for perf) — CSS scale handles zoom
    const renderW=Math.max(300,Math.min(900,node.w));
    const nativeW=page.getViewport({scale:1}).width;
    const scale=renderW/nativeW;
    const vp=page.getViewport({scale});
    const c=state.canvas;
    c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    state.pageInfo.textContent=`${pg} / ${pdfDoc.numPages}`;
    mark();
  }finally{state._rendering=false;}
}

function updatePdfViewerOverlay(n,cw,ch){
  const r=nodeToScreen(n);
  const _cw=cw||canvas.width, _ch=ch||canvas.height;
  const vis=overlayVisible(r,_cw,_ch);
  let state=pdfViewerEls.get(n.id);
  if(!state){
    // Build the viewer widget
    const ws=document.getElementById('workspace');
    const wrap=document.createElement('div');
    const pdNW=Math.max(60,n.w), pdNH=Math.max(60,n.h);
    wrap.className='pdf-viewer-wrap';
    // Fixed native size — we'll CSS-scale it, never resize it via JS
    wrap.style.cssText=`position:absolute;left:0;top:0;width:${pdNW}px;height:${pdNH}px;z-index:10;will-change:transform;overflow:hidden;display:flex;flex-direction:column;transform-origin:top left;`;

    // Toolbar
    const tb=document.createElement('div');
    tb.className='pdf-viewer-toolbar';
    const prevBtn=document.createElement('button');prevBtn.textContent='◀';
    const nextBtn=document.createElement('button');nextBtn.textContent='▶';
    const pageInfo=document.createElement('span');pageInfo.className='pg-info';
    pageInfo.textContent='1 / ?';
    const nameSpan=document.createElement('span');
    nameSpan.style.cssText='font-family:var(--font-mono);font-size:9px;color:var(--text3);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameSpan.textContent=n.content||'PDF';
    tb.appendChild(prevBtn);tb.appendChild(pageInfo);tb.appendChild(nextBtn);
    tb.appendChild(nameSpan);

    // Canvas area
    const canvasWrap=document.createElement('div');
    canvasWrap.className='pdf-viewer-canvas-wrap';
    const pdfCanvas=document.createElement('canvas');
    pdfCanvas.style.cssText='display:block;width:100%;';
    canvasWrap.appendChild(pdfCanvas);

    wrap.appendChild(tb);wrap.appendChild(canvasWrap);
    ws.appendChild(wrap);

    state={wrap,canvas:pdfCanvas,pageInfo,pdfDoc:mediaReg.get(n.id)||null,
      _nativeW:pdNW,_nativeH:pdNH,_lastTfm:'',_lastBc:'',_lastOp:1};
    pdfViewerEls.set(n.id,state);

    // Forward drag from canvas area to the canvas element (so node moves)
    canvasWrap.addEventListener('mousedown',evt=>{
      evt.stopPropagation();
      const ce=new MouseEvent('mousedown',{bubbles:true,cancelable:true,
        clientX:evt.clientX,clientY:evt.clientY,button:evt.button,shiftKey:evt.shiftKey});
      canvas.dispatchEvent(ce);
    });
    canvasWrap.addEventListener('mousemove',evt=>{
      if(evt.buttons){
        const mv=new MouseEvent('mousemove',{bubbles:true,cancelable:true,
          clientX:evt.clientX,clientY:evt.clientY,buttons:evt.buttons});
        canvas.dispatchEvent(mv);
      }
    });
    canvasWrap.addEventListener('mouseup',evt=>{
      const up=new MouseEvent('mouseup',{bubbles:true,cancelable:true,
        clientX:evt.clientX,clientY:evt.clientY,button:evt.button});
      canvas.dispatchEvent(up);
    });

    // Prev/Next — stopPropagation + preventDefault so nothing leaks
    prevBtn.addEventListener('click',async e=>{
      e.stopPropagation();e.preventDefault();
      const node=layers.flatMap(l=>l.nodes).find(nd=>nd.id===n.id);
      if(node&&node.pdfCurPage>1){node.pdfCurPage--;await renderPdfViewerPage(n.id);}
    });
    nextBtn.addEventListener('click',async e=>{
      e.stopPropagation();e.preventDefault();
      const node=layers.flatMap(l=>l.nodes).find(nd=>nd.id===n.id);
      if(node&&node.pdfCurPage<(state.pdfDoc&&state.pdfDoc.numPages||node.pdfTotalPages||1)){node.pdfCurPage++;await renderPdfViewerPage(n.id);}
    });

    // Initial render
    renderPdfViewerPage(n.id);
  }

  // Apply position and visibility — no layout-triggering property changes
  if(!vis){
    if(state.wrap.style.display!=='none')state.wrap.style.display='none';
    return;
  }
  if(state.wrap.style.display==='none'||state.wrap.style.display==='')state.wrap.style.display='flex';

  // Scale the fixed-size wrap to match zoom
  const scaleX=r.w/(state._nativeW||n.w), scaleY=r.h/(state._nativeH||n.h);
  const tx=r.x, ty=r.y;
  const tfm=`translate(${tx}px,${ty}px) scale(${scaleX},${scaleY})`;
  if(state._lastTfm!==tfm){state.wrap.style.transform=tfm;state._lastTfm=tfm;}
  const bc=sel.nodes.has(n.id)?'#e8c547':'#363a4d';
  if(state._lastBc!==bc){state.wrap.style.borderColor=bc;state._lastBc=bc;}
  if(state._lastOp!==n.opacity){state.wrap.style.opacity=n.opacity;state._lastOp=n.opacity;}
}

function removePdfViewer(nodeId){
  const state=pdfViewerEls.get(nodeId);
  if(state){state.wrap.remove();pdfViewerEls.delete(nodeId);}
}

// =====================================================
// TEMPLATE SYSTEM
// =====================================================
const TPL_STORE_KEY='inv4_templates';

// Built-in starter templates (no media — text/layout only)
const BUILTIN_TEMPLATES=[
  {
    id:'builtin_blank',builtin:true,
    name:'Blank Canvas',
    desc:'Empty board. A clean slate.',
    created:0,
    data:{v:4,camera:{x:0,y:0,zoom:1},curLayerIdx:0,nid:1,eid:1,fid:1,wpid:1,waypoints:[],
      layers:[{id:0,name:'Layer 1',visible:true,nodes:[],edges:[],frames:[]}]}
  },
  {
    id:'builtin_investigation',builtin:true,
    name:'Investigation Board',
    desc:'Central suspect node with connected evidence, location, and timeline nodes.',
    created:0,
    data:{v:4,camera:{x:0,y:0,zoom:1},curLayerIdx:0,nid:10,eid:6,fid:1,wpid:1,waypoints:[],
      layers:[{id:0,name:'Evidence',visible:true,frames:[],
        nodes:[
          {id:'n1',type:'text',x:-80,y:-30,w:160,h:50,content:'SUSPECT',color:'#e05252',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:16},
          {id:'n2',type:'text',x:-280,y:-160,w:140,h:45,content:'Evidence A',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:13},
          {id:'n3',type:'text',x:140,y:-160,w:140,h:45,content:'Evidence B',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:13},
          {id:'n4',type:'text',x:-280,y:100,w:140,h:45,content:'Location',color:'#5b8dee',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:13},
          {id:'n5',type:'text',x:140,y:100,w:140,h:45,content:'Timeline',color:'#4caf7d',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:13},
        ],
        edges:[
          {id:'e1',startId:'n2',endId:'n1',color:'#e8c547',style:'solid',arrowStyle:'filled',curve:0,label:'links to'},
          {id:'e2',startId:'n3',endId:'n1',color:'#e8c547',style:'solid',arrowStyle:'filled',curve:0,label:''},
          {id:'e3',startId:'n4',endId:'n1',color:'#5b8dee',style:'dashed',arrowStyle:'open',curve:0,label:''},
          {id:'e4',startId:'n5',endId:'n1',color:'#4caf7d',style:'dashed',arrowStyle:'open',curve:0,label:''},
          {id:'e5',startId:'n2',endId:'n4',color:'#f07a3a',style:'dotted',arrowStyle:'none',curve:40,label:''},
          {id:'e6',startId:'n3',endId:'n5',color:'#f07a3a',style:'dotted',arrowStyle:'none',curve:-40,label:''},
        ]
      }]
    }
  },
  {
    id:'builtin_mindmap',builtin:true,
    name:'Mind Map',
    desc:'Central idea node radiating out to 6 branch topics.',
    created:0,
    data:{v:4,camera:{x:0,y:0,zoom:1},curLayerIdx:0,nid:8,eid:6,fid:1,wpid:1,waypoints:[],
      layers:[{id:0,name:'Mind Map',visible:true,frames:[],
        nodes:[
          {id:'n1',type:'text',x:-70,y:-25,w:140,h:50,content:'MAIN IDEA',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:15},
          {id:'n2',type:'text',x:-360,y:-120,w:120,h:40,content:'Branch 1',color:'#5b8dee',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Sans',fontSize:13},
          {id:'n3',type:'text',x:240,y:-120,w:120,h:40,content:'Branch 2',color:'#5b8dee',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Sans',fontSize:13},
          {id:'n4',type:'text',x:-360,y:0,w:120,h:40,content:'Branch 3',color:'#f07a3a',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Sans',fontSize:13},
          {id:'n5',type:'text',x:240,y:0,w:120,h:40,content:'Branch 4',color:'#f07a3a',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Sans',fontSize:13},
          {id:'n6',type:'text',x:-360,y:120,w:120,h:40,content:'Branch 5',color:'#4caf7d',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Sans',fontSize:13},
          {id:'n7',type:'text',x:240,y:120,w:120,h:40,content:'Branch 6',color:'#4caf7d',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Sans',fontSize:13},
        ],
        edges:[
          {id:'e1',startId:'n1',endId:'n2',color:'#5b8dee',style:'solid',arrowStyle:'none',curve:0,label:''},
          {id:'e2',startId:'n1',endId:'n3',color:'#5b8dee',style:'solid',arrowStyle:'none',curve:0,label:''},
          {id:'e3',startId:'n1',endId:'n4',color:'#f07a3a',style:'solid',arrowStyle:'none',curve:0,label:''},
          {id:'e4',startId:'n1',endId:'n5',color:'#f07a3a',style:'solid',arrowStyle:'none',curve:0,label:''},
          {id:'e5',startId:'n1',endId:'n6',color:'#4caf7d',style:'solid',arrowStyle:'none',curve:0,label:''},
          {id:'e6',startId:'n1',endId:'n7',color:'#4caf7d',style:'solid',arrowStyle:'none',curve:0,label:''},
        ]
      }]
    }
  },
  {
    id:'builtin_timeline',builtin:true,
    name:'Timeline',
    desc:'Five horizontal event nodes connected in sequence.',
    created:0,
    data:{v:4,camera:{x:0,y:0,zoom:1},curLayerIdx:0,nid:6,eid:4,fid:1,wpid:1,waypoints:[],
      layers:[{id:0,name:'Timeline',visible:true,frames:[],
        nodes:[
          {id:'n1',type:'text',x:-580,y:-25,w:140,h:50,content:'Event 1\n—',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:12},
          {id:'n2',type:'text',x:-290,y:-25,w:140,h:50,content:'Event 2\n—',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:12},
          {id:'n3',type:'text',x:0,y:-25,w:140,h:50,content:'Event 3\n—',color:'#f07a3a',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:12},
          {id:'n4',type:'text',x:290,y:-25,w:140,h:50,content:'Event 4\n—',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:12},
          {id:'n5',type:'text',x:580,y:-25,w:140,h:50,content:'Event 5\n—',color:'#e8c547',opacity:1,rot:0,label:'',fontFamily:'IBM Plex Mono',fontSize:12},
        ],
        edges:[
          {id:'e1',startId:'n1',endId:'n2',color:'#8890a8',style:'solid',arrowStyle:'filled',curve:0,label:''},
          {id:'e2',startId:'n2',endId:'n3',color:'#8890a8',style:'solid',arrowStyle:'filled',curve:0,label:''},
          {id:'e3',startId:'n3',endId:'n4',color:'#8890a8',style:'solid',arrowStyle:'filled',curve:0,label:''},
          {id:'e4',startId:'n4',endId:'n5',color:'#8890a8',style:'solid',arrowStyle:'filled',curve:0,label:''},
        ]
      }]
    }
  },
];

function loadUserTemplates(){
  try{return JSON.parse(localStorage.getItem(TPL_STORE_KEY)||'[]');}catch{return[];}
}
function saveUserTemplates(tpls){
  localStorage.setItem(TPL_STORE_KEY,JSON.stringify(tpls));
}

function serializeAsTemplate(){
  // Same as serialize() but strip media references (can't store blobs in template)
  const s=serialize();
  s.layers.forEach(l=>{
    l.nodes.forEach(n=>{
      if(['image','video','audio','pdfviewer'].includes(n.type)){
        const origType=n.type;
        n.type='text';n.content='['+origType+' placeholder]';n.w=160;n.h=50;
        delete n.hasSavedMedia;
      }
    });
  });
  // Reset camera to neutral
  s.camera={x:0,y:0,zoom:1};
  return s;
}

function applyTemplate(tpl){
  const d=tpl.data;
  // Revoke existing URLs
  urlReg.forEach(u=>URL.revokeObjectURL(u));urlReg.clear();mediaReg.clear();blobReg.clear();
  // Remove DOM overlays
  iframeEls.forEach(els=>els.wrap.remove());iframeEls.clear();
  pdfViewerEls.forEach(s=>s.wrap.remove());pdfViewerEls.clear();
  Object.assign(cam,Camera.load(d.camera||{x:0,y:0,zoom:1}));
  curLayerIdx=d.curLayerIdx||0;
  nid=d.nid||1;eid=d.eid||1;fid=d.fid||1;wpid=d.wpid||1;
  layers=d.layers.map(l=>({...l,nodes:l.nodes.map(n=>({...n})),edges:l.edges.map(e=>({...e})),frames:(l.frames||[]).map(f=>({...f}))}));
  waypoints=(d.waypoints||[]).map(w=>({...w}));
  sel.nodes.clear();sel.edgeId=null;sel.frameId=null;
  gridCache=null;gridCacheKey='';
  renderLayersUI();hideProps();mark();markMM();
  fitAllNodes();
  toast('Template loaded: '+tpl.name,'success');
}

// Draw a tiny thumbnail preview on a canvas element
function drawTemplateThumbnail(canvas,tpl){
  const g=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  g.fillStyle='#0d0f14';g.fillRect(0,0,W,H);
  const d=tpl.data;if(!d||!d.layers)return;
  const allNodes=d.layers.flatMap(l=>l.nodes||[]);
  const allEdges=d.layers.flatMap(l=>l.edges||[]);
  if(!allNodes.length){g.fillStyle='#252836';g.fillRect(0,0,W,H);return;}
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  allNodes.forEach(n=>{mnX=Math.min(mnX,n.x);mnY=Math.min(mnY,n.y);mxX=Math.max(mxX,n.x+n.w);mxY=Math.max(mxY,n.y+n.h)});
  const pad=20,bw=mxX-mnX+pad*2,bh=mxY-mnY+pad*2;
  const sc=Math.min(W/bw,H/bh)*0.9;
  const ox=W/2-(mnX-pad+bw/2)*sc,oy=H/2-(mnY-pad+bh/2)*sc;
  const tw=(wx,wy)=>({x:wx*sc+ox,y:wy*sc+oy});
  // Edges
  allEdges.forEach(e=>{
    const sn=allNodes.find(n=>n.id===e.startId),en=allNodes.find(n=>n.id===e.endId);
    if(!sn||!en)return;
    const sp=tw(sn.x+sn.w/2,sn.y+sn.h/2),ep=tw(en.x+en.w/2,en.y+en.h/2);
    g.strokeStyle=e.color||'#f07a3a';g.lineWidth=1;g.globalAlpha=.6;
    g.beginPath();g.moveTo(sp.x,sp.y);g.lineTo(ep.x,ep.y);g.stroke();g.globalAlpha=1;
  });
  // Nodes
  allNodes.forEach(n=>{
    const p=tw(n.x,n.y);
    g.fillStyle=(n.color||'#e8c547')+'44';
    g.strokeStyle=n.color||'#e8c547';g.lineWidth=0.8;
    g.fillRect(p.x,p.y,n.w*sc,n.h*sc);
    g.strokeRect(p.x,p.y,n.w*sc,n.h*sc);
  });
}

function renderTemplateList(){
  const list=document.getElementById('template-list');
  list.innerHTML='';
  const userTpls=loadUserTemplates();
  const all=[...BUILTIN_TEMPLATES,...userTpls];
  document.getElementById('tpl-count').textContent=all.length+' template'+(all.length!==1?'s':'');

  all.forEach(tpl=>{
    const card=document.createElement('div');
    card.className='tpl-card '+(tpl.builtin?'builtin':'user');

    // Thumbnail canvas
    const thumbCanvas=document.createElement('canvas');
    thumbCanvas.width=240;thumbCanvas.height=80;
    thumbCanvas.className='tpl-preview';
    card.appendChild(thumbCanvas);
    // Draw thumbnail after appending (needs to be in DOM for size)
    requestAnimationFrame(()=>drawTemplateThumbnail(thumbCanvas,tpl));

    const name=document.createElement('div');name.className='tpl-name';name.textContent=tpl.name;
    const desc=document.createElement('div');desc.className='tpl-desc';desc.textContent=tpl.desc||'';
    const meta=document.createElement('div');meta.className='tpl-meta';
    meta.textContent=tpl.builtin?'Built-in':'Saved '+(tpl.created?new Date(tpl.created).toLocaleDateString():'');
    card.appendChild(name);card.appendChild(desc);card.appendChild(meta);

    const btns=document.createElement('div');btns.className='tpl-btns';
    const loadBtn=document.createElement('button');loadBtn.className='primary';loadBtn.textContent='Load';
    loadBtn.addEventListener('click',()=>{
      if(confirm('Load this template? Current board will be cleared.')){
        applyTemplate(tpl);
        document.getElementById('template-modal').classList.remove('visible');
      }
    });
    btns.appendChild(loadBtn);

    if(!tpl.builtin){
      const exportBtn=document.createElement('button');exportBtn.textContent='Export';
      exportBtn.addEventListener('click',()=>{
        const blob=new Blob([JSON.stringify(tpl,null,2)],{type:'application/json'});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);
        a.download=(tpl.name||'template').replace(/\s+/g,'-')+'.tpl.json';a.click();
      });
      const delBtn=document.createElement('button');delBtn.className='tpl-del';delBtn.textContent='x';delBtn.title='Delete template';
      delBtn.addEventListener('click',()=>{
        if(confirm('Delete template "'+tpl.name+'"?')){
          const updated=loadUserTemplates().filter(t=>t.id!==tpl.id);
          saveUserTemplates(updated);renderTemplateList();
        }
      });
      btns.appendChild(exportBtn);
      card.appendChild(delBtn);
    }
    card.appendChild(btns);
    list.appendChild(card);
  });
}

document.getElementById('tplSaveBtn').addEventListener('click',()=>{
  const name=document.getElementById('tpl-save-name').value.trim();
  if(!name){toast('Enter a template name','error');return;}
  const desc=document.getElementById('tpl-save-desc').value.trim();
  const tpl={
    id:'user_'+Date.now(),builtin:false,
    name,desc,created:Date.now(),
    data:serializeAsTemplate()
  };
  const existing=loadUserTemplates();
  existing.push(tpl);
  saveUserTemplates(existing);
  document.getElementById('tpl-save-name').value='';
  document.getElementById('tpl-save-desc').value='';
  renderTemplateList();
  toast('Template saved: '+name,'success');
});

document.getElementById('tplImportInput').addEventListener('change',e=>{
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const tpl=JSON.parse(ev.target.result);
      if(!tpl.name||!tpl.data){toast('Invalid template file','error');return;}
      tpl.id='user_'+Date.now();tpl.builtin=false;tpl.created=Date.now();
      const existing=loadUserTemplates();existing.push(tpl);saveUserTemplates(existing);
      renderTemplateList();toast('Template imported: '+tpl.name,'success');
    }catch{toast('Could not parse template file','error');}
  };
  reader.readAsText(file);
  e.target.value='';
});

document.getElementById('templatesBtn').addEventListener('click',()=>{
  renderTemplateList();
  document.getElementById('template-modal').classList.add('visible');
});
document.getElementById('tpl-close').addEventListener('click',()=>{
  document.getElementById('template-modal').classList.remove('visible');
});

// =====================================================
// TUTORIAL
// =====================================================
const tutSteps=[
  {title:'// WELCOME TO INVESTIG8R',desc:'A visual investigation board. Pin images, videos, and text. Connect them with edges to map relationships and build your case.',hint:'This intro takes about 90 seconds. You can skip any time.',art:tutArt0},
  {title:'// ADDING CONTENT',desc:'Click <strong>Add</strong> in the toolbar to add images, videos, PDFs, URLs, or text nodes. Nodes appear at the center of your view. Media nodes support drag & drop too.',hint:'Shortcut: T for text, L for edge. Right-click any node for more options.',art:tutArt1},
  {title:'// SELECT, MOVE & RESIZE',desc:'Click to select (dashed border). Drag to move. The <span style="color:#5b8dee">corner handle</span> (bottom-right) resizes it — on text nodes, the font scales with the box. The <span style="color:#e8c547">circle</span> (top) rotates.',hint:'Hold Shift for multi-select. Drag empty space for box-select.',art:tutArt2},
  {title:'// DRAWING CONNECTIONS',desc:'Press <strong>L</strong> or click Edge. Click the source node, then the target. Adjust curve, style, and arrow from the Style menu. Edge labels can float as a <strong>pill</strong> or follow the line with <strong>Along edge</strong> mode.',hint:'Double-click an edge to quickly set its label inline.',art:tutArt3},
  {title:'// LAYERS & PROPERTIES',desc:'The right panel shows Layers and Properties. Select a node to edit its position, size, rotation, opacity, color and font directly. Add layers to separate your work.',hint:'Right-click any node to duplicate, reorder, edit, or add it as a waypoint.',art:tutArt4},
  {title:'// NAVIGATE & ZOOM',desc:'Scroll to zoom. Hold <strong>Space + drag</strong> to pan. The <strong>Zoom</strong> menu has Fit All, Fit Selection (zooms to selected nodes only), and manual zoom controls. The minimap always shows the full picture.',hint:'Ctrl+F to fit all nodes. Ctrl+Z to undo. Press ? for all shortcuts.',art:tutArt5},
  {title:'// WAYPOINTS & PRESENT',desc:'Use the <strong>Pin</strong> tool to drop numbered waypoints on the canvas. Right-click any node to add it as a waypoint directly. Click <strong>Present</strong> to walk through them with animated camera moves and spotlight.',hint:'Double-click a waypoint pin to add a title and speaker note.',art:tutArt6},
];
let tutStep=0;

function tutArt0(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);[[80,80,120,60,'#e8c547'],[250,60,100,55,'#5b8dee'],[400,90,110,55,'#f07a3a'],[160,130,90,50,'#4caf7d'],[330,130,100,50,'#e05252']].forEach(([x,y,w,h,col])=>{g.strokeStyle=col;g.lineWidth=1.5;g.strokeRect(x,y,w,h);g.fillStyle=col+'22';g.fillRect(x,y,w,h)});g.strokeStyle='#f07a3a88';g.lineWidth=1.5;g.beginPath();g.moveTo(140,110);g.lineTo(200,130);g.stroke();g.beginPath();g.moveTo(350,90);g.lineTo(380,130);g.stroke();g.fillStyle='#e8c547';g.font='bold 22px IBM Plex Mono,monospace';g.textBaseline='middle';g.textAlign='center';g.fillText('INVESTIG8R',260,160);g.fillStyle='#8890a8';g.font='11px IBM Plex Mono,monospace';g.fillText('Visual Investigation Board',260,182)}
function tutArt1(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);g.fillStyle='#13161e';g.fillRect(0,0,c.width,40);['Media','Text','Line','Select'].forEach((lbl,i)=>{const x=20+i*90,y=5;g.fillStyle=i===0?'#e8c547':'#1a1d28';g.strokeStyle='#363a4d';g.lineWidth=1;g.beginPath();g.roundRect(x,y,75,30,5);g.fill();g.stroke();g.fillStyle=i===0?'#000':'#8890a8';g.font='11px IBM Plex Mono,monospace';g.textBaseline='middle';g.textAlign='center';g.fillText(lbl,x+37,20)});g.fillStyle='#1a1d28';g.strokeStyle='#e8c547';g.lineWidth=1.5;g.strokeRect(60,60,160,100);g.fillStyle='#252836';g.fillRect(61,61,158,98);g.fillStyle='#555d72';g.font='32px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('\uD83D\uDDBC\uFE0F',140,111);g.strokeStyle='#5b8dee';g.lineWidth=1.5;g.strokeRect(260,70,180,60);g.fillStyle='rgba(13,15,20,.75)';g.fillRect(260,70,180,60);g.fillStyle='#d8dce8';g.font='12px IBM Plex Mono,monospace';g.textAlign='left';g.textBaseline='top';g.fillText('Suspect seen at',268,80);g.fillText('location 3rd Nov',268,96)}
function tutArt2(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);g.fillStyle='#1a1d28';g.strokeStyle='#ffffff';g.lineWidth=1.5;g.setLineDash([5,3]);g.strokeRect(150,60,180,110);g.setLineDash([]);g.fillRect(151,61,178,108);g.fillStyle='#555d72';g.font='40px sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('\uD83D\uDCF8',240,115);g.fillStyle='#fff';[[150,60],[330,60],[330,170],[150,170]].forEach(([hx,hy])=>g.fillRect(hx-4,hy-4,8,8));g.beginPath();g.arc(240,44,6,0,Math.PI*2);g.fillStyle='#e8c547';g.fill();g.strokeStyle='#e8c54788';g.lineWidth=1;g.beginPath();g.moveTo(240,50);g.lineTo(240,60);g.stroke();g.fillStyle='#5b8dee';g.fillRect(322,162,8,8);g.fillStyle='#e8c547';g.font='10px IBM Plex Mono,monospace';g.textAlign='center';g.fillText('rotate',240,34);g.fillStyle='#5b8dee';g.fillText('resize',338,187);g.strokeStyle='#4caf7d';g.lineWidth=2;g.beginPath();g.moveTo(380,115);g.lineTo(420,115);g.stroke();g.beginPath();g.moveTo(420,115);g.lineTo(410,107);g.lineTo(410,123);g.closePath();g.fillStyle='#4caf7d';g.fill()}
function tutArt3(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);[{x:60,y:80,w:120,h:70,col:'#e8c547',lbl:'Source'},{x:330,y:80,w:120,h:70,col:'#5b8dee',lbl:'Target'}].forEach(({x,y,w,h,col,lbl})=>{g.strokeStyle=col;g.lineWidth=1.5;g.fillStyle='#1a1d28';g.fillRect(x,y,w,h);g.strokeRect(x,y,w,h);g.fillStyle='#8890a8';g.font='11px IBM Plex Mono,monospace';g.textAlign='center';g.textBaseline='middle';g.fillText(lbl,x+w/2,y+h/2)});g.strokeStyle='#f07a3a';g.lineWidth=2;g.setLineDash([8,4]);g.beginPath();g.moveTo(180,115);g.lineTo(330,115);g.stroke();g.setLineDash([]);g.beginPath();g.moveTo(330,115);g.lineTo(318,108);g.lineTo(318,122);g.closePath();g.fillStyle='#f07a3a';g.fill();g.fillStyle='#8890a8';g.font='10px IBM Plex Mono,monospace';g.textAlign='center';g.fillText('1. Click source',120,170);g.fillText('2. Click target',390,170);g.fillStyle='#e8c547';g.font='bold 14px IBM Plex Mono,monospace';g.fillText('press L',255,52)}
function tutArt4(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);g.fillStyle='#13161e';g.strokeStyle='#252836';g.lineWidth=1;g.fillRect(340,0,180,200);g.strokeRect(340,0,180,200);g.fillStyle='#8890a8';g.font='bold 9px IBM Plex Mono,monospace';g.textAlign='left';g.textBaseline='top';g.fillText('LAYERS',352,8);[['Layer 1',true],['Layer 2',false]].forEach(([name,active],i)=>{if(active){g.fillStyle='rgba(232,197,71,.07)';g.fillRect(340,28+i*30,180,28);g.fillStyle='#e8c547';g.fillRect(340,28+i*30,2,28)}g.fillStyle=active?'#d8dce8':'#555d72';g.font='10px IBM Plex Mono,monospace';g.fillText(name,365,38+i*30);g.fillStyle='#555d72';g.fillText(active?'\uD83D\uDC41':'\uD83D\uDE48',350,38+i*30)});g.fillStyle='#8890a8';g.font='bold 9px IBM Plex Mono,monospace';g.fillText('PROPERTIES',352,98);[['X','120'],['Y','85'],['W','160'],['H','90'],['Rot','0'],['Opacity','1.0']].forEach(([k,v],i)=>{g.fillStyle='#555d72';g.fillText(k,352,114+i*14);g.fillStyle='#d8dce8';g.textAlign='right';g.fillText(v,510,114+i*14);g.textAlign='left'});g.strokeStyle='#e8c547';g.lineWidth=1.5;g.setLineDash([4,2]);g.fillStyle='#1a1d28';g.fillRect(60,50,220,110);g.strokeRect(60,50,220,110);g.setLineDash([]);g.fillStyle='#555d72';g.font='11px IBM Plex Mono,monospace';g.textAlign='center';g.textBaseline='middle';g.fillText('Selected node',170,105)}
function tutArt5(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);g.fillStyle='#13161e';g.strokeStyle='#363a4d';g.lineWidth=1;g.fillRect(30,30,160,110);g.strokeRect(30,30,160,110);g.fillStyle='#8890a8';g.font='8px IBM Plex Mono,monospace';g.textAlign='center';g.textBaseline='top';g.fillText('MINIMAP',110,34);[[50,55,30,20,'#e8c547'],[100,45,25,18,'#5b8dee'],[150,60,28,18,'#f07a3a'],[70,90,32,18,'#4caf7d']].forEach(([x,y,w,h,col])=>{g.fillStyle=col+'44';g.strokeStyle=col;g.lineWidth=.5;g.fillRect(x,y,w,h);g.strokeRect(x,y,w,h)});g.strokeStyle='rgba(232,197,71,.7)';g.lineWidth=1;g.strokeRect(55,50,80,55);g.fillStyle='#8890a8';g.font='11px IBM Plex Mono,monospace';g.textAlign='center';g.textBaseline='middle';g.fillText('Scroll to zoom',360,60);g.fillText('Space+drag to pan',360,80);g.fillText('Ctrl+0 reset view',360,100);g.fillText('Ctrl+F fit all',360,120);g.fillText('Fit Selection',360,140);}
function tutArt6(c){const g=c.getContext('2d');g.fillStyle='#0d0f14';g.fillRect(0,0,c.width,c.height);// Draw nodes with waypoint pins
[[80,80,'A'],[230,70,'B'],[380,80,'C']].forEach(([x,y,lbl],i)=>{g.strokeStyle='#e8c547';g.lineWidth=1.5;g.fillStyle='#1a1d28';g.fillRect(x,y,100,60);g.strokeRect(x,y,100,60);g.fillStyle='#555d72';g.font='11px IBM Plex Mono,monospace';g.textAlign='center';g.textBaseline='middle';g.fillText(lbl,x+50,y+30);// Pin
const px=x+50,py=y-18;g.beginPath();g.arc(px,py,11,0,Math.PI*2);g.fillStyle='#e8c547';g.fill();g.fillStyle='#000';g.font='bold 10px IBM Plex Mono,monospace';g.fillText(i+1,px,py)});// Presenter bar
g.fillStyle='rgba(13,15,20,.9)';g.beginPath();g.roundRect(140,160,220,34,8);g.fill();g.strokeStyle='#363a4d';g.lineWidth=1;g.stroke();g.fillStyle='#8890a8';g.font='10px IBM Plex Mono,monospace';g.textAlign='center';g.textBaseline='middle';g.fillText('◀  1 / 3  ▶     SPOT    x',260,177);g.fillStyle='#e8c547';g.font='bold 9px IBM Plex Mono,monospace';g.fillText('PRESENTATION MODE',260,150)}

function renderTutArt(){
  const c=document.getElementById('tut-canvas');
  c.width=520;c.height=200;
  tutSteps[tutStep].art(c);
}
function renderTutStep(){
  const step=tutSteps[tutStep];
  document.getElementById('tut-title').textContent=step.title;
  document.getElementById('tut-desc').innerHTML=step.desc;
  document.getElementById('tut-hint').textContent=step.hint;
  document.getElementById('tut-progress').textContent=(tutStep+1)+' / '+tutSteps.length;
  document.getElementById('tut-prev').style.display=tutStep===0?'none':'';
  document.getElementById('tut-next').textContent=tutStep===tutSteps.length-1?'Start building':'Next';
  const dotsEl=document.getElementById('tut-step-indicator');
  dotsEl.innerHTML='';
  tutSteps.forEach((_,i)=>{const d=document.createElement('div');d.className='tut-dot'+(i===tutStep?' active':'');dotsEl.appendChild(d)});
  renderTutArt();
}
function closeTut(){document.getElementById('tutorial-overlay').classList.add('hidden');localStorage.setItem('inv3_tut','1')}
document.getElementById('tut-next').addEventListener('click',()=>{if(tutStep>=tutSteps.length-1){closeTut();return}tutStep++;renderTutStep()});
document.getElementById('tut-prev').addEventListener('click',()=>{if(tutStep>0){tutStep--;renderTutStep()}});
document.getElementById('tut-skip').addEventListener('click',closeTut);

// =====================================================
// PANEL TOGGLE
// =====================================================
let panelOpen=true;
function togglePanel(force){
  panelOpen = typeof force==='boolean' ? force : !panelOpen;
  const panel=document.getElementById('side-panel');
  const btn=document.getElementById('panel-toggle');
  panel.classList.toggle('collapsed',!panelOpen);
  btn.textContent=panelOpen?'▶':'◀';
  // Update CSS var so canvas knows correct width
  document.documentElement.style.setProperty('--panel-w', panelOpen?'210px':'0px');
  resizeCanvas();
}
document.getElementById('panel-toggle').addEventListener('click',togglePanel);
document.addEventListener('keydown',e=>{
  if(e.key==='p'||e.key==='P'){if(!isInputFocused())togglePanel();}
},true);

// =====================================================
// INIT
// =====================================================
rebuildIndex();
resizeCanvas();
renderLayersUI();
hideProps();
setMode('select');
loop();

// Auto-load saved board on startup if one exists
(async()=>{
  try{
    const d=await dbGetBoard();
    if(d){
      // Silently restore the last session
      urlReg.forEach(u=>URL.revokeObjectURL(u));urlReg.clear();mediaReg.clear();blobReg.clear();
      Object.assign(cam,Camera.load(d.camera));
      curLayerIdx=d.curLayerIdx||0;nid=d.nid||nid;eid=d.eid||eid;
      layers=d.layers.map(l=>({...l,nodes:l.nodes.map(n=>({...n})),edges:l.edges.map(e=>({...e})),frames:(l.frames||[]).map(f=>({...f}))}));
      waypoints=(d.waypoints||[]).map(w=>({...w}));
      fid=d.fid||fid;wpid=d.wpid||wpid;
      sel.nodes.clear();sel.edgeId=null;sel.frameId=null;gridCache=null;gridCacheKey='';
      rebuildIndex();
      renderLayersUI();hideProps();mark();markMM();renderWaypointPins();
      // Restore media
      const jobs=[];
      layers.forEach(l=>l.nodes.forEach(n=>{
        if(['image','video','audio'].includes(n.type)&&n.hasSavedMedia){
          jobs.push(dbGet(n.id).then(blob=>{
            if(!blob)return;
            blobReg.set(n.id,blob);const url=URL.createObjectURL(blob);urlReg.set(n.id,url);
            if(n.type==='image'){const img=new Image();img.onload=()=>{mediaReg.set(n.id,img);mark()};img.src=url;}
            else if(n.type==='video'){const vid=document.createElement('video');vid.muted=false;vid.loop=true;vid.onloadedmetadata=()=>{mediaReg.set(n.id,vid);mark()};vid.src=url;}
            else{const aud=new Audio();aud.onloadedmetadata=()=>{mediaReg.set(n.id,aud);mark()};aud.src=url;}
          }).catch(()=>{}));
        }
      }));
      await Promise.all(jobs);
      toast('Session restored ✓','success');
    }
  }catch(e){/* no saved session, start fresh */}
})();

if(!localStorage.getItem('inv3_tut')){renderTutStep()}
else{document.getElementById('tutorial-overlay').classList.add('hidden')}

// =====================================================
// FRAME HELPERS
// =====================================================
function groupSelectionIntoFrame(){
  const ids=Array.from(sel.nodes);if(!ids.length){toast('Select nodes first','error');return;}
  const layer=curLayer(),li=curLayerIdx;
  const nodes=ids.map(id=>layer.nodes.find(n=>n.id===id)).filter(Boolean);
  if(!nodes.length)return;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n=>{minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+n.h)});
  const pad=28,tbH=28;
  const frame={id:mkFid(),x:minX-pad,y:minY-tbH-pad,w:maxX-minX+pad*2,h:maxY-minY+tbH+pad*2,title:'Group',color:'#5b8dee',collapsed:false};
  if(!layers[li].frames)layers[li].frames=[];
  const frames=layers[li].frames;
  hist.run(new Cmd(()=>{frames.push(frame);sel.frameId=frame.id;mark()},()=>{const i=frames.findIndex(f=>f.id===frame.id);if(i>-1)frames.splice(i,1);sel.frameId=null;mark()}));
  toast('Grouped into frame','success');
}

function deleteSelectedFrame(){
  if(!sel.frameId)return;
  const li=curLayerIdx;if(!layers[li].frames)return;
  const frameId=sel.frameId;
  const frame=layers[li].frames.find(f=>f.id===frameId);if(!frame)return;
  hist.run(new Cmd(
    ()=>{layers[li].frames=layers[li].frames.filter(f=>f.id!==frameId);sel.frameId=null;mark()},
    ()=>{layers[li].frames.push(frame);mark()}
  ));
  toast('Frame deleted');hideProps();
}

// Extend deleteSelected to also handle frames
const _origDeleteSelected=deleteSelected;
// (already defined, add frameId check)

// =====================================================
// FIT ALL NODES
// =====================================================
function fitAllNodes(){
  const allNodes=layers.flatMap(l=>l.nodes);
  if(!allNodes.length){cam.reset();mark();return;}
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  allNodes.forEach(n=>{minX=Math.min(minX,n.x);minY=Math.min(minY,n.y);maxX=Math.max(maxX,n.x+n.w);maxY=Math.max(maxY,n.y+n.h)});
  const pad=80,bw=maxX-minX+pad*2,bh=maxY-minY+pad*2;
  const zx=canvas.width/bw,zy=canvas.height/bh;
  cam.zoom=Math.max(0.05,Math.min(4,Math.min(zx,zy)));
  cam.x=canvas.width/2-(minX-pad+bw/2)*cam.zoom;
  cam.y=canvas.height/2-(minY-pad+bh/2)*cam.zoom;
  gridCache=null;mark();markMM();
  toast('Fit all');
}

// =====================================================
// EDGE LABEL EDITOR
// =====================================================
let _edgeLabelTarget=null;
const edgeLabelInput=document.getElementById('edge-label-input');

function openEdgeLabelEditor(edge,sx,sy){
  _edgeLabelTarget=edge;
  edgeLabelInput.value=edge.label||'';
  edgeLabelInput.style.left=sx+'px';
  edgeLabelInput.style.top=(sy-16)+'px';
  edgeLabelInput.classList.add('visible');
  edgeLabelInput.select();
  edgeLabelInput.focus();
}

edgeLabelInput.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key==='Escape'){
    if(e.key==='Enter'&&_edgeLabelTarget)_edgeLabelTarget.label=edgeLabelInput.value.trim();
    edgeLabelInput.classList.remove('visible');
    _edgeLabelTarget=null;mark();
    e.stopPropagation();
  }
});
edgeLabelInput.addEventListener('blur',()=>{
  if(_edgeLabelTarget)_edgeLabelTarget.label=edgeLabelInput.value.trim();
  edgeLabelInput.classList.remove('visible');
  _edgeLabelTarget=null;mark();
});

// =====================================================
// WAYPOINT SYSTEM
// =====================================================
let _wpEditTarget=null;

// =====================================================
// WAYPOINT PINS — drawn on canvas each frame (no DOM divs)
// =====================================================
// Stores pin screen positions for hit-testing: [{wp, sx, sy, idx}]
let _wpPinHitAreas=[];

function worldPosOfWaypoint(wp){
  // Explicit world anchor (set when waypoint is created/moved).
  // Falls back to deriving from camera state for old saved boards.
  if(wp.worldX!==undefined&&wp.worldY!==undefined){
    return{x:wp.worldX,y:wp.worldY};
  }
  return{
    x:(canvas.width/2-wp.camX)/wp.camZoom,
    y:(canvas.height/2-wp.camY)/wp.camZoom
  };
}

function drawWaypointPinsOnCanvas(){
  _wpPinHitAreas=[];
  const r=11; // pin radius in screen pixels
  waypoints.forEach((wp,i)=>{
    const wpos=worldPosOfWaypoint(wp);
    const sp=cam.w2s(wpos.x,wpos.y);
    const sx=sp.x,sy=sp.y;
    _wpPinHitAreas.push({wp,sx,sy,idx:i});
    const isActive=presentWpIdx===i;
    ctx.save();
    // Shadow
    ctx.shadowColor='rgba(0,0,0,0.5)';ctx.shadowBlur=6;
    // Circle fill
    ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);
    ctx.fillStyle=isActive?'#ffffff':'#e8c547';
    ctx.fill();
    if(isActive){ctx.strokeStyle='#e8c547';ctx.lineWidth=2;ctx.stroke();}
    ctx.shadowBlur=0;
    // Number label
    ctx.fillStyle=isActive?'#e8c547':'#000000';
    ctx.font=`bold ${r}px IBM Plex Mono,monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(i+1,sx,sy+0.5);
    // Title label below pin
    if(wp.title){
      ctx.font=`9px IBM Plex Mono,monospace`;
      ctx.fillStyle='#e8c547';ctx.textAlign='center';ctx.textBaseline='top';
      ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=5;
      const label=wp.title.length>22?wp.title.slice(0,22)+'…':wp.title;
      ctx.fillText(label,sx,sy+r+4);
      ctx.shadowBlur=0;
    }
    // Delete badge (×) — always visible as a small circle top-right of pin
    const bx=sx+r*0.72,by=sy-r*0.72,br=5.5;
    ctx.beginPath();ctx.arc(bx,by,br,0,Math.PI*2);
    ctx.fillStyle='#e05252';ctx.fill();
    ctx.fillStyle='#fff';ctx.font=`bold 7px sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('×',bx,by+0.5);
    // Store delete badge hit area on the same entry
    _wpPinHitAreas[_wpPinHitAreas.length-1].delBx=bx;
    _wpPinHitAreas[_wpPinHitAreas.length-1].delBy=by;
    _wpPinHitAreas[_wpPinHitAreas.length-1].delBr=br+2;
    ctx.restore();
  });
}

// renderWaypointPins is now a no-op for DOM; canvas handles it automatically
function renderWaypointPins(){
  // Remove any old DOM pins (legacy cleanup)
  document.querySelectorAll('.wp-pin').forEach(p=>p.remove());
  mark(); // trigger canvas redraw which draws pins
}

// Hit-test waypoint pins on mousedown/click
function hitWaypointPin(sx,sy){
  const r=14; // slightly generous for click
  for(let i=_wpPinHitAreas.length-1;i>=0;i--){
    const p=_wpPinHitAreas[i];
    if(Math.hypot(sx-p.sx,sy-p.sy)<=r)return p;
  }
  return null;
}