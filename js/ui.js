// =====================================================
// MEDIA BAR
// =====================================================
function updateMediaBar(){
  const bar=document.getElementById('media-bar');
  const ids=Array.from(sel.nodes);
  if(ids.length!==1){bar.classList.remove('visible');return}
  const n=curLayer().nodes.find(n=>n.id===ids[0]);
  if(!n||!['video','audio'].includes(n.type)){bar.classList.remove('visible');return}
  const el=mediaReg.get(n.id);if(!el){bar.classList.remove('visible');return}
  bar.classList.add('visible');
  document.getElementById('mb-label').textContent=n.content||n.type;
  const pp=document.getElementById('mb-pp');
  const volSl=document.getElementById('media-vol');
  const spdSl=document.getElementById('media-spd');
  const spdVal=document.getElementById('media-spdval');
  pp.innerHTML=el.paused?'&#9654;':'&#9646;&#9646;';
  volSl.value=el.volume;spdSl.value=el.playbackRate;spdVal.textContent=el.playbackRate+'x';
  pp.onclick=()=>{el.paused?el.play():el.pause();pp.innerHTML=el.paused?'&#9654;':'&#9646;&#9646;';mark()};
  volSl.oninput=()=>{el.volume=parseFloat(volSl.value)};
  spdSl.oninput=()=>{el.playbackRate=parseFloat(spdSl.value);spdVal.textContent=spdSl.value+'x'};
}
document.getElementById('mb-close').addEventListener('click',()=>document.getElementById('media-bar').classList.remove('visible'));

// =====================================================
// NODE CREATION
// =====================================================
function centerWorld(){return cam.s2w(canvas.width/2,canvas.height/2)}

function addNode(node){
  const li=curLayerIdx;
  hist.run(new Cmd(
    ()=>{layers[li].nodes.push(node);indexNode(node);sel.nodes=new Set([node.id]);_qtDirty=true;mark();markMM();showProps();renderLayersUI()},
    ()=>{layers[li].nodes=layers[li].nodes.filter(n=>n.id!==node.id);unindexNode(node.id);_qtDirty=true;mark();markMM();renderLayersUI()}
  ));
}

function makeTextNode(content,fontFamily,fontSize){
  const c=centerWorld();
  const maxW=Math.max(120, canvas.width*0.35/cam.zoom); // default max ~35% of viewport
  const {w,h}=measureTextBox(content,fontFamily||'IBM Plex Mono',fontSize||13,maxW);
  return{id:mkNid(),type:'text',x:snap(c.x-w/2),y:snap(c.y-h/2),w,h,content,color:ui.nodeColor,opacity:ui.opacity,rot:0,label:'',fontFamily:fontFamily||'IBM Plex Mono',fontSize:fontSize||13};
}

function addMediaNode(file){
  const type=file.type.split('/')[0];
  if(!['image','video','audio'].includes(type)){toast('Unsupported file type','error');return}
  const url=URL.createObjectURL(file);
  const id=mkNid(),c=centerWorld();
  const finalize=(el,nw,nh)=>{
    const node={id,type,x:snap(c.x-nw/2),y:snap(c.y-nh/2),w:nw,h:nh,content:file.name,color:ui.nodeColor,opacity:ui.opacity,rot:0,label:''};
    mediaReg.set(id,el);urlReg.set(id,url);
    // Store original File/blob for .jizz export
    blobReg.set(id,file);
    addNode(node);toast('Added: '+file.name,'success');
  };
  if(type==='image'){
    const img=new Image();
    img.onload=()=>{const ar=img.height/img.width;finalize(img,220,Math.round(220*ar))};
    img.onerror=()=>{URL.revokeObjectURL(url);toast('Failed to load image','error')};
    img.src=url;
  }else if(type==='video'){
    const vid=document.createElement('video');
    vid.muted=false;vid.loop=true;vid.crossOrigin='anonymous';
    vid.onloadedmetadata=()=>{const ar=vid.videoHeight/vid.videoWidth;finalize(vid,220,Math.round(220*ar))};
    vid.onerror=()=>{URL.revokeObjectURL(url);toast('Failed to load video','error')};
    vid.src=url;
  }else{
    const aud=new Audio();
    aud.onloadedmetadata=()=>finalize(aud,200,70);
    aud.onerror=()=>{URL.revokeObjectURL(url);toast('Failed to load audio','error')};
    aud.src=url;
  }
}

