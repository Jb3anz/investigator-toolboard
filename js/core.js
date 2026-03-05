'use strict';
// roundRect polyfill for browsers that don't support it yet
if(!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){
    if(w<2*r)r=w/2;if(h<2*r)r=h/2;
    this.beginPath();this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);
    this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath();
    return this;
  };
}
// =====================================================
class Camera {
  constructor(){this.x=0;this.y=0;this.zoom=1}
  w2s(wx,wy){return{x:wx*this.zoom+this.x,y:wy*this.zoom+this.y}}
  s2w(sx,sy){return{x:(sx-this.x)/this.zoom,y:(sy-this.y)/this.zoom}}
  pan(dx,dy){this.x+=dx;this.y+=dy}
  zoomAt(f,sx,sy){
    const b=this.s2w(sx,sy);
    this.zoom=Math.max(0.05,Math.min(10,this.zoom*f));
    const a=this.w2s(b.x,b.y);
    this.x+=sx-a.x;this.y+=sy-a.y;
  }
  reset(){this.x=0;this.y=0;this.zoom=1}
  save(){return{x:this.x,y:this.y,zoom:this.zoom}}
  static load(d){const c=new Camera();c.x=d.x;c.y=d.y;c.zoom=d.zoom;return c}
}

// =====================================================
// COMMAND HISTORY (diff-based, no full snapshots)
// =====================================================
class Cmd{constructor(d,u){this.do=d;this.undo=u}}
class History{
  constructor(max=120){this.cmds=[];this.ptr=-1;this.max=max}
  run(cmd){
    this.cmds.splice(this.ptr+1);
    if(this.cmds.length>=this.max){this.cmds.shift();/* ptr stays same — shifted one off front */}else{this.ptr++;}
    this.cmds.push(cmd);cmd.do();
  }
  undo(){if(this.ptr>=0){this.cmds[this.ptr--].undo();return true}return false}
  redo(){if(this.ptr<this.cmds.length-1){this.cmds[++this.ptr].do();return true}return false}
}

// =====================================================
// STATE
// =====================================================
const cam = new Camera();
const hist = new History();
let layers=[{id:0,name:'Layer 1',visible:true,nodes:[],edges:[],frames:[]}];
let waypoints=[]; // [{id,title,note,camX,camY,camZoom,spotlightNodeIds}]
let curLayerIdx=0;
const curLayer=()=>layers[curLayerIdx];
const sel={nodes:new Set(),edgeId:null,frameId:null};
let mode='select';
let lineStart=null;
let lineTempX=0,lineTempY=0;
let snapGrid=false;
const gridSize=50;
const ui={nodeColor:'#e8c547',edgeColor:'#f07a3a',lineStyle:'solid',arrowStyle:'filled',opacity:1.0};
const mediaReg=new Map();
const urlReg=new Map();
const blobReg=new Map(); // stores actual Blob for .jizz export
let _canvasOffX=0,_canvasOffY=0,_canvasOffDirty=true;
let nid=1,eid=1,fid=1,wpid=1;
const mkFid=()=>'f'+(fid++);
const mkWpid=()=>'wp'+(wpid++);
const mkNid=()=>'n'+(nid++);
const mkEid=()=>'e'+(eid++);
const snap=v=>snapGrid?Math.round(v/gridSize)*gridSize:v;

// =====================================================
// NODE / EDGE INDEX — O(1) lookup by id
// =====================================================
// nodeIndex: id → node object (across all layers)
// edgeIndex: id → edge object (across all layers)
// Call rebuildIndex() after any bulk mutation (load/clear).
// addNode/deleteNode/addEdge/deleteEdge keep it incrementally.
const nodeIndex=new Map();
const edgeIndex=new Map();
function rebuildIndex(){
  nodeIndex.clear();edgeIndex.clear();
  for(const l of layers){
    for(const n of l.nodes)nodeIndex.set(n.id,n);
    for(const e of l.edges)edgeIndex.set(e.id,e);
  }
}
function indexNode(n){nodeIndex.set(n.id,n);}
function unindexNode(id){nodeIndex.delete(id);}
function indexEdge(e){edgeIndex.set(e.id,e);}
function unindexEdge(id){edgeIndex.delete(id);}
// Convenience: get node by id (any layer)
const getNode=id=>nodeIndex.get(id)||null;
const getEdge=id=>edgeIndex.get(id)||null;
// Presentation state — hoisted here so render() and event handlers can access before the
// PRESENTATION MODE section is reached (avoids temporal dead zone with let)
let presentMode=false,presentWpIdx=0;
let _presentSpotlight=false;
let _camAnimRAF=null;


// text measurement — shared across files
let _measureCtx=null;
function getMeasureCtx(){
  if(!_measureCtx){const c=new OffscreenCanvas(1,1);_measureCtx=c.getContext('2d');}
  return _measureCtx;
}

// Wrap text into lines that fit within maxWidth pixels
// Results are cached — same text/font/size/width returns instantly
const _wrapCache=new Map();
const _WRAP_CACHE_MAX=400;
function wrapTextLines(text, fontFamily, fontSize, maxWidth){
  const key=text+'|'+(fontFamily||'IBM Plex Mono')+'|'+fontSize+'|'+Math.round(maxWidth);
  if(_wrapCache.has(key))return _wrapCache.get(key);
  const g=getMeasureCtx();
  g.font=fontSize+'px '+(fontFamily||'IBM Plex Mono')+',monospace';
  const hardLines=text.split('\n');
  const result=[];
  for(const hard of hardLines){
    if(!hard){result.push('');continue;}
    if(g.measureText(hard).width<=maxWidth){result.push(hard);continue;}
    const words=hard.split(' ');
    let cur='';
    for(const w of words){
      const test=cur?cur+' '+w:w;
      if(g.measureText(test).width<=maxWidth){cur=test;}
      else{if(cur)result.push(cur);cur=w;}
    }
    if(cur)result.push(cur);
  }
  // Evict oldest if cache is full
  if(_wrapCache.size>=_WRAP_CACHE_MAX){
    _wrapCache.delete(_wrapCache.keys().next().value);
  }
  _wrapCache.set(key,result);
  return result;
}

// Compute the pixel dimensions needed for text content
function measureTextBox(content, fontFamily, fontSize, maxWidth){
  const g=getMeasureCtx();
  g.font=fontSize+'px '+(fontFamily||'IBM Plex Mono')+',monospace';
  const PAD=16; // horizontal padding each side
  const VPAD=12; // vertical padding
  const lh=fontSize*1.5;
  const lines=wrapTextLines(content||'', fontFamily, fontSize, maxWidth||(fontSize*30));
  let maxW=0;
  for(const l of lines)maxW=Math.max(maxW,g.measureText(l).width);
  const w=Math.max(80,maxW+PAD*2);
  const h=Math.max(fontSize+VPAD*2, lines.length*lh+VPAD*2);
  return{w,h,lines};
}
