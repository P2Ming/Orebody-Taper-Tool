// Geometry uses Float64 coordinates throughout. Only the centered preview is Float32.
const add = (a,b) => a.map((x,i)=>x+b[i]);
const sub = (a,b) => a.map((x,i)=>x-b[i]);
const mul = (a,k) => a.map(x=>x*k);
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.hypot(...a);
const unit = a => { const n=norm(a); return n>0 ? mul(a,1/n) : [0,0,0]; };
const average = a => a.length ? mul(a.reduce((s,p)=>add(s,p),[0,0,0]),1/a.length) : [0,0,0];
const edgeKey = (a,b) => a<b ? `${a}:${b}` : `${b}:${a}`;
const number = s => Number(String(s).replace(/[dD]/g,'e'));
const isId = x => Number.isSafeInteger(x) && x>0;

export function parseTSurf(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/^\uFEFF/,'').split(/\r?\n/);
  const objects=[], parts=[];
  let object=null, part=null, other=false;
  const newPart = (line, explicit=true) => {
    part={id:`part-${parts.length+1}`,objectIndex:objects.length-1,faceIndex:object.parts.length+1,
      line,insertAt:line+1,triangles:[],errors:[],explicit};
    object.parts.push(part); parts.push(part); return part;
  };
  for(let i=0;i<lines.length;i++) {
    const raw=lines[i], s=raw.trim();
    if(/^GOCAD\s+/i.test(s)) {
      if(object) throw new Error(`第 ${i+1} 行：上一个 TSurf 缺少 END。`);
      other=!/^GOCAD\s+TSurf\b/i.test(s);
      part=null;
      if(!other) { object={index:objects.length,name:`TSurf ${objects.length+1}`,vertices:new Map(),atoms:new Map(),parts:[],errors:[],start:i,properties:[],noData:[],zpositive:'Elevation'}; objects.push(object); }
      continue;
    }
    if(/^END\s*$/i.test(s)) {
      if(object) object.end=i;
      object=null;part=null;other=false;continue;
    }
    if(!object || other || !s || s.startsWith('#')) continue;
    const name=raw.match(/^\s*name\s*:\s*(.*)/i);
    if(name) object.name=name[1].trim().replace(/^"|"$/g,'') || object.name;
    const zpos=s.match(/^ZPOSITIVE\s+(.+)/i); if(zpos) object.zpositive=zpos[1];
    if(/^PROPERTIES\s/i.test(s)) object.properties=s.split(/\s+/).slice(1);
    if(/^NO_DATA_VALUES\s/i.test(s)) object.noData=s.split(/\s+/).slice(1);
    if(/^TFACE\b/i.test(s)) { newPart(i); continue; }
    const t=s.split(/\s+/), cmd=t[0].toUpperCase();
    if(cmd==='VRTX' || cmd==='PVRTX') {
      const id=number(t[1]), p=t.slice(2,5).map(number);
      if(!isId(id) || p.length!==3 || !p.every(Number.isFinite)) { object.errors.push(`第 ${i+1} 行：顶点格式或坐标无效`); continue; }
      if(object.vertices.has(id)||object.atoms.has(id)) object.errors.push(`顶点编号 ${id} 重复`);
      object.vertices.set(id,{id,p,props:cmd==='PVRTX'?t.slice(5):[],type:cmd});
      if(part) part.insertAt=i+1;
    } else if(cmd==='ATOM') {
      const id=number(t[1]),ref=number(t[2]);
      if(!isId(id)||!isId(ref)||object.vertices.has(id)||object.atoms.has(id)) object.errors.push(`第 ${i+1} 行：ATOM 编号无效或重复`);
      else object.atoms.set(id,ref);
      if(part) part.insertAt=i+1;
    } else if(cmd==='TRGL') {
      if(!part) newPart(i,false);
      const tri=t.slice(1,4).map(number);
      if(tri.length!==3 || !tri.every(isId)) part.errors.push(`第 ${i+1} 行：TRGL 格式无效`);
      else part.triangles.push(tri);
      part.insertAt=i+1;
    }
  }
  if(object) throw new Error('TSurf 缺少 END，无法安全导出。');
  if(!objects.length || !parts.length) throw new Error('文件内未找到包含网格的 GOCAD TSurf / TFACE。');
  for(const obj of objects) {
    const resolve = (id,trail=new Set()) => {
      if(obj.vertices.has(id)) return obj.vertices.get(id);
      if(!obj.atoms.has(id)||trail.has(id)) return null;
      trail.add(id); const v=resolve(obj.atoms.get(id),trail);
      if(v) { const alias={...v,id}; obj.vertices.set(id,alias);return alias; }
      return null;
    };
    for(const [id] of obj.atoms) if(!resolve(id)) obj.errors.push(`ATOM ${id} 引用了缺失顶点或存在循环`);
    obj.maxId=0; for(const id of obj.vertices.keys()) obj.maxId=Math.max(obj.maxId,id);
    if(obj.maxId>Number.MAX_SAFE_INTEGER-10000000) obj.errors.push('顶点编号过大，无法安全分配新增编号');
    for(const p of obj.parts) {
      p.name=obj.parts.length>1 ? `${obj.name} · Part ${p.faceIndex}` : obj.name;
      p.errors.push(...obj.errors); p.vertices=obj.vertices;
    }
  }
  return {lines,newline,bom:text.startsWith('\uFEFF'),objects,parts};
}