// =====================================================
// TEXT EDITOR
// =====================================================
let textEditTarget=null,textEditMode='content',pendingTextAdd=false;

function openTextEditor(node,labelMode){
  textEditTarget=node;textEditMode=labelMode?'label':'content';pendingTextAdd=false;
  document.getElementById('text-editor-title').textContent=labelMode?'EDIT LABEL':(node?'EDIT TEXT':'ADD TEXT');
  document.getElementById('text-editor-label').textContent=labelMode?'LABEL':'CONTENT';
  const inp=document.getElementById('text-editor-input');
  inp.value=labelMode?(node&&node.label||''):(node&&node.content||'');
  document.getElementById('text-font-sel').value=(node&&node.fontFamily)||'IBM Plex Mono';
  const targetSize=String((node&&node.fontSize)||13);
  const sizeSel=document.getElementById('text-size-sel');
  // Try exact match, else pick closest
  let found=false;
  for(const opt of sizeSel.options){if(opt.value===targetSize){opt.selected=true;found=true;break;}}
  if(!found){
    let closest=null,minDiff=Infinity;
    for(const opt of sizeSel.options){const d=Math.abs(parseInt(opt.value)-parseInt(targetSize));if(d<minDiff){minDiff=d;closest=opt;}}
    if(closest)closest.selected=true;
  }
  updateFontPreview();
  document.getElementById('text-editor-overlay').classList.add('visible');
  setTimeout(()=>inp.focus(),60);
}
function openLabelEditor(node){openTextEditor(node,true)}

function updateFontPreview(){
  const font=document.getElementById('text-font-sel').value;
  const size=parseInt(document.getElementById('text-size-sel').value);
  const text=document.getElementById('text-editor-input').value||'Preview text here';
  const preview=document.getElementById('text-font-preview');
  preview.style.fontFamily="'"+font+"',monospace,sans-serif";
  preview.style.fontSize=Math.min(size,22)+'px';
  preview.textContent=text;
}
document.getElementById('text-font-sel').addEventListener('change',updateFontPreview);
document.getElementById('text-size-sel').addEventListener('change',updateFontPreview);
document.getElementById('text-editor-input').addEventListener('input',updateFontPreview);

document.getElementById('text-editor-ok').addEventListener('click',()=>{
  const val=document.getElementById('text-editor-input').value;
  const fontFamily=document.getElementById('text-font-sel').value;
  const fontSize=parseInt(document.getElementById('text-size-sel').value);
  document.getElementById('text-editor-overlay').classList.remove('visible');
  if(pendingTextAdd){
    pendingTextAdd=false;
    if(val.trim())addNode(makeTextNode(val,fontFamily,fontSize));
    return;
  }
  const n=textEditTarget;if(!n||!val)return;
  const oldContent=n.content,oldLabel=n.label,oldFont=n.fontFamily,oldSize=n.fontSize,oldW=n.w,oldH=n.h;
  if(textEditMode==='label'){
    hist.run(new Cmd(()=>{n.label=val;mark()},()=>{n.label=oldLabel;mark()}));
  }else{
    hist.run(new Cmd(
      ()=>{
        n.content=val;n.fontFamily=fontFamily;n.fontSize=fontSize;
        // Invalidate wrap cache for this node's content
        _wrapCache.clear();
        const {w,h}=measureTextBox(val,fontFamily,fontSize,n.w||200);
        // Only auto-resize if the box hasn't been manually resized (or always grow)
        n.w=Math.max(n.w||80,w);n.h=h;
        mark();
      },
      ()=>{n.content=oldContent;n.fontFamily=oldFont;n.fontSize=oldSize;n.w=oldW;n.h=oldH;mark()}
    ));
  }
  textEditTarget=null;showProps();
});
document.getElementById('text-editor-cancel').addEventListener('click',()=>{
  pendingTextAdd=false;textEditTarget=null;
  document.getElementById('text-editor-overlay').classList.remove('visible');
});

