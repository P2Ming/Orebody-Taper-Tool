import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTSurf,prepareDocument,defaultConfig,buildDocument,exportTSurf,inspectMesh,makeDemo} from '../core.mjs';

const load=text=>prepareDocument(parseTSurf(text));
const defaults=d=>Object.fromEntries(d.parts.map(p=>[p.id,defaultConfig(p)]));
function tube({atom=false,reversed=false,offset=0}={}){
  const lines=['GOCAD TSurf 1','HEADER {','name:test','}','TFACE'];
  for(let s=0;s<4;s++)for(let j=0;j<8;j++){
    const a=j/8*Math.PI*2;
    lines.push(`VRTX ${s*8+j+1} ${offset+s*10} ${offset+Math.cos(a)*3} ${offset+Math.sin(a)*2}`);
  }
  if(atom)lines.push('ATOM 100 1');
  for(let s=0;s<3;s++)for(let j=0;j<8;j++){
    const a=s*8+j+1,b=s*8+(j+1)%8+1,c=a+8,d=b+8;
    for(let t of [[a,b,c],[b,d,c]]){
      if(atom)t=t.map(v=>v===1?100:v);
      if(reversed)t.reverse();lines.push('TRGL '+t.join(' '));
    }
  }
  return lines.concat('END','').join('\n');
}

test('multi-TSurf / multi-TFACE sample closes all parts with unique IDs and preserves original geometry',()=>{
  const source=makeDemo(),doc=load(source),configs=defaults(doc);
  assert.equal(doc.objects.length,2);assert.equal(doc.parts.length,3);
  const results=buildDocument(doc,configs);
  for(const p of doc.parts){
    assert.equal(p.eligible,true);assert.equal(p.inspection.loops.length,2);
    const r=results.get(p.id);assert.equal(r.inspection.closed,true);assert.equal(r.inspection.euler,2);
    assert.equal(r.inspection.nonManifoldVertices,0);assert.equal(r.inspection.winding,0);
    assert.deepEqual(r.triangles.slice(0,p.triangles.length),p.triangles);
    for(const [id,v] of p.vertices)assert.deepEqual(r.vertices.get(id),v);
    for(const e of r.ends)assert.ok(e.direction[0]*(e.center[0]-p.inspection.center[0])>0);
  }
  const roundtrip=load(exportTSurf(doc,configs));
  assert.equal(roundtrip.parts.length,3);
  for(const p of roundtrip.parts){assert.deepEqual(p.errors,[]);assert.equal(p.inspection.closed,true);}
  // Every source line remains in order, including metadata and original triangle records.
  const outputLines=exportTSurf(doc,configs).split('\n');let index=0;
  for(const line of source.split('\n')){index=outputLines.indexOf(line,index);assert.ok(index>=0);index++;}
});

test('unselected part is preserved while selected parts use independent parameters',()=>{
  const doc=load(makeDemo()),c=defaults(doc);
  c['part-2'].enabled=false;c['part-3'].rings=3;c['part-3'].lengthA=15;c['part-3'].lengthB=47;
  const r=buildDocument(doc,c);
  assert.equal(r.get('part-2').addedTriangles.length,0);
  assert.equal(r.get('part-3').addedTriangles.length,24*(4*3+2));
  const out=load(exportTSurf(doc,c));
  assert.equal(out.parts[1].inspection.boundaryEdges,48);
  assert.deepEqual(out.parts[1].triangles,doc.parts[1].triangles);
  assert.equal(out.parts[0].inspection.closed,true);assert.equal(out.parts[2].inspection.closed,true);
});

test('ATOM aliases and inward global winding close consistently without reorienting original faces',()=>{
  for(const reversed of [false,true]){
    const doc=load(tube({atom:true,reversed})),c=defaults(doc),r=buildDocument(doc,c).get('part-1');
    assert.equal(doc.parts[0].eligible,true);assert.equal(r.inspection.closed,true);
    assert.deepEqual(r.triangles.slice(0,doc.parts[0].triangles.length),doc.parts[0].triangles);
    assert.ok(r.addedVertices.every(v=>v.id>100));
    assert.equal(load(exportTSurf(doc,c)).parts[0].inspection.closed,true);
  }
});