export function inspectMesh(vertices,triangles) {
  const edges=new Map(),adj=new Map(),used=new Set(),errors=[],seen=new Set();
  let degenerate=0,missing=0,duplicates=0;
  let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const tri of triangles) for(const id of tri) {
    const v=vertices.get(id); if(!v) continue;
    if(!used.has(id)) for(let k=0;k<3;k++){ min[k]=Math.min(min[k],v.p[k]);max[k]=Math.max(max[k],v.p[k]); }
    used.add(id);if(!adj.has(id)) adj.set(id,new Set());
  }
  const extent=used.size?norm(sub(max,min)):0;
  if(!Number.isFinite(extent))errors.push('坐标数值范围过大，无法可靠计算网格尺度');
  // Relative area tolerance, independent of map-coordinate offset.
  const areaTolerance=Math.max(extent*extent*1e-14,Number.MIN_VALUE);
  for(const tri of triangles) {
    if(tri.some(id=>!vertices.has(id))) { missing++;continue; }
    if(new Set(tri).size!==3 || norm(cross(sub(vertices.get(tri[1]).p,vertices.get(tri[0]).p),sub(vertices.get(tri[2]).p,vertices.get(tri[0]).p)))<=areaTolerance) degenerate++;
    const key=[...tri].sort((a,b)=>a-b).join(':');if(seen.has(key)) duplicates++;seen.add(key);
    for(let j=0;j<3;j++) {
      const a=tri[j],b=tri[(j+1)%3],key=edgeKey(a,b);
      if(!edges.has(key)) edges.set(key,[]);
      edges.get(key).push([a,b]);adj.get(a).add(b);adj.get(b).add(a);
    }
  }
  const boundary=[],boundaryAdj=new Map();let nonManifold=0,winding=0;
  for(const uses of edges.values()) {
    if(uses.length>2) nonManifold++;
    if(uses.length===2 && uses[0][0]===uses[1][0]) winding++;
    if(uses.length===1) {
      const [a,b]=uses[0];boundary.push([a,b]);
      for(const [x,y] of [[a,b],[b,a]]) { if(!boundaryAdj.has(x)) boundaryAdj.set(x,[]);boundaryAdj.get(x).push(y); }
    }
  }
  const branch=[...boundaryAdj.values()].filter(v=>v.length!==2).length;
  const loops=[],visited=new Set();
  if(!branch) {
    const next=new Map(boundary.map(([a,b])=>[a,b]));
    for(const [start] of boundary) {
      if(visited.has(start)) continue;
      let cur=start;const loop=[];
      while(cur!==undefined&&!visited.has(cur)) { visited.add(cur);loop.push(cur);cur=next.get(cur); }
      if(cur===start && loop.length>=3) loops.push(loop);
      else errors.push('边界绕序不连续');
    }
  }
  let components=0;const visitedVertices=new Set();
  for(const id of used) if(!visitedVertices.has(id)) {
    components++;const queue=[id];visitedVertices.add(id);
    for(let q=0;q<queue.length;q++) for(const n of adj.get(queue[q])||[]) if(!visitedVertices.has(n)) { visitedVertices.add(n);queue.push(n); }
  }
  // Vertex-link test detects pinched vertices that edge incidence alone misses.
  const links=new Map();
  for(const tri of triangles) if(tri.every(id=>vertices.has(id))) for(let i=0;i<3;i++) {
    const id=tri[i],a=tri[(i+1)%3],b=tri[(i+2)%3];
    if(!links.has(id)) links.set(id,new Map()); const link=links.get(id);
    if(!link.has(a))link.set(a,new Set());if(!link.has(b))link.set(b,new Set());link.get(a).add(b);link.get(b).add(a);
  }
  let nonManifoldVertices=0;
  for(const [id,link] of links) {
    const keys=[...link.keys()],vset=new Set(keys.slice(0,1)),q=keys.slice(0,1);
    for(let i=0;i<q.length;i++)for(const n of link.get(q[i]))if(!vset.has(n)){vset.add(n);q.push(n);}
    const ends=[...link.values()].filter(v=>v.size===1).length;
    const badDegree=[...link.values()].some(v=>v.size<1||v.size>2);
    if(vset.size!==keys.length||badDegree||(boundaryAdj.has(id)?ends!==2:ends!==0))nonManifoldVertices++;
  }
  if(missing)errors.push(`${missing} 个三角形引用了缺失顶点`);
  if(degenerate)errors.push(`${degenerate} 个退化三角形`);
  if(duplicates)errors.push(`${duplicates} 个重复三角形`);
  if(nonManifold)errors.push(`${nonManifold} 条非流形边`);
  if(nonManifoldVertices)errors.push(`${nonManifoldVertices} 个非流形顶点`);
  if(winding)errors.push(`${winding} 条边的三角形绕序不一致`);
  if(branch)errors.push(`${branch} 个分叉或断裂边界顶点`);
  if(!triangles.length)errors.push('Part 不含三角形');
  const origin=used.size?mul(add(min,max),.5):[0,0,0];
  let signedVolume=0;
  for(const t of triangles) if(t.every(id=>vertices.has(id))) signedVolume+=dot(sub(vertices.get(t[0]).p,origin),cross(sub(vertices.get(t[1]).p,origin),sub(vertices.get(t[2]).p,origin)))/6;
  return {vertices:used.size,faces:triangles.length,edges:edges.size,boundaryEdges:boundary.length,loops,components,
    nonManifold,nonManifoldVertices,winding,degenerate,duplicates,missing,errors,valid:errors.length===0,
    closed:errors.length===0&&boundary.length===0&&triangles.length>0,euler:used.size-edges.size+triangles.length,
    signedVolume,extent,min,max,center:origin,adj,used,boundary};
}

