(function(root,factory){const api=factory(root);root.JimengDurations=api;if(typeof module==='object'&&module.exports)module.exports=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const MAX_FILE=10*1024*1024,MAX_XML=5*1024*1024,MAX_TOTAL=20*1024*1024,MAX_SHEETS=30,MAX_ROWS=10000;
  const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PACKAGE_REL_NS='http://schemas.openxmlformats.org/package/2006/relationships';
  const TEXT=new TextDecoder('utf-8',{fatal:true});
  const isElement=node=>node&&node.nodeType===1;
  const children=(node,name)=>Array.from(node.childNodes||[]).filter(n=>isElement(n)&&n.namespaceURI===NS&&n.localName===name);
  const all=(node,name)=>Array.from(node.getElementsByTagNameNS(NS,name));
  function xml(bytes,label){
    if(!bytes)throw new Error('表格缺少 '+label+'，请检查文件是否完整。');
    const text=TEXT.decode(bytes);
    if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(text))throw new Error('表格含不支持的 XML 声明。');
    const doc=new root.DOMParser().parseFromString(text,'application/xml');
    if(!doc.documentElement||doc.getElementsByTagName('parsererror').length||doc.getElementsByTagNameNS('*','parsererror').length)throw new Error('表格内容损坏，无法读取 '+label+'。');
    return doc;
  }
  function texts(node){return all(node,'t').map(e=>e.textContent||'').join('');}
  function normalizeHeader(value){return String(value||'').replace(/[\s\u3000]/g,'').replace(/[（）]/g,c=>c==='（'?'(':')').toLowerCase();}
  function headerKind(value){
    const v=normalizeHeader(value);
    if(['分镜','分镜编号','分镜号','分镜序号'].includes(v))return 'id';
    if(['推荐时长(秒)','推荐秒数','推荐时长','推荐秒数(秒)','建议时长(秒)','建议秒数','建议时长'].includes(v))return 'seconds';
    return '';
  }
  function normalizeId(value){
    const m=/^(?:第\s*)?(\d+)\s*[-－—_–]\s*(\d+)$/.exec(String(value??'').trim());
    if(!m||Number(m[1])<1||Number(m[2])<1||Number(m[1])>100000||Number(m[2])>100000)return null;
    return Number(m[1])+'-'+Number(m[2]);
  }
  function number(value){
    const s=String(value??'').trim().replace(/\s*秒$/,'');
    if(!/^\d+(?:\.\d{1,3})?$/.test(s))return null;
    const n=Number(s);return Number.isSafeInteger(n)&&n>0&&n<=600?n:null;
  }
  function column(reference){const m=/^([A-Za-z]+)\d+$/.exec(reference||'');return m?m[1].toUpperCase():null;}
  function sharedValues(bytes){if(!bytes)return [];return all(xml(bytes,'共享文本'),'si').map(texts);}
  function cellValue(c,shared){
    const type=c.getAttribute('t')||'n',f=children(c,'f')[0],v=children(c,'v')[0];
    if(type==='e')return {value:'',formula:!!f,error:'单元格有错误值'};
    let value='';
    if(type==='inlineStr')value=texts(c);
    else if(v)value=v.textContent||'';
    if(type==='s'){
      if(!/^\d+$/.test(value)||Number(value)>=shared.length)throw new Error('共享文本索引无效，无法读取表格。');
      value=shared[Number(value)];
    }
    if(f&&!String(value).trim())return {value:'',formula:true,error:'公式没有保存计算结果'};
    return {value:String(value).trim(),formula:!!f};
  }
  function sheetRows(bytes,shared){
    const doc=xml(bytes,'工作表'),rows=all(doc,'row');if(rows.length>MAX_ROWS+100)throw new Error('工作表行数过多，请拆分到 10000 条以内。');
    return rows.map((row,i)=>({number:row.getAttribute('r')||String(i+1),cells:children(row,'c').map(c=>({col:column(c.getAttribute('r')),...cellValue(c,shared)})).filter(c=>c.col)}));
  }
  function readSheet(bytes,shared){
    const rows=sheetRows(bytes,shared),headers=[];
    for(let i=0;i<rows.length;i++){
      const ids=rows[i].cells.filter(c=>headerKind(c.value)==='id'),secs=rows[i].cells.filter(c=>headerKind(c.value)==='seconds');
      if(ids.length&&secs.length){if(ids.length!==1||secs.length!==1)throw new Error('表头有重复的分镜编号或推荐时长列，请只保留一列。');headers.push({index:i,id:ids[0].col,seconds:secs[0].col});}
    }
    if(headers.length>1)throw new Error('同一工作表中发现多个时长表头，请只保留一个。');
    if(!headers.length)return null;
    const header=headers[0],durations={},warnings=[];let hasFormula=false,count=0;
    for(const row of rows.slice(header.index+1)){
      const idCell=row.cells.find(c=>c.col===header.id),secCell=row.cells.find(c=>c.col===header.seconds);
      if(idCell?.error||secCell?.error)throw new Error('第 '+row.number+' 行'+(idCell?.error||secCell.error)+'，请在 Excel 中修正并保存后再导入。');
      if(!idCell?.value&&!secCell?.value)continue;
      const id=normalizeId(idCell?.value);if(!id)throw new Error('第 '+row.number+' 行的分镜编号无效，请使用 1-1 这样的文本格式。');
      const duration=number(secCell?.value);if(duration===null)throw new Error('第 '+row.number+' 行（'+id+'）的推荐时长无效，请填写大于0的整数秒数。');
      if(Object.hasOwn(durations,id))throw new Error('分镜 '+id+' 在时长表中重复，请核对后再导入。');
      durations[id]=duration;count++;if(idCell?.formula||secCell?.formula)hasFormula=true;
      if(count>MAX_ROWS)throw new Error('时长记录超过10000条，请拆分后导入。');
    }
    if(!count)throw new Error('找到时长表头，但没有可用的分镜数据。');
    if(hasFormula)warnings.push('表格含公式，读取的是文件中保存的计算结果，请先在 Excel 中重新计算并保存。');
    return {durations,count,warnings};
  }
  function sheetFiles(files){
    const workbook=xml(files['xl/workbook.xml'],'工作簿'),rels=xml(files['xl/_rels/workbook.xml.rels'],'工作表关系');
    const targets=new Map(Array.from(rels.getElementsByTagNameNS(PACKAGE_REL_NS,'Relationship')).map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
    const sheets=all(workbook,'sheet');if(!sheets.length||sheets.length>MAX_SHEETS)throw new Error('工作表数量无效或超过30个。');
    return sheets.map(s=>{
      const id=s.getAttributeNS(REL_NS,'id')||s.getAttribute('r:id'),target=targets.get(id)||'';
      const relative=target.replace(/^\//,'').replace(/^xl\//,'');
      if(!/^worksheets\/[^/]+\.xml$/i.test(relative))throw new Error('工作表路径不受支持。');
      return {name:s.getAttribute('name')||'工作表',path:'xl/'+relative};
    });
  }
  async function readDurationFile(file){
    if(!file||typeof file.arrayBuffer!=='function')throw new Error('请选择 Excel .xlsx 秒数表。');
    if(!/\.xlsx$/i.test(file.name||''))throw new Error('请选择 Excel .xlsx 秒数表。');
    if(file.size>MAX_FILE)throw new Error('时长表超过10 MB，请拆分后导入。');
    if(!root.DOMParser||!root.fflate?.unzipSync)throw new Error('本地表格读取组件未载入。');
    const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length>MAX_FILE)throw new Error('时长表超过10 MB。');
    if(bytes.length<4||bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('文件不是有效的 XLSX 表格。');
    let declaredTotal=0,tooLarge=false,files;
    try{files=root.fflate.unzipSync(bytes,{filter:e=>{
      const needed=e.name==='xl/workbook.xml'||e.name==='xl/_rels/workbook.xml.rels'||e.name==='xl/sharedStrings.xml'||/^xl\/worksheets\/[^/]+\.xml$/i.test(e.name);
      if(!needed)return false;declaredTotal+=e.originalSize;if(e.originalSize>MAX_XML||declaredTotal>MAX_TOTAL){tooLarge=true;return false;}return true;
    }});}catch{throw new Error('无法解压 XLSX，请确认表格没有损坏或加密。');}
    if(tooLarge)throw new Error('表格解压后内容过大，请拆分后导入。');
    const shared=sharedValues(files['xl/sharedStrings.xml']),sheets=sheetFiles(files),found=[];
    for(const sheet of sheets){const result=readSheet(files[sheet.path],shared);if(result)found.push({...result,sheet:sheet.name});}
    if(!found.length)throw new Error('没有找到“分镜”和“推荐时长（秒）”表头，请检查表格。');
    if(found.length>1)throw new Error('多个工作表都含有时长表，请只保留一个表后导入。');
    return {name:String(file.name||'时长表.xlsx'),...found[0]};
  }
  return Object.freeze({readDurationFile,normalizeId,number,_test:{readSheet,sharedValues,sheetFiles}});
});
