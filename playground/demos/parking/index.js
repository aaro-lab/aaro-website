import { setupCanvas, pointInPolygon as pip, registerDemo } from '../shared.js';

export function init(cell) {
  const canvas = cell.querySelector('canvas');
  const metricsEl = cell.querySelector('.pg-cell__metrics');
  if (!canvas) return;
  let ctx, W, H, dragIdx = -1, hovIdx = -1;
  let vpCx = 40, vpCy = 40, vpZoom = 0.85, panning = false, panLX = 0, panLY = 0;

  const bdy = [{x:8,y:6},{x:6,y:52},{x:24,y:70},{x:56,y:68},{x:72,y:44},{x:66,y:10}];
  const SW = 2.5, SD = 5.0, AW = 6.0;
  const SPACE_H = 6.0;
  const ROAD_CL = 8, INNER_OFF = 11;

  let allStalls = [], innerBdyPoly = [], roadClPoly = [], spineSegs = [];

  function w2s(x,y){const s=Math.min(W,H)*vpZoom/80;return{x:W/2+(x-vpCx)*s,y:H/2+(y-vpCy)*s};}
  function s2w(x,y){const s=Math.min(W,H)*vpZoom/80;return{x:vpCx+(x-W/2)/s,y:vpCy+(y-H/2)/s};}
  function resize(){const s=setupCanvas(canvas);W=s.w;H=s.h;ctx=s.ctx;compute();}
  function pArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=p[i].x*p[j].y-p[j].x*p[i].y;return Math.abs(a)/2;}

  function scalePoly(poly,s){
    const cx=poly.reduce((a,p)=>a+p.x,0)/poly.length;
    const cy=poly.reduce((a,p)=>a+p.y,0)/poly.length;
    return poly.map(p=>({x:cx+(p.x-cx)*s,y:cy+(p.y-cy)*s}));
  }

  function segX(a1,a2,b1,b2){
    const d1x=a2.x-a1.x,d1y=a2.y-a1.y,d2x=b2.x-b1.x,d2y=b2.y-b1.y;
    const den=d1x*d2y-d1y*d2x;
    if(Math.abs(den)<1e-10)return false;
    const t=((b1.x-a1.x)*d2y-(b1.y-a1.y)*d2x)/den;
    const u=((b1.x-a1.x)*d1y-(b1.y-a1.y)*d1x)/den;
    return t>0.002&&t<0.998&&u>0.002&&u<0.998;
  }

  function polyOverlap(a,b){
    for(const p of a)if(pip(p.x,p.y,b))return true;
    for(const p of b)if(pip(p.x,p.y,a))return true;
    for(let i=0;i<a.length;i++){
      const a1=a[i],a2=a[(i+1)%a.length];
      for(let j=0;j<b.length;j++){
        if(segX(a1,a2,b[j],b[(j+1)%b.length]))return true;
      }
    }
    return false;
  }

  function mkSpot(ox,oy,tx,ty,nx,ny){
    return[{x:ox,y:oy},{x:ox+tx*SW,y:oy+ty*SW},
           {x:ox+tx*SW+nx*SD,y:oy+ty*SW+ny*SD},{x:ox+nx*SD,y:oy+ny*SD}];
  }
  function mkSpace(ox,oy,tx,ty,nx,ny){
    return[{x:ox,y:oy},{x:ox+tx*SW,y:oy+ty*SW},
           {x:ox+tx*SW+nx*SPACE_H,y:oy+ty*SW+ny*SPACE_H},{x:ox+nx*SPACE_H,y:oy+ny*SPACE_H}];
  }

  function offsetPoly(poly,dist){
    const n=poly.length,cx=poly.reduce((s,v)=>s+v.x,0)/n,cy=poly.reduce((s,v)=>s+v.y,0)/n,r=[];
    for(let i=0;i<n;i++){
      const prev=poly[(i-1+n)%n],curr=poly[i],next=poly[(i+1)%n];
      const e1x=curr.x-prev.x,e1y=curr.y-prev.y,e2x=next.x-curr.x,e2y=next.y-curr.y;
      const l1=Math.hypot(e1x,e1y)||1,l2=Math.hypot(e2x,e2y)||1;
      let n1x=-e1y/l1,n1y=e1x/l1,n2x=-e2y/l2,n2y=e2x/l2;
      if(n1x*(cx-curr.x)+n1y*(cy-curr.y)<0){n1x=-n1x;n1y=-n1y;}
      if(n2x*(cx-curr.x)+n2y*(cy-curr.y)<0){n2x=-n2x;n2y=-n2y;}
      let bx=n1x+n2x,by=n1y+n2y;const bl=Math.hypot(bx,by)||1;bx/=bl;by/=bl;
      const d=n1x*bx+n1y*by,m=d>0.1?Math.abs(dist)/d:Math.abs(dist);
      const sg=dist<0?1:-1;
      r.push({x:curr.x+bx*m*sg,y:curr.y+by*m*sg});
    }
    return r;
  }

  function edgeNormal(verts,i){
    const n=verts.length,j=(i+1)%n,a=verts[i],b=verts[j];
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<0.01)return null;
    const tx=dx/len,ty=dy/len;
    const cx=verts.reduce((s,v)=>s+v.x,0)/n,cy=verts.reduce((s,v)=>s+v.y,0)/n;
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    let nx=-ty,ny=tx;
    if((mx+nx-cx)**2+(my+ny-cy)**2>(mx-nx-cx)**2+(my-ny-cy)**2){nx=-nx;ny=-ny;}
    return{tx,ty,nx,ny,len};
  }

  // Spatial hash grid for O(n) broad-phase collision
  const CELL_SZ = 6;
  function spatialHash(polys) {
    const grid = new Map();
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (const pt of p) { minX=Math.min(minX,pt.x);minY=Math.min(minY,pt.y);maxX=Math.max(maxX,pt.x);maxY=Math.max(maxY,pt.y); }
      const x0=Math.floor(minX/CELL_SZ),x1=Math.floor(maxX/CELL_SZ);
      const y0=Math.floor(minY/CELL_SZ),y1=Math.floor(maxY/CELL_SZ);
      for (let cx=x0;cx<=x1;cx++) for (let cy=y0;cy<=y1;cy++) {
        const k=cx+','+cy;
        if (!grid.has(k)) grid.set(k,[]);
        grid.get(k).push(i);
      }
    }
    return grid;
  }
  function querySpatial(grid, poly) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (const pt of poly) { minX=Math.min(minX,pt.x);minY=Math.min(minY,pt.y);maxX=Math.max(maxX,pt.x);maxY=Math.max(maxY,pt.y); }
    const x0=Math.floor(minX/CELL_SZ),x1=Math.floor(maxX/CELL_SZ);
    const y0=Math.floor(minY/CELL_SZ),y1=Math.floor(maxY/CELL_SZ);
    const hits = new Set();
    for (let cx=x0;cx<=x1;cx++) for (let cy=y0;cy<=y1;cy++) {
      const arr=grid.get(cx+','+cy);
      if (arr) for (const idx of arr) hits.add(idx);
    }
    return hits;
  }

  function greedySpot(spots){
    if(spots.length<2)return spots;
    const sc=spots.map(s=>scalePoly(s.poly,0.99));
    const grid=spatialHash(sc);
    const pairs=[];
    for(let i=0;i<spots.length;i++){
      const candidates=querySpatial(grid,sc[i]);
      for(const j of candidates){
        if(j<=i)continue;
        if(spots[i].edge!==undefined&&spots[j].edge!==undefined&&spots[i].edge===spots[j].edge)continue;
        if(polyOverlap(sc[i],sc[j]))pairs.push([i,j]);
      }
    }
    if(!pairs.length)return spots;
    const rm=new Set();let act=[...pairs];
    while(act.length){
      act=act.filter(([i,j])=>!rm.has(i)&&!rm.has(j));if(!act.length)break;
      const cnt=new Map();for(const[i,j]of act){cnt.set(i,(cnt.get(i)||0)+1);cnt.set(j,(cnt.get(j)||0)+1);}
      let w=-1,wc=0;for(const[k,v]of cnt)if(v>wc){wc=v;w=k;}rm.add(w);
    }
    return spots.filter((_,i)=>!rm.has(i));
  }

  function greedySpace(spots){
    if(spots.length<2)return spots;
    const sp98=spots.map(s=>scalePoly(s.poly,0.98));
    const sc98=spots.map(s=>scalePoly(s.space,0.98));
    const grid=spatialHash(sp98);
    const pairs=[];
    for(let i=0;i<spots.length;i++){
      const candidates=querySpatial(grid,sc98[i]);
      for(const j of candidates){
        if(i===j)continue;
        if(polyOverlap(sc98[i],sp98[j]))pairs.push([i,j]);
      }
    }
    if(!pairs.length)return spots;
    const rm=new Set();let act=[...pairs];
    while(act.length){
      act=act.filter(([i,j])=>!rm.has(i)&&!rm.has(j));if(!act.length)break;
      const cnt=new Map();for(const[i]of act)cnt.set(i,(cnt.get(i)||0)+1);
      let w=-1,wc=0;for(const[k,v]of cnt)if(v>wc){wc=v;w=k;}rm.add(w);
    }
    return spots.filter((_,i)=>!rm.has(i));
  }

  function mkLane(s){
    const p=s.poly;
    const dx=p[3].x-p[0].x,dy=p[3].y-p[0].y,len=Math.hypot(dx,dy)||1;
    const nx=dx/len,ny=dy/len;
    return[p[3],p[2],{x:p[2].x+nx*AW,y:p[2].y+ny*AW},{x:p[3].x+nx*AW,y:p[3].y+ny*AW}];
  }

  function cleanLanes(spots){
    let d=true;
    while(d){d=false;
      for(let i=0;i<spots.length&&!d;i++){
        const lane=mkLane(spots[i]);
        for(let j=0;j<spots.length&&!d;j++){
          if(i===j)continue;
          if(spots[i].edge!==undefined&&spots[j].edge!==undefined&&spots[i].edge===spots[j].edge)continue;
          if(polyOverlap(lane,spots[j].poly)){spots.splice(i,1);d=true;}
        }
      }
    }
    return spots;
  }

  function allInside(poly,boundary){return poly.every(p=>pip(p.x,p.y,boundary));}

  function compute(){
    allStalls=[];spineSegs=[];
    roadClPoly=offsetPoly(bdy,-ROAD_CL);
    innerBdyPoly=offsetPoly(bdy,-INNER_OFF);
    const bdyBuf=offsetPoly(bdy,0.1);
    const innerBuf=offsetPoly(bdy,-(INNER_OFF-0.1));

    // Edge parking
    let edgeSpots=[];
    for(let seg=0;seg<bdy.length;seg++){
      const en=edgeNormal(bdy,seg);
      if(!en||en.len<SW)continue;
      const a=bdy[seg];

      const offsets=new Set([0]);
      for(let s=1;s<=10;s++){
        offsets.add(s*0.25);
        const rem=en.len%SW;
        if(rem>0.01){
          const rv=rem+s*0.25;if(rv<=SW&&rv>=0)offsets.add(rv);
          const rv2=rem-s*0.25;if(rv2>=0)offsets.add(rv2);
        }
      }

      let bestTrial=[];
      for(const offset of offsets){
        if(offset<0||offset>en.len)continue;
        const nS=Math.floor((en.len-offset)/SW);
        if(nS<1)continue;
        const trial=[];
        for(let i=0;i<nS;i++){
          const d=offset+i*SW;
          const ox=a.x+en.tx*d,oy=a.y+en.ty*d;
          const poly=mkSpot(ox,oy,en.tx,en.ty,en.nx,en.ny);
          const space=mkSpace(ox,oy,en.tx,en.ty,en.nx,en.ny);
          if(!allInside(poly,bdyBuf))continue;
          if(!allInside(space,bdyBuf))continue;
          trial.push({poly,space,edge:seg,type:'edge'});
        }
        if(trial.length>bestTrial.length)bestTrial=trial;
      }
      edgeSpots.push(...bestTrial);
    }

    edgeSpots=greedySpot(edgeSpots);
    edgeSpots=greedySpace(edgeSpots);
    edgeSpots=cleanLanes(edgeSpots);

    // Spine: road centerline (closed loop)
    if(roadClPoly.length>=3){
      for(let i=0;i<roadClPoly.length;i++)
        spineSegs.push([roadClPoly[i],roadClPoly[(i+1)%roadClPoly.length]]);
    }

    // Inner parking
    let innerSpots=[];
    if(innerBdyPoly.length>=3&&pArea(innerBdyPoly)>60){
      const dirs=[],seen=new Set();
      for(let i=0;i<innerBdyPoly.length;i++){
        const j=(i+1)%innerBdyPoly.length;
        const dx=innerBdyPoly[j].x-innerBdyPoly[i].x,dy=innerBdyPoly[j].y-innerBdyPoly[i].y;
        const len=Math.hypot(dx,dy);if(len<2)continue;
        const ang=Math.round(((Math.atan2(dy,dx)*180/Math.PI)%180+180)%180/5)*5;
        if(!seen.has(ang)){seen.add(ang);dirs.push({tx:dx/len,ty:dy/len});}
      }
      for(const b of[0,45,90,135]){
        if(!seen.has(b)){seen.add(b);const rad=b*Math.PI/180;dirs.push({tx:Math.cos(rad),ty:Math.sin(rad)});}
      }

      const rowSp=SD*2+AW;
      let bestInner=[],bestAisles=[];

      for(const dir of dirs){
        const pd={x:-dir.ty,y:dir.tx};
        let minP=Infinity,maxP=-Infinity,minR=Infinity,maxR=-Infinity;
        for(const v of innerBdyPoly){
          const r=v.x*dir.tx+v.y*dir.ty,p=v.x*pd.x+v.y*pd.y;
          minP=Math.min(minP,p);maxP=Math.max(maxP,p);
          minR=Math.min(minR,r);maxR=Math.max(maxR,r);
        }

        for(let shift=0;shift<SD;shift+=0.5){
          const ti=[],ta=[];
          for(let p=minP+SD+shift;p+SD<maxP;p+=rowSp){
            const acP=p+SD+AW/2;
            ta.push({
              a:{x:dir.tx*minR+pd.x*acP,y:dir.ty*minR+pd.y*acP},
              b:{x:dir.tx*maxR+pd.x*acP,y:dir.ty*maxR+pd.y*acP}
            });

            for(let r=minR;r<maxR;r+=SW){
              const o1x=dir.tx*r+pd.x*p,o1y=dir.ty*r+pd.y*p;
              const p1=mkSpot(o1x,o1y,dir.tx,dir.ty,pd.x,pd.y);
              if(allInside(p1,innerBuf)){
                const s1=mkSpace(o1x,o1y,dir.tx,dir.ty,pd.x,pd.y);
                ti.push({poly:p1,space:s1,type:'inner'});
              }
              const o2x=dir.tx*r+pd.x*(p+SD+AW+SD),o2y=dir.ty*r+pd.y*(p+SD+AW+SD);
              const p2=mkSpot(o2x,o2y,dir.tx,dir.ty,-pd.x,-pd.y);
              if(allInside(p2,innerBuf)){
                const s2=mkSpace(o2x,o2y,dir.tx,dir.ty,-pd.x,-pd.y);
                ti.push({poly:p2,space:s2,type:'inner'});
              }
            }
          }
          if(ti.length>bestInner.length){bestInner=ti;bestAisles=ta;}
        }
      }

      const combined=[...edgeSpots,...bestInner];
      const after1=greedySpot(combined);
      const after2=greedySpace(after1);
      edgeSpots=after2.filter(s=>s.type==='edge');
      innerSpots=after2.filter(s=>s.type==='inner');

      for(const a of bestAisles){
        const dx=a.b.x-a.a.x,dy=a.b.y-a.a.y,ts=[];
        for(let i=0;i<innerBdyPoly.length;i++){
          const j=(i+1)%innerBdyPoly.length;
          const ex=innerBdyPoly[j].x-innerBdyPoly[i].x,ey=innerBdyPoly[j].y-innerBdyPoly[i].y;
          const den=dx*ey-dy*ex;
          if(Math.abs(den)<1e-10)continue;
          const t=((innerBdyPoly[i].x-a.a.x)*ey-(innerBdyPoly[i].y-a.a.y)*ex)/den;
          const u=((innerBdyPoly[i].x-a.a.x)*dy-(innerBdyPoly[i].y-a.a.y)*dx)/den;
          if(t>=0&&t<=1&&u>=0&&u<=1)ts.push(t);
        }
        if(ts.length>=2){
          ts.sort((a,b)=>a-b);
          spineSegs.push([{x:a.a.x+dx*ts[0],y:a.a.y+dy*ts[0]},{x:a.a.x+dx*ts[ts.length-1],y:a.a.y+dy*ts[ts.length-1]}]);
        }
      }
    }

    allStalls=[...edgeSpots,...innerSpots];
  }

  function drawStallU(stall){
    const p=stall.poly;
    const dx=p[3].x-p[0].x,dy=p[3].y-p[0].y,len=Math.hypot(dx,dy)||1;
    const nx=dx/len,ny=dy/len;
    const al=[p[3],p[2],
      {x:p[2].x+nx*AW,y:p[2].y+ny*AW},
      {x:p[3].x+nx*AW,y:p[3].y+ny*AW}];
    ctx.beginPath();
    const a0=w2s(al[0].x,al[0].y);ctx.moveTo(a0.x,a0.y);
    for(let k=1;k<4;k++){const ap=w2s(al[k].x,al[k].y);ctx.lineTo(ap.x,ap.y);}
    ctx.closePath();
    ctx.fillStyle='rgba(220,160,50,0.08)';ctx.fill();
    ctx.strokeStyle='rgba(220,160,50,0.20)';ctx.lineWidth=0.5;ctx.stroke();
    ctx.beginPath();
    const p0=w2s(p[0].x,p[0].y);ctx.moveTo(p0.x,p0.y);
    for(let k=1;k<4;k++){const pp=w2s(p[k].x,p[k].y);ctx.lineTo(pp.x,pp.y);}
    ctx.closePath();
    ctx.strokeStyle='rgba(255,255,255,0.85)';ctx.lineWidth=1;ctx.stroke();
  }

  function draw(){
    if(!W)return;
    ctx.clearRect(0,0,W,H);
    ctx.font="500 9px 'IBM Plex Mono',monospace";ctx.fillStyle='rgba(255,255,255,0.25)';ctx.fillText('PARKING LAYOUT',8,14);

    ctx.strokeStyle='rgba(255,255,255,0.03)';ctx.lineWidth=0.5;
    for(let x=0;x<=80;x+=10){const p1=w2s(x,0),p2=w2s(x,80);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();}
    for(let y=0;y<=80;y+=10){const p1=w2s(0,y),p2=w2s(80,y);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();}

    ctx.save();ctx.setLineDash([6,4]);ctx.strokeStyle='rgba(220,160,50,0.65)';ctx.lineWidth=1.2;
    for(const[a,b]of spineSegs){const p1=w2s(a.x,a.y),p2=w2s(b.x,b.y);ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.stroke();}
    ctx.setLineDash([]);ctx.restore();

    for(const s of allStalls)drawStallU(s);

    ctx.beginPath();bdy.forEach((v,i)=>{const p=w2s(v.x,v.y);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);});ctx.closePath();
    ctx.fillStyle='rgba(255,255,255,0.015)';ctx.fill();
    ctx.strokeStyle='rgba(140,140,140,0.45)';ctx.lineWidth=1;ctx.stroke();

    for(let i=0;i<bdy.length;i++){const j=(i+1)%bdy.length,a=w2s(bdy[i].x,bdy[i].y),b=w2s(bdy[j].x,bdy[j].y),len=Math.hypot(bdy[j].x-bdy[i].x,bdy[j].y-bdy[i].y),mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y,nl=Math.hypot(dx,dy)||1;ctx.font="400 8px 'IBM Plex Mono',monospace";ctx.fillStyle='rgba(255,255,255,0.30)';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(len.toFixed(1)+'m',mx+(-dy/nl)*14,my+(dx/nl)*14);}

    for(let i=0;i<bdy.length;i++){const p=w2s(bdy[i].x,bdy[i].y),isH=hovIdx===i,isD=dragIdx===i;ctx.beginPath();ctx.arc(p.x,p.y,isH||isD?7:5,0,Math.PI*2);ctx.fillStyle=isD?'#C4773C':isH?'#E8944A':'#fff';ctx.fill();}

    const aM=pArea(bdy),eC=allStalls.filter(s=>s.type==='edge').length,iC=allStalls.length-eC;
    metricsEl.textContent=`Edge: ${eC}  |  Inner: ${iC}  |  Total: ${allStalls.length}  |  Area: ${aM.toFixed(0)} m\u00B2  |  Eff: ${(aM>0?(allStalls.length*SW*SD/aM*100):0).toFixed(1)}%`;
  }

  // Interaction
  function hit(mx,my){for(let i=0;i<bdy.length;i++){const p=w2s(bdy[i].x,bdy[i].y);if(Math.hypot(mx-p.x,my-p.y)<14)return i;}return-1;}
  canvas.addEventListener('mousemove',e=>{const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;if(dragIdx>=0){const w=s2w(mx,my);bdy[dragIdx].x=w.x;bdy[dragIdx].y=w.y;compute();return;}if(panning){const s=Math.min(W,H)*vpZoom/80;vpCx-=(e.clientX-panLX)/s;vpCy-=(e.clientY-panLY)/s;panLX=e.clientX;panLY=e.clientY;return;}hovIdx=hit(mx,my);canvas.style.cursor=hovIdx>=0?'pointer':'default';});
  canvas.addEventListener('mousedown',e=>{const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;dragIdx=hit(mx,my);if(dragIdx>=0){canvas.style.cursor='grabbing';e.preventDefault();}else{panning=true;panLX=e.clientX;panLY=e.clientY;canvas.style.cursor='move';e.preventDefault();}});
  canvas.addEventListener('mouseup',()=>{dragIdx=-1;panning=false;canvas.style.cursor='default';});
  canvas.addEventListener('mouseleave',()=>{dragIdx=-1;panning=false;hovIdx=-1;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();vpZoom*=e.deltaY>0?0.92:1.08;vpZoom=Math.max(0.3,Math.min(5,vpZoom));},{passive:false});
  canvas.addEventListener('dblclick',e=>{const rect=canvas.getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;const idx=hit(mx,my);if(idx>=0&&bdy.length>3){bdy.splice(idx,1);compute();return;}if(idx<0){const w=s2w(mx,my);let bD=Infinity,bE=0;for(let i=0;i<bdy.length;i++){const j=(i+1)%bdy.length,a=bdy[i],b=bdy[j],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((w.x-a.x)*dx+(w.y-a.y)*dy)/(dx*dx+dy*dy))),d=Math.hypot(w.x-(a.x+t*dx),w.y-(a.y+t*dy));if(d<bD){bD=d;bE=i;}}bdy.splice(bE+1,0,w);compute();}});
  canvas.addEventListener('touchstart',e=>{const t=e.touches[0],rect=canvas.getBoundingClientRect();dragIdx=hit(t.clientX-rect.left,t.clientY-rect.top);if(dragIdx>=0)e.preventDefault();},{passive:false});
  canvas.addEventListener('touchmove',e=>{if(dragIdx<0)return;const t=e.touches[0],rect=canvas.getBoundingClientRect(),w=s2w(t.clientX-rect.left,t.clientY-rect.top);bdy[dragIdx].x=w.x;bdy[dragIdx].y=w.y;compute();e.preventDefault();},{passive:false});
  canvas.addEventListener('touchend',()=>{dragIdx=-1;});

  // Auto-drift
  const orig=bdy.map(v=>({x:v.x,y:v.y}));
  const dt=bdy.map(()=>({dx:0,dy:0}));
  function pickD(i){dt[i].dx=(Math.random()-0.5)*25;dt[i].dy=(Math.random()-0.5)*25;}
  bdy.forEach((_,i)=>pickD(i));
  let dState='moving',pTimer=0,driftFrames=0;
  const RECOMPUTE_INTERVAL = 8;

  resize();window.addEventListener('resize',resize);
  registerDemo(cell, ()=>{
    if(dragIdx<0&&!panning){
      if(dState==='paused'){pTimer+=0.016;if(pTimer>=3){dState='moving';driftFrames=0;bdy.forEach((_,i)=>{if(i<orig.length)pickD(i);});compute();}}
      else{
        let allOk=true;
        bdy.forEach((v,i)=>{if(i>=orig.length)return;const tx=Math.max(6,Math.min(74,orig[i].x+dt[i].dx)),ty=Math.max(6,Math.min(74,orig[i].y+dt[i].dy));v.x+=(tx-v.x)*0.04;v.y+=(ty-v.y)*0.04;if(Math.abs(v.x-tx)>0.5||Math.abs(v.y-ty)>0.5)allOk=false;});
        driftFrames++;
        if(driftFrames%RECOMPUTE_INTERVAL===0)compute();
        if(allOk){dState='paused';pTimer=0;compute();}
      }
    }
    draw();
  });
}