export function findEnds(part,inspection) {
  const allBoundary=new Set(inspection.loops.flat());
  const ends=inspection.loops.map(loop => {
    const points=loop.map(id=>part.vertices.get(id).p),center=average(points);
    const radius=Math.sqrt(points.reduce((s,p)=>s+dot(sub(p,center),sub(p,center)),0)/points.length);
    // Walk inward along mesh connectivity; use an interior cross-section to estimate the local centerline.
    const seen=new Set(loop);let frontier=[...loop],inner=center,distance=0;
    for(let layer=0;layer<32;layer++) {
      const next=[];
      for(const id of frontier)for(const n of inspection.adj.get(id)||[])if(!seen.has(n)&&!allBoundary.has(n)){seen.add(n);next.push(n);}
      if(!next.length)break;
      const c=average(next.map(id=>part.vertices.get(id).p));const d=norm(sub(center,c));
      if(layer>0&&d<distance*.6)break;
      inner=c;distance=d;frontier=next;
      if(d>=radius*.75)break;
    }
    let direction=unit(sub(center,inner));let method='local';
    if(norm(direction)<.5) {
      const other=inspection.loops.filter(l=>l!==loop).flat();
      inner=other.length?average(other.map(id=>part.vertices.get(id).p)):inspection.center;
      direction=unit(sub(center,inner));method='fallback';
    }
    if(norm(direction)<.5) throw new Error('无法从端部邻域确定可靠的延伸方向');
    return {loop,center,radius,direction,method};
  });
  // Stable A/B labels follow X, then Y, then Z in original file coordinates.
  return ends.sort((a,b)=>a.center[0]-b.center[0]||a.center[1]-b.center[1]||a.center[2]-b.center[2]);
}

