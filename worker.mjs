import {parseTSurf,prepareDocument,defaultConfig,taperPart,exportTSurf} from './core.mjs';
let doc;
self.onmessage=({data})=>{
  const {id,action}=data;
  try {
    if(action==='load') {
      doc=prepareDocument(parseTSurf(data.text));
      const configs=Object.fromEntries(doc.parts.map(p=>[p.id,defaultConfig(p)]));
      self.postMessage({id,doc,configs,...build(configs)});
    } else if(action==='preview') {
      const part=doc.parts.find(p=>p.id===data.partId);
      if(!part)throw new Error('未找到拖动的 Part');
      part.object=doc.objects[part.objectIndex];
      const result=taperPart(part,data.config,part.object.maxId+1,{validate:false});
      self.postMessage({id,result});
    } else if(action==='build')self.postMessage({id,...build(data.configs)});
    else if(action==='export')self.postMessage({id,text:exportTSurf(doc,data.configs)});
  }catch(error){self.postMessage({id,error:error.message});}
};
function build(configs){
  const results=new Map(),errors=new Map(),next=doc.objects.map(o=>o.maxId+1);
  for(const part of doc.parts){
    part.object=doc.objects[part.objectIndex];
    try {
      const result=taperPart(part,configs[part.id],next[part.objectIndex]);
      if(result.nextId)next[part.objectIndex]=result.nextId;
      results.set(part.id,result);
    }catch(e){errors.set(part.id,e.message);}
  }
  return {results,errors};
}
