// =====================================================
// QUADTREE — spatial index, rebuilt on dirty
// =====================================================
class QTNode{
  constructor(x,y,w,h,depth=0){this.bounds={x,y,w,h};this.items=[];this.children=null;this.depth=depth;}
  get maxDepth(){return 6}
  get maxItems(){return 8}
  subdivide(){
    const{x,y,w,h}=this.bounds,hw=w/2,hh=h/2;
    this.children=[
      new QTNode(x,y,hw,hh,this.depth+1),
      new QTNode(x+hw,y,hw,hh,this.depth+1),
      new QTNode(x,y+hh,hw,hh,this.depth+1),
      new QTNode(x+hw,y+hh,hw,hh,this.depth+1)
    ];
  }
  _overlaps(ax,ay,aw,ah){
    const{x,y,w,h}=this.bounds;
    return ax<x+w&&ax+aw>x&&ay<y+h&&ay+ah>y;
  }
  insert(item){
    // item = {id, x,y,w,h}
    if(!this._overlaps(item.x,item.y,item.w,item.h))return false;
    if(this.children){
      let inserted=false;
      for(const c of this.children)if(c.insert(item))inserted=true;
      return inserted;
    }
    this.items.push(item);
    if(this.items.length>this.maxItems&&this.depth<this.maxDepth){
      this.subdivide();
      for(const it of this.items)for(const c of this.children)c.insert(it);
      this.items=[];
    }
    return true;
  }
  query(px,py,results=new Set()){
    if(!this._overlaps(px-1,py-1,2,2))return results;
    if(this.children){for(const c of this.children)c.query(px,py,results);}
    else for(const it of this.items)if(px>=it.x&&px<=it.x+it.w&&py>=it.y&&py<=it.y+it.h)results.add(it.id);
    return results;
  }
  queryRect(x,y,w,h,results=new Set()){
    if(!this._overlaps(x,y,w,h))return results;
    if(this.children){for(const c of this.children)c.queryRect(x,y,w,h,results);}
    else for(const it of this.items)if(it.x<x+w&&it.x+it.w>x&&it.y<y+h&&it.y+it.h>y)results.add(it.id);
    return results;
  }
}

let _qt=null;
let _qtDirty=true;

function markQT(){_qtDirty=true;}

function rebuildQT(){
  if(!_qtDirty)return;
  // Compute world bounds across all nodes
  const all=layers.flatMap(l=>l.nodes);
  if(!all.length){_qt=new QTNode(-5000,-5000,10000,10000);_qtDirty=false;return;}
  let mnX=Infinity,mnY=Infinity,mxX=-Infinity,mxY=-Infinity;
  for(const n of all){mnX=Math.min(mnX,n.x);mnY=Math.min(mnY,n.y);mxX=Math.max(mxX,n.x+n.w);mxY=Math.max(mxY,n.y+n.h);}
  const pad=200;
  _qt=new QTNode(mnX-pad,mnY-pad,(mxX-mnX)+pad*2,(mxY-mnY)+pad*2);
  for(const n of all)_qt.insert({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h});
  _qtDirty=false;
}

// =====================================================
// STATUS
// =====================================================
function updateStatus(){
  document.getElementById('st-zoom').textContent=(cam.zoom*100).toFixed(0)+'%';
  document.getElementById('st-nodes').textContent=curLayer().nodes.length;
  document.getElementById('st-layer').textContent=curLayer().name;
  document.getElementById('st-snap').textContent=snapGrid?'ON':'OFF';
  const modeText=mode==='line'?(lineStart?'LINE: click target':'LINE: click source'):mode.toUpperCase();
  document.getElementById('st-mode').textContent=modeText;
}