// =====================================================
// DELETE / DUPLICATE
// =====================================================
function deleteSelected(){
  // If a frame is selected (and no nodes), delete the frame
  if(sel.frameId&&!sel.nodes.size){deleteSelectedFrame();return;}
  const layer=curLayer(),li=curLayerIdx;
  const ids=Array.from(sel.nodes);
  if(ids.length>0){
    const nodes=ids.map(id=>layer.nodes.find(n=>n.id===id)).filter(Boolean);
    const edges=layer.edges.filter(e=>ids.includes(e.startId)||ids.includes(e.endId));
    hist.run(new Cmd(
      ()=>{
        ids.forEach(id=>{layers[li].nodes=layers[li].nodes.filter(n=>n.id!==id);unindexNode(id)});
        edges.forEach(e=>{layers[li].edges=layers[li].edges.filter(ed=>ed.id!==e.id);unindexEdge(e.id)});
        sel.nodes.clear();
        nodes.forEach(n=>{const u=urlReg.get(n.id);if(u){URL.revokeObjectURL(u);urlReg.delete(n.id)}mediaReg.delete(n.id);removeIframe(n.id);removePdfViewer(n.id)});
        _qtDirty=true;mark();markMM();hideProps();updateMediaBar()
      },
      ()=>{
        nodes.forEach(n=>{layers[li].nodes.push(n);indexNode(n)});
        edges.forEach(e=>{layers[li].edges.push(e);indexEdge(e)});
        _qtDirty=true;mark();markMM()
      }
    ));toast('Deleted');
  }else if(sel.edgeId){
    const edgeId=sel.edgeId;
    const edge=layer.edges.find(e=>e.id===edgeId);
    if(edge)hist.run(new Cmd(
      ()=>{layers[li].edges=layers[li].edges.filter(e=>e.id!==edgeId);unindexEdge(edgeId);sel.edgeId=null;mark()},
      ()=>{layers[li].edges.push(edge);indexEdge(edge);mark()}
    ));
    toast('Deleted');
  }
}

function duplicateSelected(){
  const ids=Array.from(sel.nodes);if(!ids.length)return;
  const newNodes=ids.map(id=>{
    const n=getNode(id);if(!n)return null;
    const clone={...n,id:mkNid(),x:n.x+22,y:n.y+22};
    if(mediaReg.has(n.id))mediaReg.set(clone.id,mediaReg.get(n.id));
    if(blobReg.has(n.id))blobReg.set(clone.id,blobReg.get(n.id));
    if(urlReg.has(n.id)){const blob=blobReg.get(n.id);if(blob){urlReg.set(clone.id,URL.createObjectURL(blob));}}
    return clone;
  }).filter(Boolean);
  if(!newNodes.length)return;
  const li=curLayerIdx;const newIds=new Set(newNodes.map(n=>n.id));
  hist.run(new Cmd(
    ()=>{newNodes.forEach(n=>{layers[li].nodes.push(n);indexNode(n)});sel.nodes=new Set(newNodes.map(n=>n.id));_qtDirty=true;mark();markMM()},
    ()=>{newNodes.forEach(n=>{layers[li].nodes=layers[li].nodes.filter(x=>x.id!==n.id);unindexNode(n.id)});_qtDirty=true;mark();markMM()}
  ));
}