test('closed parts pass through byte-for-byte, including BOM and CRLF',()=>{
  const d=load(tube()),closed=exportTSurf(d,defaults(d));
  const input='\uFEFF'+closed.replaceAll('\n','\r\n');
  const doc=load(input);assert.equal(doc.parts[0].eligible,false);assert.equal(doc.parts[0].inspection.closed,true);
  assert.equal(exportTSurf(doc,defaults(doc)),input);
});

test('translation to large mapping coordinates does not affect topology or taper length',()=>{
  for(const offset of [0,5000000]){
    const doc=load(tube({offset})),c=defaults(doc);c['part-1'].lengthA=7.123456789;c['part-1'].lengthB=13.987654321;
    const r=buildDocument(doc,c).get('part-1');assert.equal(r.inspection.closed,true);
    for(let i=0;i<2;i++){
      const e=r.ends[i],distance=Math.hypot(...e.tip.map((x,k)=>x-e.center[k]));
      assert.ok(Math.abs(distance-(i?13.987654321:7.123456789))<1e-8);
    }
    const out=load(exportTSurf(doc,c));
    for(const v of r.addedVertices)assert.deepEqual(out.objects[0].vertices.get(v.id).p,v.p);
  }
});

test('PVRTX attributes copied on rings and averaged on tips',()=>{
  const doc=load(makeDemo()),r=buildDocument(doc,defaults(doc)).get('part-1');
  assert.ok(r.addedVertices.every(v=>v.props.length===1));
  assert.ok(r.addedVertices.every(v=>Number.isFinite(Number(v.props[0]))));
  assert.deepEqual(r.addedVertices[0].props,doc.parts[0].vertices.get(doc.parts[0].ends[0].loop[0]).props);
});

test('missing vertices, duplicate faces, reversed faces, branching and non-manifold edges are blocked',()=>{
  const fixtures=[
    tube().replace('TRGL 1 2 9','TRGL 1 999 9'),
    tube().replace('END','TRGL 1 2 9\nEND'),
    tube().replace('TRGL 1 2 9','TRGL 9 2 1'),
    tube().replace('END','VRTX 200 4 4 4\nTRGL 1 2 200\nEND'),
    tube().replace('TRGL 1 2 9','TRGL 1 1 9'),
  ];
  for(const text of fixtures){const d=load(text);assert.equal(d.parts[0].eligible,false);assert.ok(d.parts[0].inspection.errors.length);const c=defaults(d);c['part-1'].enabled=true;assert.throws(()=>buildDocument(d,c));}
});

test('pinched vertex is rejected even when edges do not have more than two faces',()=>{
  const v=new Map([[1,[0,0,0]],[2,[1,0,0]],[3,[0,1,0]],[4,[0,0,1]],[5,[-1,0,0]],[6,[0,-1,0]],[7,[0,0,-1]]].map(([id,p])=>[id,{id,p,props:[]}]));
  const t=[[1,3,2],[1,2,4],[2,3,4],[3,1,4],[1,6,5],[1,5,7],[5,6,7],[6,1,7]];
  const r=inspectMesh(v,t);assert.equal(r.nonManifold,0);assert.equal(r.boundaryEdges,0);assert.equal(r.nonManifoldVertices,1);assert.equal(r.closed,false);
});

