import {defaultConfig,makeDemo} from './core.mjs';
import {Viewer} from './viewer.mjs';

const $=id=>document.getElementById(id),fmt=n=>n.toLocaleString('en-US');
let doc=null,configs={},results=new Map(),errors=new Map(),currentId='',filename='',dirty=false,busy=false,original=false,all=false,viewer,requestId=0,toastTimer;
let dragging=false,dragSession=0,previewRunning=false,queuedPreview=null,dragBackup=null;
const worker=new Worker('./worker.mjs',{type:'module'}),pending=new Map();
worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data);};
worker.onerror=e=>{for(const p of pending.values())p.reject(new Error(e.message||'网格处理线程启动失败'));pending.clear();};
const request=(action,data={})=>new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,{resolve,reject});worker.postMessage({id,action,...data});});
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),error?9000:4000);}
function setBusy(value,text='正在处理网格…'){busy=value;$('busyText').textContent=text;$('busyOverlay').classList.toggle('hidden',!value);$('dropzone').disabled=value;$('replaceFile').disabled=value;$('demoButton').disabled=value;$('emptyDemo').disabled=value;$('fileInput').disabled=value;updateControls();}
function part(){return doc?.parts.find(p=>p.id===currentId);}
function selected(){return doc?doc.parts.filter(p=>configs[p.id]?.enabled):[];}
function updateControls(){
  const p=part(),eligible=p?.eligible&&!busy&&!dragging;
  for(const id of ['lengthA','lengthB','rings','exponent','resetParams'])$(id).disabled=!eligible;
  $('includePart').disabled=!eligible;$('partSelect').disabled=!doc||busy||dragging;
  $('applyButton').disabled=!doc||busy||dragging;$('applyButton').innerHTML=`<svg><use href="#i-check"/></svg>${dirty?'更新尖灭预览':'生成尖灭预览'}`;
  const count=selected().length;$('selectedCount').textContent=`${count} 已选`;$('exportCount').textContent=count;
  $('exportButton').disabled=!doc||!count||dirty||busy||dragging||errors.size>0;
  for(const id of ['dropzone','replaceFile','demoButton','emptyDemo','fileInput'])$(id).disabled=busy||dragging;
  for(const id of ['originalView','resultView','fitView','toggleAll'])$(id).disabled=busy||dragging;
  viewer?.setEditable(!!p?.eligible&&!!configs[p.id]?.enabled&&!original&&!busy&&!errors.has(p?.id));
}
function curve(){
  const p=Number($('exponent').value);let top=[],bottom=[];
  for(let i=0;i<=40;i++){const x=i/40*280,r=Math.pow(1-i/40,p)*21;top.push(`${x},${25-r}`);bottom.unshift(`${x},${25+r}`);}
  $('curvePath').setAttribute('d',`M${top.join(' L')} L${bottom.join(' L')}Z`);
}
function fillParams(){
  const p=part();if(!p)return;const c=configs[p.id];
  $('lengthA').value=c.lengthA;$('lengthB').value=c.lengthB;$('rings').value=c.rings;$('exponent').value=c.exponent;
  $('ringsValue').innerHTML=`${c.rings} <span>环</span>`;$('exponentValue').textContent=c.exponent.toFixed(2);$('includePart').checked=c.enabled;
  $('partStatus').textContent=p.eligible?'可自动尖灭':p.inspection.closed?'原始网格已闭合':'需要检查网格';
  $('partStatus').title=issue(p);
  $('endCount').textContent=`${p.inspection.loops.length} 个开放端`;
  const obj=doc.objects[p.objectIndex],axis=doc.lines.slice(obj.start,obj.end).find(s=>/^\s*AXIS_UNIT\s+/i.test(s));
  $('lengthUnit').textContent=axis?axis.replace(/^\s*AXIS_UNIT\s+/i,'').replaceAll('"','').trim():'原始坐标单位';
  curve();updateControls();
}
function render(fit=false){
  if(!doc)return;
  const p=part(),r=results.get(p.id),inspection=original?p.inspection:(r?.inspection||p.inspection);
  try{viewer?.render(doc,results,currentId,{original,all,fit});}catch(e){toast(`三维预览失败：${e.message}`,true);}
  $('emptyState').classList.add('hidden');$('objectChip').textContent=p.name;
  $('statusChip').classList.toggle('hidden',!inspection.closed||dirty);$('statusChip').innerHTML='<i></i>已闭合';
  for(const id of ['endLabelA','endLabelB'])$(id).classList.toggle('hidden',p.ends.length!==2||!viewer);
  $('dragHint').classList.toggle('hidden',!p.eligible||!configs[p.id].enabled||original||!viewer);
  $('originalView').classList.toggle('active',original);$('resultView').classList.toggle('active',!original);
  $('viewModeLabel').textContent=dragging?'DRAG TO SHAPE':dirty?'UNAPPLIED CHANGES':original?'ORIGINAL MESH':'LIVE PREVIEW';
  $('meshCount').textContent=`${fmt(inspection.vertices)} VERTICES / ${fmt(inspection.faces)} FACES`;
  $('boundaryMetric').innerHTML=`${p.inspection.loops.length} <small>个开放端</small>`;
  $('boundaryFoot').textContent=p.eligible?'两端方向已从局部邻域自动计算':p.inspection.closed?'此 Part 已闭合，导出时保留':'边界条件不满足自动尖灭';
  const generated=!original&&r?r.addedTriangles.length:0;
  $('generatedMetric').innerHTML=`${fmt(generated)} <small>个三角形</small>`;
  $('generatedFoot').textContent=dragging?'拖动端点中 · 网格实时更新':dirty?'参数已修改，点击更新预览':r?.addedVertices.length&&!original?`新增 ${fmt(r.addedVertices.length)} 顶点 · 主体保持不变`:'保留全部原始主体网格';
  const ok=inspection.closed&&!errors.has(p.id),label=dirty?'待更新':ok?'检查通过':inspection.valid?'开放网格':'需修复';
  $('topologyMetric').innerHTML=`<span class="status-icon">${dirty?'↻':ok?'✓':'○'}</span> ${label}`;
  $('topologyFoot').textContent=dragging?'松开鼠标后自动检查拓扑':errors.get(p.id)||(!p.eligible&&!p.inspection.closed?issue(p):'')||(dirty?'当前预览仍使用上次参数':ok?`边界 0 · 流形有效 · Euler ${inspection.euler}`:'边界 · 流形 · 绕序 · 退化面');
  $('topologyFoot').title=$('topologyFoot').textContent;
  document.body.classList.toggle('error-view',!ok);
  updateControls();
}
function issue(p){
  const issues=[...p.errors,...p.inspection.errors];
  if(!p.inspection.closed&&p.inspection.loops.length!==2)issues.push(`识别到 ${p.inspection.loops.length} 个边界环，自动尖灭要求 2 个`);
  if(p.inspection.components!==1)issues.push(`${p.inspection.components} 个连通分量，需每个 Part 一个主体`);
  return [...new Set(issues)].join('；');
}
async function loadText(text,name,size){
  if(busy)return;setBusy(true,'正在解析 TSurf 并识别开放端…');
  try{
    const data=await request('load',{text});
    doc=data.doc;configs=data.configs;results=data.results;errors=data.errors;currentId=doc.parts[0].id;filename=name;dirty=false;original=false;
    $('partSelect').replaceChildren(...doc.parts.map(p=>new Option(p.name,p.id)));$('partSelect').value=currentId;
    $('fileName').textContent=name;$('fileName').title=name;$('fileMeta').textContent=`${size>1024*1024?(size/1024/1024).toFixed(1)+' MB':Math.max(1,Math.round(size/1024))+' KB'} · ${doc.objects.length} TSurf · ${doc.parts.length} Parts`;
    $('fileCard').classList.remove('hidden');$('partCount').textContent=`${doc.parts.length} PART${doc.parts.length>1?'S':''}`;
    fillParams();render(true);toast(`已读取 ${doc.parts.length} 个 Part，${selected().length} 个可自动尖灭`);
  }catch(e){toast(e.message,true);}finally{setBusy(false);}
}
async function loadFile(file){
  if(!file||busy)return;
  if(file.size>150*1024*1024){toast('文件超过 150 MB，请使用更小的文件以控制浏览器内存。',true);return;}
  try{const buffer=await file.arrayBuffer();const text=new TextDecoder($('encodingSelect').value,{fatal:true}).decode(buffer);await loadText(text,file.name,file.size);}
  catch(e){toast(`文件读取失败：${e.message}。可在帮助中切换 UTF-8 / GB18030 编码。`,true);}
  finally{$('fileInput').value='';}
}
async function apply({fit=true,quiet=false}={}){
  if(busy||!doc)return;setBusy(true,'正在生成渐缩网格并检查拓扑…');
  if(quiet)$('busyOverlay').classList.add('hidden');
  try{const data=await request('build',{configs});results=data.results;errors=data.errors;dirty=false;render(fit);if(errors.size)toast([...errors.values()].join('；'),true);else if(!quiet)toast('尖灭预览已更新，拓扑检查完成');}
  catch(e){toast(e.message,true);}finally{setBusy(false);}
}
function download(text,name,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function exportFile(){
  if($('exportButton').disabled)return;setBusy(true,'正在校验并导出全部模型…');
  try{const data=await request('export',{configs});download(data.text,filename.replace(/\.(ts|tsurf)$/i,'')+'_tapered.ts','text/plain;charset=utf-8');toast(`已导出：${selected().length} 个 Part 尖灭，其余 Part 原样保留`);}
  catch(e){toast(e.message,true);}finally{setBusy(false);}
}
function changeParams(){
  if(!part()||busy)return;
  const config=configs[currentId];
  for(const [key,index] of [['lengthA',0],['lengthB',1]]){
    const value=Number($(key).value),tipKey=index?'tipB':'tipA';
    if(value!==config[key]&&config[tipKey]){
      const center=part().ends[index].center,distance=Math.hypot(...config[tipKey].map((x,i)=>x-center[i]));
      config[tipKey]=config[tipKey].map((x,i)=>center[i]+(x-center[i])*value/distance);
    }
    config[key]=value;
  }
  Object.assign(config,{rings:Number($('rings').value),exponent:Number($('exponent').value)});
  $('ringsValue').innerHTML=`${$('rings').value} <span>环</span>`;$('exponentValue').textContent=Number($('exponent').value).toFixed(2);
  dirty=true;curve();render();
}
async function pumpPreview(){
  if(previewRunning||!queuedPreview)return;
  const job=queuedPreview;queuedPreview=null;previewRunning=true;
  try{
    const data=await request('preview',job);
    if(dragging&&job.session===dragSession&&job.partId===currentId){results.set(job.partId,data.result);render();}
  }catch(e){if(dragging&&job.session===dragSession)toast(e.message,true);}
  finally{previewRunning=false;if(queuedPreview)pumpPreview();}
}
function handleTipDrag(phase,index,tip){
  if(phase==='start'){
    dragging=true;dragSession++;dragBackup=structuredClone(configs[currentId]);dirty=true;updateControls();return;
  }
  if(phase==='move'){
    const config=configs[currentId],end=part().ends[index];config[index?'tipB':'tipA']=tip;
    config[index?'lengthB':'lengthA']=Math.hypot(...tip.map((x,i)=>x-end.center[i]));
    $('lengthA').value=Number(config.lengthA.toPrecision(7));$('lengthB').value=Number(config.lengthB.toPrecision(7));
    queuedPreview={partId:currentId,config:structuredClone(config),session:dragSession};pumpPreview();return;
  }
  dragging=false;dragSession++;queuedPreview=null;
  if(phase==='cancel'){configs[currentId]=dragBackup;fillParams();}
  dragBackup=null;apply({fit:false,quiet:true});
}
$('dropzone').onclick=()=>$('fileInput').click();$('replaceFile').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>loadFile(e.target.files[0]);
for(const name of ['dragenter','dragover'])$('dropzone').addEventListener(name,e=>{e.preventDefault();$('dropzone').classList.add('dragover');});
for(const name of ['dragleave','drop'])$('dropzone').addEventListener(name,e=>{e.preventDefault();$('dropzone').classList.remove('dragover');if(name==='drop')loadFile(e.dataTransfer.files[0]);});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
const demo=()=>{const text=makeDemo();loadText(text,'Aurora_demo.ts',new Blob([text]).size);};
$('demoButton').onclick=demo;$('emptyDemo').onclick=demo;
$('partSelect').onchange=e=>{currentId=e.target.value;fillParams();render(true);};
for(const id of ['lengthA','lengthB','rings','exponent'])$(id).addEventListener('input',changeParams);
$('includePart').onchange=e=>{configs[currentId].enabled=e.target.checked;dirty=true;render();};
$('resetParams').onclick=()=>{configs[currentId]=defaultConfig(part());dirty=true;fillParams();render();};
$('applyButton').onclick=()=>apply();$('exportButton').onclick=exportFile;
$('originalView').onclick=()=>{original=true;render();};$('resultView').onclick=()=>{original=false;render();};
$('fitView').onclick=()=>viewer?.fit();$('toggleWire').onclick=()=>{const value=viewer?.toggleWire();$('toggleWire').classList.toggle('active',!!value);$('toggleWire').setAttribute('aria-pressed',!!value);};
$('toggleAll').onclick=()=>{all=!all;$('toggleAll').classList.toggle('active',all);$('toggleAll').setAttribute('aria-pressed',all);render(true);};
$('helpButton').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();$('helpDialog').onclick=e=>{if(e.target===$('helpDialog'))$('helpDialog').close();};
$('railSettings').onclick=()=>$('parameterSection').scrollIntoView({behavior:'smooth',block:'center'});
window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='f'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))viewer?.fit();});
try{viewer=new Viewer($('viewport'));viewer.onTipDrag=handleTipDrag;}catch(e){toast('WebGL 无法启动，三维预览不可用；仍可使用网格处理和导出。',true);$('fitView').disabled=true;$('toggleWire').disabled=true;}
curve();demo();