// =====================================================
// LAYERS
// =====================================================
function renderLayersUI(){
  const list=document.getElementById('layers-list');
  list.innerHTML='';
  layers.forEach((layer,i)=>{
    const div=document.createElement('div');
    div.className='layer-item'+(i===curLayerIdx?' active':'')+(layer.visible?'':' hidden-layer');
    const vis=document.createElement('span');
    vis.className='lvis';vis.dataset.idx=i;vis.textContent=layer.visible?'O':'H';
    const name=document.createElement('span');
    name.className='lname';name.textContent=layer.name;
    div.appendChild(vis);div.appendChild(name);
    div.addEventListener('click',e=>{
      if(e.target===vis)return;
      curLayerIdx=i;sel.nodes.clear();sel.edgeId=null;
      renderLayersUI();mark();markMM();hideProps();updateMediaBar();
    });
    vis.addEventListener('click',e=>{
      e.stopPropagation();
      const oldVis=layer.visible;
      hist.run(new Cmd(
        ()=>{layer.visible=!oldVis;renderLayersUI();mark();markMM()},
        ()=>{layer.visible=oldVis;renderLayersUI();mark();markMM()}
      ));
    });
    list.appendChild(div);
  });
}
document.getElementById('addLayerBtn').addEventListener('click',()=>{
  layers.push({id:layers.length,name:'Layer '+(layers.length+1),visible:true,nodes:[],edges:[],frames:[]});
  curLayerIdx=layers.length-1;renderLayersUI();mark();
});

// =====================================================
// MODE / TOOLBAR
// =====================================================
function setMode(m){
  mode=m;
  if(m!=='line')lineStart=null;
  document.getElementById('addLineBtn').classList.toggle('active',m==='line');
  document.getElementById('selectBtn').classList.toggle('active',m==='select');
  document.getElementById('addFrameBtn').classList.toggle('active',m==='frame');
  document.getElementById('addWaypointBtn').classList.toggle('active',m==='waypoint');
  canvas.style.cursor=m==='line'||m==='frame'||m==='waypoint'?'crosshair':'default';
  mark();
}

document.getElementById('fileInput').addEventListener('change',e=>{const f=e.target.files[0];if(f)addMediaNode(f);e.target.value=''})

// ── PDF IMPORT ──
// ── PDF IMPORT SYSTEM ──
let _pdfDoc=null,_pdfFile=null,_pdfMode='viewer',_pdfSelected=new Set();

async function renderPdfThumb(page,scale=0.25){
  const vp=page.getViewport({scale});
  const c=document.createElement('canvas');
  c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  return c;
}

async function renderPdfPageToBlob(page,scale=1.8){
  const vp=page.getViewport({scale});
  const c=document.createElement('canvas');
  c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  return new Promise(res=>c.toBlob(res,'image/png'));
}

async function addPdfPageAsImage(page,pageNum,filename,offsetX,offsetY){
  const blob=await renderPdfPageToBlob(page);
  if(!blob)return;
  const id=mkNid();
  const url=URL.createObjectURL(blob);
  const img=new Image();
  await new Promise(res=>{
    img.onload=res;img.onerror=res;img.src=url;
  });
  const ar=img.naturalHeight/img.naturalWidth;
  const nw=Math.min(300,img.naturalWidth);const nh=Math.round(nw*ar);
  const c0=centerWorld();
  const node={id,type:'image',
    x:snap(c0.x-nw/2+offsetX),y:snap(c0.y-nh/2+offsetY),
    w:nw,h:nh,content:filename+' p.'+pageNum,
    color:ui.nodeColor,opacity:ui.opacity,rot:0,label:'p.'+pageNum
  };
  mediaReg.set(id,img);urlReg.set(id,url);blobReg.set(id,blob);
  addNode(node);
}