// =====================================================
// HIT TESTING
// =====================================================
function hitNode(wx,wy){
  rebuildQT();
  const nodes=curLayer().nodes;
  // QT gives us candidate node IDs that overlap the point's AABB — still do precise rotated test
  const candidates=_qt.query(wx,wy);
  // Iterate in reverse z-order (last = top)
  for(let i=nodes.length-1;i>=0;i--){
    if(candidates.size&&!candidates.has(nodes[i].id))continue;
    if(nodeContains(nodes[i],wx,wy))return nodes[i];
  }
  return null;
}
function nodeContains(n,wx,wy){
  const cx=n.x+n.w/2,cy=n.y+n.h/2;
  const dx=wx-cx,dy=wy-cy;
  const r=-n.rot*Math.PI/180;
  const lx=dx*Math.cos(r)-dy*Math.sin(r);
  const ly=dx*Math.sin(r)+dy*Math.cos(r);
  // Generous hit area: +8px in world space regardless of zoom
  const pad=8/cam.zoom;
  return Math.abs(lx)<=n.w/2+pad&&Math.abs(ly)<=n.h/2+pad;
}
function getHandle(n,wx,wy){
  if(!sel.nodes.has(n.id))return null;
  const cx=n.x+n.w/2,cy=n.y+n.h/2;
  const dx=wx-cx,dy=wy-cy;
  const r=-n.rot*Math.PI/180;
  const lx=dx*Math.cos(r)-dy*Math.sin(r);
  const ly=dx*Math.sin(r)+dy*Math.cos(r);
  const hw=n.w/2,hh=n.h/2;
  // Tighter tolerance — must be within the actual handle square (7px in world space)
  const hSize=7/cam.zoom;
  const rotateTol=6/cam.zoom;
  if(Math.abs(lx)<rotateTol&&Math.abs(ly-(-hh-16/cam.zoom))<rotateTol)return'rotate';
  // Resize: must be in bottom-right corner square
  if(lx>=hw-hSize&&lx<=hw+hSize&&ly>=hh-hSize&&ly<=hh+hSize)return'resize';
  return null;
}
function hitEdge(wx,wy){
  const edges=curLayer().edges;
  for(const edge of edges){
    const sn=getNode(edge.startId),en=getNode(edge.endId);
    if(!sn||!en)continue;
    const sx=sn.x+sn.w/2,sy=sn.y+sn.h/2,ex=en.x+en.w/2,ey=en.y+en.h/2;
    const{cx,cy}=edgeCtrlPt(sx,sy,ex,ey,edge.curve||0);
    const tol=8/cam.zoom;
    // Fast AABB pre-reject
    const minX=Math.min(sx,cx,ex)-tol,maxX=Math.max(sx,cx,ex)+tol;
    const minY=Math.min(sy,cy,ey)-tol,maxY=Math.max(sy,cy,ey)+tol;
    if(wx<minX||wx>maxX||wy<minY||wy>maxY)continue;
    // Adaptive subdivision: only subdivide segments that are close enough
    // Start coarse (8 segs), refine near-candidates to 32
    let hit=false;
    const coarse=8;
    for(let i=0;i<coarse&&!hit;i++){
      const t0=i/coarse,t1=(i+1)/coarse;
      const p0=bezierPt(sx,sy,cx,cy,ex,ey,t0);
      const p1=bezierPt(sx,sy,cx,cy,ex,ey,t1);
      // Quick segment-to-point distance
      const dx=p1.x-p0.x,dy=p1.y-p0.y;
      const lenSq=dx*dx+dy*dy;
      let t=lenSq>0?((wx-p0.x)*dx+(wy-p0.y)*dy)/lenSq:0;
      t=Math.max(0,Math.min(1,t));
      const nx=p0.x+t*dx-wx,ny=p0.y+t*dy-wy;
      if(nx*nx+ny*ny<=tol*tol){
        // Refine with 4 sub-segments
        for(let j=0;j<4&&!hit;j++){
          const st0=t0+j*(t1-t0)/4,st1=t0+(j+1)*(t1-t0)/4;
          const q0=bezierPt(sx,sy,cx,cy,ex,ey,st0);
          const q1=bezierPt(sx,sy,cx,cy,ex,ey,st1);
          const qx=q1.x-q0.x,qy=q1.y-q0.y,qLen=qx*qx+qy*qy;
          let qt=qLen>0?((wx-q0.x)*qx+(wy-q0.y)*qy)/qLen:0;
          qt=Math.max(0,Math.min(1,qt));
          const rx=q0.x+qt*qx-wx,ry=q0.y+qt*qy-wy;
          if(rx*rx+ry*ry<=tol*tol)hit=true;
        }
      }
    }
    if(hit)return edge;
  }
  return null;
}

function hitFrame(wx,wy){
  const frames=curLayer().frames||[];
  for(let i=frames.length-1;i>=0;i--){
    const f=frames[i];
    const tbH=24/cam.zoom;
    // Only hit on title bar or border (not interior — nodes need to be clickable)
    const onTitleBar=wx>=f.x&&wx<=f.x+f.w&&wy>=f.y&&wy<=f.y+tbH;
    const borderTol=8/cam.zoom;
    const onBorder=wx>=f.x-borderTol&&wx<=f.x+f.w+borderTol&&wy>=f.y-borderTol&&wy<=f.y+f.h+borderTol
      &&!(wx>=f.x+borderTol&&wx<=f.x+f.w-borderTol&&wy>=f.y+borderTol&&wy<=f.y+f.h-borderTol);
    if(onTitleBar||onBorder)return f;
  }
  return null;
}

// =====================================================
// WAYPOINT SHIFT HELPERS
// =====================================================
// When nodes with associated waypoints move, shift the waypoints' camera positions
// so they still point at the same content. dx/dy are world-space deltas.
function shiftWaypointsForNodes(movedNodeIds, dx, dy){
  if(!movedNodeIds||!movedNodeIds.length||(!dx&&!dy))return;
  const idSet=new Set(movedNodeIds);
  waypoints.forEach(wp=>{
    // A waypoint moves with the drag if:
    //  (a) it has spotlightNodeIds that include one of the moved nodes, OR
    //  (b) it has NO spotlightNodeIds (it was placed with the Pin tool and has a
    //      worldX/worldY anchor) — in that case we check whether its world anchor
    //      sits inside any moved node's bounding box (center-point proximity check).
    const hasSpotlight=wp.spotlightNodeIds&&wp.spotlightNodeIds.length>0;
    const spotlightMatch=hasSpotlight&&wp.spotlightNodeIds.some(id=>idSet.has(id));
    // For pin-only waypoints, treat them as tied to nearby content by checking
    // if ANY of the dragged nodes contain the pin's world position.
    let pinMatch=false;
    if(!hasSpotlight&&wp.worldX!==undefined){
      const pwx=wp.worldX,pwy=wp.worldY;
      pinMatch=movedNodeIds.some(id=>{
        const n=getNode(id);
        return n&&pwx>=n.x&&pwx<=n.x+n.w&&pwy>=n.y&&pwy<=n.y+n.h;
      });
    }
    if(spotlightMatch||pinMatch){
      wp.camX+=dx*cam.zoom;
      wp.camY+=dy*cam.zoom;
      if(wp.worldX!==undefined)wp.worldX+=dx;
      if(wp.worldY!==undefined)wp.worldY+=dy;
    }
  });
}
let _frameDragLastDx=0,_frameDragLastDy=0;