test('one or three boundary loops and disconnected geometry are not auto-capped',()=>{
  const d=load(tube()),p=d.parts[0],first=p.ends[0].loop;
  let text=tube().replace('END','VRTX 200 -5 0 0\n'+first.map((id,j)=>`TRGL ${first[(j+1)%first.length]} ${id} 200`).join('\n')+'\nEND');
  let one=load(text);assert.equal(one.parts[0].inspection.loops.length,1);assert.equal(one.parts[0].eligible,false);
  text=tube().replace('TRGL 9 10 17\n','').replace('TRGL 10 18 17\n','');
  const three=load(text);assert.equal(three.parts[0].inspection.loops.length,3);assert.equal(three.parts[0].eligible,false);
  text=tube().replace('END','VRTX 201 100 0 0\nVRTX 202 100 1 0\nVRTX 203 100 0 1\nTRGL 201 202 203\nEND');
  const disconnected=load(text);assert.equal(disconnected.parts[0].inspection.components,2);assert.equal(disconnected.parts[0].eligible,false);
});

test('invalid taper parameters and malformed TSurf are rejected explicitly',()=>{
  const d=load(tube());
  for(const change of [{lengthA:0},{lengthB:-1},{lengthA:NaN},{rings:1.5},{rings:129},{exponent:0},{exponent:6}]){
    const c=defaults(d);Object.assign(c['part-1'],change);assert.throws(()=>buildDocument(d,c));
  }
  assert.throws(()=>parseTSurf('hello'));
  assert.throws(()=>parseTSurf(tube().replace('END','')));
  assert.throws(()=>parseTSurf(tube().replace('END','GOCAD TSurf 1')));
});

test('implicit TFACE and unknown metadata export safely',()=>{
  const text=tube().replace('TFACE\n','').replace('HEADER {','PROPERTY_CLASS_HEADER custom {\nkind:discrete\n}\nHEADER {');
  const d=load(text);assert.equal(d.parts[0].eligible,true);
  assert.equal(load(exportTSurf(d,defaults(d))).parts[0].inspection.closed,true);
});

test('dragged tips control ring direction and survive validated export without modifying the body',()=>{
  const d=load(makeDemo()),p=d.parts[0],c=defaults(d);
  const targets=p.ends.map((end,i)=>end.center.map((x,k)=>x+end.direction[k]*55+(k===2?(i?-9:12):0)));
  Object.assign(c[p.id],{tipA:targets[0],tipB:targets[1]});
  const r=buildDocument(d,c).get(p.id);
  assert.equal(r.inspection.closed,true);
  assert.deepEqual(r.ends.map(e=>e.tip),targets);
  const end=p.ends[0],source=p.vertices.get(end.loop[0]).p,t=1/(c[p.id].rings+1),scale=(1-t)**c[p.id].exponent;
  const expected=end.center.map((x,k)=>x+(targets[0][k]-x)*t+(source[k]-x)*scale);
  assert.deepEqual(r.addedVertices[0].p,expected);
  assert.deepEqual(r.triangles.slice(0,p.triangles.length),p.triangles);
  const out=load(exportTSurf(d,c));
  for(const v of r.addedVertices)assert.deepEqual(out.objects[0].vertices.get(v.id).p,v.p);
  assert.equal(out.parts[0].inspection.closed,true);
  assert.deepEqual(out.parts[1].inspection.faces,1872);
});

test('invalid or inward dragged tip is blocked and fast preview matches the validated geometry',async()=>{
  const {taperPart}=await import('../core.mjs');const d=load(tube()),p=d.parts[0],c=defaults(d)[p.id];
  const end=p.ends[0];
  for(const tipA of [[NaN,0,0],[1,2],end.center,end.center.map((x,k)=>x-end.direction[k]*20)])assert.throws(()=>taperPart(p,{...c,tipA},1000));
  const tipA=end.center.map((x,k)=>x+end.direction[k]*20+(k===2?5:0));
  const fast=taperPart(p,{...c,tipA},1000,{validate:false}),full=taperPart(p,{...c,tipA},1000);
  assert.deepEqual(fast.addedVertices,full.addedVertices);assert.deepEqual(fast.addedTriangles,full.addedTriangles);
  assert.equal(fast.inspection.closed,false);assert.equal(full.inspection.closed,true);
});