document.getElementById('pdfInput').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;e.target.value='';
  if(typeof pdfjsLib==='undefined'){toast('PDF.js not loaded','error');return}
  toast('Loading PDF…');
  try{
    const buf=await file.arrayBuffer();
    _pdfDoc=await pdfjsLib.getDocument({data:buf}).promise;
    _pdfFile=file;
    _pdfSelected.clear();
    _pdfMode='viewer';
    const total=_pdfDoc.numPages;
    document.getElementById('pdf-modal-info').textContent=`${file.name} — ${total} page(s)`;
    document.getElementById('pdf-range-to').max=total;
    document.getElementById('pdf-range-to').value=Math.min(total,5);
    document.getElementById('pdf-range-from').max=total;
    // Render thumbnails
    const strip=document.getElementById('pdf-preview-strip');
    strip.innerHTML='';
    for(let p=1;p<=total;p++){
      const page=await _pdfDoc.getPage(p);
      const thumbC=await renderPdfThumb(page,Math.min(0.3,100/page.getViewport({scale:1}).width));
      const wrap=document.createElement('div');
      wrap.className='pdf-thumb';wrap.dataset.page=p;
      const check=document.createElement('div');
      check.className='pg-check';check.textContent='✓';
      const lbl=document.createElement('div');
      lbl.className='pg-num';lbl.textContent='p.'+p;
      wrap.appendChild(thumbC);wrap.appendChild(check);wrap.appendChild(lbl);
      wrap.addEventListener('click',()=>{
        if(_pdfSelected.has(p))_pdfSelected.delete(p);else _pdfSelected.add(p);
        wrap.classList.toggle('selected',_pdfSelected.has(p));
      });
      strip.appendChild(wrap);
    }
    // Set mode
    setPdfMode('viewer');
    document.getElementById('pdf-modal').classList.add('visible');
    toast('PDF loaded — choose import mode');
  }catch(err){toast('PDF load failed: '+err.message,'error')}
});