export function prepareDocument(doc) {
  for(const part of doc.parts) {
    part.inspection=inspectMesh(part.vertices,part.triangles);
    part.ends=[];
    if(!part.errors.length&&part.inspection.valid&&part.inspection.loops.length===2&&part.inspection.components===1) {
      try {part.ends=findEnds(part,part.inspection);}catch(e){part.errors.push(e.message);}
    }
    part.eligible=!part.errors.length&&part.ends.length===2;
    part.defaultLength=part.ends.length?Math.max(...part.ends.map(e=>e.radius*1.8),part.inspection.extent*.12):part.inspection.extent*.15;
  }
  return doc;
}

export function defaultConfig(part) {
  return {enabled:part.eligible,lengthA:Number(part.defaultLength.toPrecision(5)),lengthB:Number(part.defaultLength.toPrecision(5)),rings:8,exponent:1.25};
}

function validateConfig(config) {
  for(const k of ['lengthA','lengthB'])if(typeof config[k]!=='number'||!Number.isFinite(config[k])||config[k]<=0)throw new Error('两端尖灭长度必须是大于 0 的有限数值');
  if(!Number.isInteger(config.rings)||config.rings<1||config.rings>128)throw new Error('渐缩环数量必须为 1–128 的整数');
  if(typeof config.exponent!=='number'||!Number.isFinite(config.exponent)||config.exponent<.2||config.exponent>5)throw new Error('渐缩指数必须在 0.2–5 之间');
}

export function taperPart(part,config,startId,{validate=true}={}) {
  if(!config.enabled)return {vertices:part.vertices,triangles:part.triangles,addedVertices:[],addedTriangles:[],inspection:part.inspection,ends:part.ends};
  if(!part.eligible)throw new Error(`${part.name}：仅支持单个连通主体、两个简单开放端且拓扑有效的 Part`);
  validateConfig(config);
  const estimated=part.ends.reduce((n,e)=>n+e.loop.length*config.rings+1,0);
  if(estimated>2000000)throw new Error('新增网格超过 200 万顶点，请降低渐缩环数量');
  const vertices=new Map(part.vertices),triangles=[...part.triangles],addedVertices=[],addedTriangles=[],ends=[];
  let nextId=startId;
  const obj=part.object;
  const put=(p,props,type) => {
    if(!p.every(Number.isFinite))throw new Error('延伸长度导致坐标溢出，请缩短尖灭长度');
    const v={id:nextId++,p,props,type};vertices.set(v.id,v);addedVertices.push(v);return v.id;
  };
  const tri=t=>{triangles.push(t);addedTriangles.push(t);};
  part.ends.forEach((end,index) => {
    const customTip=config[index===0?'tipA':'tipB'];
    if(customTip!==undefined&&(!Array.isArray(customTip)||customTip.length!==3||!customTip.every(Number.isFinite)))throw new Error('尖端位置必须包含三个有限坐标');
    const tip=customTip?[...customTip]:add(end.center,mul(end.direction,index===0?config.lengthA:config.lengthB));
    const extension=sub(tip,end.center),length=norm(extension);
    if(dot(extension,end.direction)<=Math.max(part.inspection.extent*1e-7,Number.MIN_VALUE))throw new Error('尖端必须位于原始开放端的外侧');
    let previous=end.loop;
    for(let ring=1;ring<=config.rings;ring++) {
      const t=ring/(config.rings+1),scale=Math.pow(1-t,config.exponent);
      const center=add(end.center,mul(extension,t));
      const current=end.loop.map(id=>{
        const source=part.vertices.get(id);
        return put(add(center,mul(sub(source.p,end.center),scale)),[...source.props],source.type);
      });
      for(let j=0;j<previous.length;j++) {
        const k=(j+1)%previous.length,a=previous[j],b=previous[k],c=current[j],d=current[k];
        tri([b,a,c]);tri([b,c,d]);
      }
      previous=current;
    }
    const samples=end.loop.map(id=>part.vertices.get(id));
    const propCount=samples.reduce((n,v)=>Math.max(n,v.props.length),0);
    const props=Array.from({length:propCount},(_,i)=>{
      const values=samples.map(v=>v.props[i]);const nums=values.map(number),noData=obj?.noData[i];
      return nums.every(Number.isFinite)&&!values.some(v=>v===undefined||v===noData)?String(nums.reduce((a,b)=>a+b,0)/nums.length):(noData??values.find(v=>v!==undefined)??'-99999');
    });
    const tipId=put(tip,props,propCount?'PVRTX':'VRTX');
    for(let j=0;j<previous.length;j++)tri([previous[(j+1)%previous.length],previous[j],tipId]);
    ends.push({...end,tip,length});
  });
  const inspection=validate?inspectMesh(vertices,triangles):{...part.inspection,vertices:part.inspection.vertices+addedVertices.length,faces:triangles.length,closed:false};
  if(validate&&(!inspection.closed||inspection.components!==1||inspection.euler!==part.inspection.euler+2))throw new Error(`${part.name}：尖灭后拓扑检查失败（${inspection.errors.join('；')||`边界 ${inspection.boundaryEdges} / Euler ${inspection.euler}`}）`);
  return {vertices,triangles,addedVertices,addedTriangles,inspection,ends,nextId};
}

