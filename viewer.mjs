import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';

export class Viewer {
  constructor(container){
    this.container=container;this.wire=true;this.offset=new THREE.Vector3();this.sign=1;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#f0f3ee');
    this.camera=new THREE.PerspectiveCamera(36,1,.01,100000);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor('#f0f3ee');
    container.prepend(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','可旋转缩放的矿体三维预览');
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.maxPolarAngle=Math.PI*.98;
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x8b9f83,2.6));
    const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(-2,5,4);this.scene.add(light);
    const fill=new THREE.DirectionalLight(0xe1f2e9,.8);fill.position.set(2,0,-3);this.scene.add(fill);
    this.model=new THREE.Group();this.scene.add(this.model);this.endPositions=[];
    this.raycaster=new THREE.Raycaster();this.drag=null;this.canDrag=false;
    for(const [index,id] of ['endLabelA','endLabelB'].entries()){
      const handle=document.getElementById(id);
      handle.addEventListener('pointerdown',event=>this.startDrag(event,index));
      handle.addEventListener('pointermove',event=>this.moveDrag(event));
      for(const eventName of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(eventName,event=>this.finishDrag(event));
      handle.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&this.drag){event.preventDefault();this.finishDrag(event,true);}
      });
    }
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.resize();
    this.animate();
  }
  resize(){const {width,height}=this.container.getBoundingClientRect();this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.renderer.setSize(width,height,false);}
  clear(){
    this.model.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});
    this.model.clear();if(this.grid){this.scene.remove(this.grid);this.grid.geometry.dispose();this.grid.material.dispose();this.grid=null;}
  }
  mesh(vertices,triangles,color,opacity=1){
    if(!triangles.length)return;
    const ids=[...new Set(triangles.flat())],map=new Map(ids.map((id,i)=>[id,i]));
    const positions=new Float32Array(ids.length*3);
    ids.forEach((id,i)=>{const p=vertices.get(id)?.p;if(!p)return;positions[i*3]=p[0]-this.offset.x;positions[i*3+1]=(p[2]-this.offset.z)*this.sign;positions[i*3+2]=-(p[1]-this.offset.y);});
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.setIndex(triangles.flatMap(t=>this.sign>0?t.map(id=>map.get(id)):[t[0],t[2],t[1]].map(id=>map.get(id))));geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.04,side:THREE.DoubleSide,transparent:opacity<1,opacity,depthWrite:opacity===1,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const mesh=new THREE.Mesh(geometry,material);this.model.add(mesh);
    const wire=new THREE.LineSegments(new THREE.WireframeGeometry(geometry),new THREE.LineBasicMaterial({color:opacity<1?0x94ad9a:0x335d4a,transparent:true,opacity:opacity<1?.11:.19,depthWrite:false}));
    wire.userData.wire=true;wire.visible=this.wire;this.model.add(wire);
  }
  point(p){return new THREE.Vector3(p[0]-this.offset.x,(p[2]-this.offset.z)*this.sign,-(p[1]-this.offset.y));}
  coordinate(p){return [p.x+this.offset.x,-p.z+this.offset.y,p.y*this.sign+this.offset.z];}
  hitPlane(event,plane){
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.camera);
    return this.raycaster.ray.intersectPlane(plane,new THREE.Vector3());
  }
  startDrag(event,index){
    if(event.button!==0||!this.canDrag||this.drag||!this.endPositions[index])return;
    event.preventDefault();event.stopPropagation();
    const position=this.endPositions[index].clone(),plane=new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()),position);
    const hit=this.hitPlane(event,plane);if(!hit)return;
    this.controls.enabled=false;this.controls.update();
    this.drag={index,plane,offset:position.clone().sub(hit),start:position.clone(),position:position.clone(),pointerId:event.pointerId,handle:event.currentTarget};
    event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.focus({preventScroll:true});event.currentTarget.classList.add('dragging');
    this.onTipDrag?.('start',index,this.coordinate(position));
  }
  moveDrag(event){
    const drag=this.drag;if(!drag||event.pointerId!==drag.pointerId)return;
    event.preventDefault();event.stopPropagation();
    const hit=this.hitPlane(event,drag.plane);if(!hit)return;
    const next=hit.add(drag.offset),p=this.coordinate(next),end=this.activePart.ends[drag.index];
    const outward=p.reduce((s,x,i)=>s+(x-end.center[i])*end.direction[i],0);
    if(outward<=this.activePart.inspection.extent*1e-5)return;
    drag.position.copy(next);this.endPositions[drag.index]=next;
    this.onTipDrag?.('move',drag.index,p);
  }
  finishDrag(event,cancel=false){
    const drag=this.drag;if(!drag||event.pointerId!==undefined&&event.pointerId!==drag.pointerId)return;
    this.drag=null;this.controls.enabled=true;drag.handle.classList.remove('dragging');
    if(drag.handle.hasPointerCapture(drag.pointerId))drag.handle.releasePointerCapture(drag.pointerId);
    this.onTipDrag?.(cancel||event.type==='pointercancel'?'cancel':'end',drag.index,this.coordinate(drag.position));
  }
  setEditable(value){this.canDrag=value;for(const id of ['endLabelA','endLabelB']){
    const handle=document.getElementById(id);handle.classList.toggle('editable',value);handle.setAttribute('aria-disabled',String(!value));handle.tabIndex=value?0:-1;
  }}
  render(doc,results,currentId,{original=false,all=false,fit=false}={}){
    this.clear();const selected=doc.parts.find(p=>p.id===currentId);this.offset.fromArray(selected.inspection.center);
    this.activePart=selected;
    this.sign=/depth/i.test(doc.objects[selected.objectIndex].zpositive)?-1:1;
    this.endPositions=[];
    const shown=all?doc.parts:[selected];
    for(const part of shown){
      const result=results.get(part.id),active=part.id===currentId,opacity=active?1:.23;
      this.mesh(part.vertices,part.triangles,active?0x6d9e87:0xa3b9a2,opacity);
      if(!original&&result?.addedTriangles.length)this.mesh(result.vertices,result.addedTriangles,0xc4af75,opacity);
      if(active)for(const [i,end] of part.ends.entries()){
        const pts=end.loop.map(id=>this.point(part.vertices.get(id).p));pts.push(pts[0]);
        const geo=new THREE.BufferGeometry().setFromPoints(pts),line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:i?0xab8e49:0x267d64,transparent:true,opacity:.8}));this.model.add(line);
        const tip=(!original&&result?.ends?.[i]?.tip)||end.center;this.endPositions.push(this.point(tip));
        if(!original&&result?.ends?.[i]?.tip){
          const g=new THREE.BufferGeometry().setFromPoints([this.point(end.center),this.point(tip)]);
          const l=new THREE.Line(g,new THREE.LineDashedMaterial({color:0x8c9c79,dashSize:selected.inspection.extent*.012,gapSize:selected.inspection.extent*.009,transparent:true,opacity:.5}));l.computeLineDistances();this.model.add(l);
        }
      }
    }
    if(this.drag)this.endPositions[this.drag.index]=this.drag.position.clone();
    this.bounds=new THREE.Box3().setFromObject(this.model);
    if(this.bounds.isEmpty())this.bounds.set(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,1,1));
    const size=this.bounds.getSize(new THREE.Vector3()),center=this.bounds.getCenter(new THREE.Vector3()),scale=Math.max(...size.toArray(),1e-6);
    this.grid=new THREE.GridHelper(scale*3,30,0xd1ddcd,0xdde5d8);this.grid.position.set(center.x,this.bounds.min.y-scale*.14,center.z);this.grid.material.transparent=true;this.grid.material.opacity=.5;this.scene.add(this.grid);
    this.camera.near=scale/10000;this.camera.far=scale*200;this.camera.updateProjectionMatrix();this.controls.minDistance=scale*.03;this.controls.maxDistance=scale*20;
    if(fit)this.fit();
  }
  fit(){
    if(!this.bounds)return;
    const size=this.bounds.getSize(new THREE.Vector3()),center=this.bounds.getCenter(new THREE.Vector3());
    const radius=size.length()/2;
    const fov=this.camera.fov*Math.PI/180,dist=radius/Math.sin(Math.min(fov,2*Math.atan(Math.tan(fov/2)*this.camera.aspect))/2)*1.12;
    this.controls.target.copy(center);this.camera.position.copy(center).add(new THREE.Vector3(1.1,.7,1.55).normalize().multiplyScalar(dist));this.controls.update();
  }
  toggleWire(){this.wire=!this.wire;this.model.traverse(o=>{if(o.userData.wire)o.visible=this.wire;});return this.wire;}
  animate(){
    requestAnimationFrame(()=>this.animate());if(!this.drag)this.controls.update();this.renderer.render(this.scene,this.camera);
    this.endPositions.forEach((p,i)=>{
      const el=document.getElementById(i?'endLabelB':'endLabelA'),v=p.clone().project(this.camera);
      const visible=v.z>-1&&v.z<1&&Math.abs(v.x)<.96&&Math.abs(v.y)<.92;
      el.style.visibility=visible?'visible':'hidden';el.style.left=`${(v.x*.5+.5)*this.container.clientWidth}px`;el.style.top=`${(-v.y*.5+.5)*this.container.clientHeight}px`;
    });
  }
}
