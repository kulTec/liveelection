// Tiny DOM helpers + shared UI pieces
export const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs||{})){if(k==='class')e.className=v;else if(k.startsWith('on'))e.addEventListener(k.slice(2),v);else if(v===true)e.setAttribute(k,'');else if(v!==false&&v!=null)e.setAttribute(k,v)}
  kids.flat(9).forEach(x=>{if(x===false||x==null)return;e.append(x.nodeType?x:document.createTextNode(String(x)))});return e};
export const toast=t=>{const el=document.getElementById('toast');el.textContent=t;el.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('on'),2200)};
export const go=r=>{location.hash='#/'+r};
export const back=(to,label='‹ Back')=>h('button',{class:'back',onclick:()=>go(to)},label);
export const btn=(label,{kind='',onclick,loading=false,disabled=false,id}={})=>h('button',{id,type:'button',class:`btn ${kind} ${loading?'loading':''}`,onclick,disabled:disabled||loading,'aria-busy':loading},loading&&h('span',{class:'spin'}),loading?'Please wait…':label);
export const field=({id,label,type='text',value='',placeholder='',hint='',error='',autocomplete,oninput})=>{
  const d=[hint&&!error&&id+'-h',error&&id+'-e'].filter(Boolean).join(' ');
  return h('div',{class:'field'},h('label',{for:id},label),
    h('input',{id,type,value,placeholder,autocomplete,'aria-invalid':!!error,'aria-describedby':d||null,oninput}),
    hint&&!error&&h('span',{class:'hint',id:id+'-h'},hint),error&&h('span',{class:'err',id:id+'-e',role:'alert'},error))};
export const banner=(kind,text)=>h('div',{class:'banner '+kind,role:kind==='error'?'alert':'status'},text);