export function buildDocument(doc,configs) {
  const results=new Map(),next=doc.objects.map(o=>o.maxId+1);
  for(const part of doc.parts) {
    part.object=doc.objects[part.objectIndex];
    const config=configs[part.id]||defaultConfig(part);
    const result=taperPart(part,config,next[part.objectIndex]);
    if(result.nextId)next[part.objectIndex]=result.nextId;
    results.set(part.id,result);
  }
  return results;
}

export function exportTSurf(doc,configs) {
  const results=buildDocument(doc,configs),insertions=new Map();
  for(const part of doc.parts) {
    const r=results.get(part.id);if(!r.addedVertices.length)continue;
    const block=['# Orebody Taper Tool: appended end caps; original geometry retained'];
    // 17 significant digits permit a Float64 round trip and preserve small features at map scale.
    for(const v of r.addedVertices)block.push(`${v.props.length?'PVRTX':'VRTX'} ${v.id} ${v.p.map(x=>x.toPrecision(17)).join(' ')}${v.props.length?' '+v.props.join(' '):''}`);
    for(const t of r.addedTriangles)block.push(`TRGL ${t.join(' ')}`);
    if(!insertions.has(part.insertAt))insertions.set(part.insertAt,[]);
    insertions.get(part.insertAt).push(...block);
  }
  const out=[];
  for(let i=0;i<=doc.lines.length;i++) {
    if(insertions.has(i))out.push(...insertions.get(i));
    if(i<doc.lines.length)out.push(doc.lines[i]);
  }
  return (doc.bom?'\uFEFF':'')+out.join(doc.newline);
}

export function makeDemo() {
  const out=['# Synthetic multi-model / multi-TFACE sample. Coordinates in metres.'];
  const model=(name,count,offset) => {
    out.push('GOCAD TSurf 1','HEADER {',`name:${name}`,'*solid*color: 0.2 0.65 0.6 1','}','GOCAD_ORIGINAL_COORDINATE_SYSTEM','NAME Local','AXIS_NAME "X" "Y" "Z"','AXIS_UNIT "m" "m" "m"','ZPOSITIVE Elevation','END_ORIGINAL_COORDINATE_SYSTEM','PROPERTIES grade','NO_DATA_VALUES -99999');
    let id=1;
    for(let f=0;f<count;f++) {
      out.push('TFACE');const start=id,n=24,sections=23;
      for(let i=0;i<sections;i++) {
        const u=i/(sections-1),x=(u-.5)*260,y=offset+f*125+14*Math.sin(u*3.2),z=-55+20*Math.sin(u*2.7);
        for(let j=0;j<n;j++) {
          const a=j/n*Math.PI*2,r=(21+7*Math.sin(u*Math.PI))*(1+.09*Math.sin(a*3+i*.7));
          out.push(`PVRTX ${id++} ${(500000+x).toFixed(6)} ${(3800000+y+Math.cos(a)*r).toFixed(6)} ${(z+Math.sin(a)*r*.67).toFixed(6)} ${(1.2+u*.7).toFixed(3)}`);
        }
      }
      for(let i=0;i<sections-1;i++)for(let j=0;j<n;j++) {
        const a=start+i*n+j,b=start+i*n+(j+1)%n,c=a+n,d=b+n;
        out.push(`TRGL ${a} ${b} ${c}`,`TRGL ${b} ${d} ${c}`);
      }
    }
    out.push('END');
  };
  model('Aurora · 主矿体',2,0);model('North · 北部透镜体',1,280);
  return out.join('\n')+'\n';
}