function setPdfMode(mode){
  _pdfMode=mode;
  document.querySelectorAll('.pdf-opt-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  const rangeRow=document.getElementById('pdf-page-range-row');
  const info=document.getElementById('pdf-viewer-info');
  rangeRow.style.display=mode==='range'?'flex':'none';
  const msgs={
    viewer:'<b style="color:var(--accent)">Live PDF Viewer</b> embeds an interactive mini-viewer on the canvas.<br>Navigate pages with ◀ ▶ buttons. Drag to reposition. Resize with the handle.',
    selected:'Click page thumbnails above to select which pages to import as individual image nodes.',
    range:'Renders a continuous range of pages as separate image nodes.',
    all:'Renders every page as a separate image node on the board.'
  };
  info.innerHTML=msgs[mode]||''
}
document.querySelectorAll('.pdf-opt-btn').forEach(b=>b.addEventListener('click',()=>setPdfMode(b.dataset.mode)));

document.getElementById('pdf-cancel').addEventListener('click',()=>{
  document.getElementById('pdf-modal').classList.remove('visible');
  _pdfDoc=null;_pdfFile=null;
});

document.getElementById('pdf-ok').addEventListener('click',async()=>{
  if(!_pdfDoc||!_pdfFile){return}
  document.getElementById('pdf-modal').classList.remove('visible');
  const total=_pdfDoc.numPages;
  const fname=_pdfFile.name;

  if(_pdfMode==='viewer'){
    // ── LIVE PDF VIEWER NODE ──
    const c0=centerWorld();
    const id=mkNid();
    const node={id,type:'pdfviewer',
      x:snap(c0.x-220),y:snap(c0.y-300),w:440,h:600,
      content:fname,
      color:'#5b8dee',opacity:1,rot:0,label:fname,
      pdfTotalPages:total,pdfCurPage:1
    };
    // Store the raw ArrayBuffer in blobReg as a Blob so we can reload it
    const rawBuf=await _pdfFile.arrayBuffer();
    const pdfBlob=new Blob([rawBuf],{type:'application/pdf'});
    blobReg.set(id,pdfBlob);
    // Keep the pdfDoc reference in mediaReg (non-serializable but works live)
    mediaReg.set(id,_pdfDoc);
    addNode(node);
    toast('PDF viewer added — use ◀▶ buttons to flip pages','success');

  } else {
    // ── IMAGE PAGES ──
    let pages=[];
    if(_pdfMode==='all') pages=[...Array(total)].map((_,i)=>i+1);
    else if(_pdfMode==='range'){
      const from=Math.max(1,parseInt(document.getElementById('pdf-range-from').value)||1);
      const to=Math.min(total,parseInt(document.getElementById('pdf-range-to').value)||total);
      for(let i=from;i<=to;i++) pages.push(i);
    } else {
      pages=Array.from(_pdfSelected).sort((a,b)=>a-b);
      if(!pages.length){toast('Select at least one page','error');document.getElementById('pdf-modal').classList.add('visible');return}
    }
    toast(`Rendering ${pages.length} page(s)…`);
    for(let i=0;i<pages.length;i++){
      const p=pages[i];
      const page=await _pdfDoc.getPage(p);
      await addPdfPageAsImage(page,p,fname,i*24,i*24);
    }
    toast(`${pages.length} page(s) added to board ✓`,'success');
  }
  _pdfDoc=null;_pdfFile=null;_pdfSelected.clear();
});

// ── URL / WEBSITE EMBED ──
document.getElementById('addUrlBtn').addEventListener('click',()=>{
  document.getElementById('url-input').value='';
  document.getElementById('url-modal').classList.add('visible');
  setTimeout(()=>document.getElementById('url-input').focus(),60);
});
document.querySelectorAll('.url-preset-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.getElementById('url-input').value=btn.dataset.url;
  });
});
document.getElementById('url-cancel').addEventListener('click',()=>document.getElementById('url-modal').classList.remove('visible'));
document.getElementById('url-ok').addEventListener('click',()=>{
  let url=document.getElementById('url-input').value.trim();
  if(!url){toast('Enter a URL','error');return}
  if(!url.startsWith('http')){url='https://'+url}
  const c0=centerWorld();
  const id=mkNid();
  const node={id,type:'url',x:snap(c0.x-300),y:snap(c0.y-200),w:600,h:400,content:url,color:'#5b8dee',opacity:1,rot:0,label:url.replace(/https?:\/\//,'').split('/')[0]};
  addNode(node);
  document.getElementById('url-modal').classList.remove('visible');
  toast('Website embedded — double-click to interact ✓','success');
});
// Also handle paste event: if user pastes a URL while canvas focused, offer to embed
document.addEventListener('paste',e=>{
  if(isInputFocused())return;
  const txt=(e.clipboardData||window.clipboardData).getData('text').trim();
  if(txt.startsWith('http')||txt.startsWith('www.')){
    e.preventDefault();
    const url=txt.startsWith('http')?txt:'https://'+txt;
    document.getElementById('url-input').value=url;
    document.getElementById('url-modal').classList.add('visible');
    toast('URL detected — confirm to embed');
  }
});;
document.getElementById('addTextBtn').addEventListener('click',()=>{
  pendingTextAdd=true;textEditTarget=null;
  document.getElementById('text-editor-title').textContent='ADD TEXT';
  document.getElementById('text-editor-label').textContent='CONTENT';
  document.getElementById('text-editor-input').value='';
  document.getElementById('text-font-sel').value='IBM Plex Mono';
  document.getElementById('text-size-sel').value='13';
  updateFontPreview();
  document.getElementById('text-editor-overlay').classList.add('visible');
  setTimeout(()=>document.getElementById('text-editor-input').focus(),60);
});
document.getElementById('addLineBtn').addEventListener('click',()=>setMode('line'));
document.getElementById('selectBtn').addEventListener('click',()=>setMode('select'));
document.getElementById('undoBtn').addEventListener('click',()=>{hist.undo();mark();markMM()});
document.getElementById('redoBtn').addEventListener('click',()=>{hist.redo();mark();markMM()});
document.getElementById('deleteBtn').addEventListener('click',deleteSelected);
document.getElementById('nodeColor').addEventListener('input',e=>{ui.nodeColor=e.target.value;sel.nodes.forEach(id=>{const n=getNode(id);if(n)n.color=e.target.value});mark()});
document.getElementById('edgeColor').addEventListener('input',e=>{ui.edgeColor=e.target.value;const edge=curLayer().edges.find(ed=>ed.id===sel.edgeId);if(edge)edge.color=e.target.value;mark()});
document.getElementById('opacityRange').addEventListener('input',e=>{ui.opacity=parseFloat(e.target.value);document.getElementById('opacityVal').textContent=ui.opacity.toFixed(2);sel.nodes.forEach(id=>{const n=getNode(id);if(n)n.opacity=ui.opacity});mark()});
document.getElementById('lineStyleSel').addEventListener('change',e=>ui.lineStyle=e.target.value);
document.getElementById('arrowStyleSel').addEventListener('change',e=>ui.arrowStyle=e.target.value);

