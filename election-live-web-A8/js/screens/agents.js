import {h,go,back,btn,banner,toast,field} from '../ui.js';
import {get,set,uuid} from '../store.js';
import {auth,db,call,errMsg,whenUser,signInWithCustomToken,signOut,collection,onSnapshot,query,where,getDocs,limit} from '../firebase.js';
import {STATES} from '../states.js';
const uniq=pairs=>[...new Map(pairs).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
const sel=(label,id,opts,val,on)=>h('div',{class:'field'},h('label',{for:id},label),h('select',{id,class:'sel',onchange:e=>on(e.target.value)},h('option',{value:''},'Choose…'),...opts.map(([v,l])=>h('option',{value:v,selected:v===val},l))));
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const deviceId=()=>{let d=get('deviceId');if(!d){d=uuid();set('deviceId',d)}return d};   // survives sign-out: one phone = one agent
export const logout=async()=>{await signOut(auth);set('party',null);set('agent',null);go('welcome')};

export function agentLogin(){const s={id:'',code:'',step:1,loading:false,err:''};const root=h('section',{class:'screen'});
  const draw=()=>root.replaceChildren(back('welcome'),h('h1',{},'Agent login'),
    h('p',{class:'sub'},s.step===1?'Enter your agent ID. We’ll email you a code.':'Enter the 6-digit code sent to your email.'),s.err&&banner('error',s.err),
    h('div',{class:'field'},h('label',{for:'aid'},'Agent ID'),h('input',{id:'aid',value:s.id,placeholder:'ACC-KN-0112-007',autocapitalize:'characters',oninput:e=>{s.id=e.target.value.toUpperCase();e.target.value=s.id}})),
    s.step===2&&h('div',{class:'field'},h('label',{for:'ac'},'Email code'),h('input',{id:'ac',value:s.code,inputmode:'numeric',maxlength:6,autocomplete:'one-time-code',oninput:e=>s.code=e.target.value.replace(/\D/g,'')})),
    h('div',{class:'spacer'}),btn(s.step===1?'Send code':'Log in',{loading:s.loading,onclick:s.step===1?send:login}),
    s.step===2&&btn('Use a different ID',{kind:'ghost',onclick:()=>{s.step=1;s.code='';s.err='';draw()}}));
  const send=async()=>{if(s.id.trim().length<8){s.err='Enter your full agent ID.';draw();return}s.loading=true;s.err='';draw();
    try{await call('requestAgentOtp',{agentCode:s.id.trim()});s.step=2;s.loading=false;draw()}catch(x){s.loading=false;s.err=errMsg(x);draw()}};
  const login=async()=>{if(s.code.length<6){s.err='Enter the 6-digit code.';draw();return}s.loading=true;s.err='';draw();
    try{const r=await call('verifyAgentLogin',{agentCode:s.id.trim(),code:s.code,deviceId:deviceId()});await signInWithCustomToken(auth,r.token);
      set('agent',{agentCode:s.id.trim(),puCode:r.puCode,partyId:r.partyId});go('agent-home')}catch(x){s.loading=false;s.err=errMsg(x);draw()}};
  draw();return root}

export function agentHome(){const a=get('agent');if(!a){go('agent-login');return h('div')}
  return h('section',{class:'screen'},h('div',{class:'brand'},h('div',{class:'logo'},'A'),a.agentCode),h('h1',{},'You are logged in'),
    h('div',{class:'card'},h('b',{},'Polling unit'),h('p',{class:'sub'},a.puCode)),
    banner('warn','Reporting screens and the offline queue arrive in module A3.'),h('div',{class:'spacer'}),btn('Sign out',{kind:'outline',onclick:logout}))}

function parseCsv(text){const lines=text.trim().split(/\r?\n/).filter(Boolean);if(lines[0]&&/email/i.test(lines[0]))lines.shift();
  return lines.map(l=>{const [name,email,puCode]=l.split(',').map(x=>(x||'').trim());return{name,email,puCode,ok:!!name&&EMAIL.test(email||'')&&!!puCode}})}
const csvTemplate=()=>{const a=h('a',{href:URL.createObjectURL(new Blob(['name,email,puCode\nMusa Abdullahi,musa@example.com,24-05-12-007\n'],{type:'text/csv'})),download:'agents-template.csv'});a.click()};

export function agents(){const root=h('section',{class:'screen'},h('p',{class:'sub'},'Loading…'));let unsub;root._cleanup=()=>unsub&&unsub();
  whenUser().then(s=>{if(!s||!['owner','admin'].includes(s.claims.role)){go('admin-login');return}
    const pid=s.claims.partyId,st={rows:[],review:null,busy:false,results:null,err:'',add:{name:'',email:'',state:'',lga:'',ward:'',puCode:''},addOpen:false};
    const live=()=>st.rows.filter(a=>a.status!=='revoked');
    const draw=()=>{const bad=st.review?st.review.filter(r=>!r.ok).length:0,good=st.review?st.review.length-bad:0;
      root.replaceChildren(h('button',{class:'back',onclick:logout},'‹ Sign out'),h('h1',{},'Agents'),btn('Open live dashboard',{onclick:()=>go('dashboard')}),btn('Coordinators',{kind:'outline',onclick:()=>go('coordinators')}),h('p',{class:'sub'},`${live().length} agents · live`),
        st.err&&banner('error',st.err),
        h('label',{class:'btn outline'},'Bulk upload CSV',h('input',{type:'file',accept:'.csv,text/csv',hidden:true,onchange:async e=>{const f=e.target.files[0];if(!f)return;st.review=parseCsv(await f.text());st.results=null;draw()}})),
        btn('Download CSV template',{kind:'ghost',onclick:csvTemplate}),st.addOpen?addForm():btn('Add one agent',{kind:'outline',onclick:()=>{st.addOpen=true;draw()}}),
        st.review&&h('div',{class:'card'},h('b',{},`${good} valid · ${bad} with errors`),h('p',{class:'sub'},'Columns: name, email, puCode (INEC polling unit code).'),
          btn(`Import ${good} agents`,{loading:st.busy,disabled:!good,onclick:doImport})),
        st.results&&h('div',{class:'card'},h('b',{},`${st.results.filter(r=>r.ok).length} created`),...st.results.filter(r=>!r.ok).map(r=>h('p',{class:'sub'},`Row ${r.row+2}: ${r.error}`))),
        h('div',{class:'card'},...live().map(a=>h('div',{class:'arow'},h('div',{},h('b',{},a.name),h('p',{class:'sub'},`${a.agentCode} · ${a.puCode}`)),
          h('div',{},h('span',{class:'chip'+(a.status==='active'?'':' off')},a.deviceId?'Phone bound':'No phone yet'),a.deviceId&&h('button',{class:'back',onclick:()=>reset(a.id)},'Reset phone'),h('button',{class:'back',onclick:()=>remove(a)},'Remove')))),!live().length&&h('p',{class:'sub'},'No agents yet. Upload a CSV.')))};
    const reset=async id=>{try{await call('resetAgentDevice',{agentId:id});toast('Phone reset')}catch(x){st.err=errMsg(x);draw()}};
    const doImport=async()=>{st.busy=true;st.err='';draw();const rows=st.review.filter(r=>r.ok),res=[];
      try{for(let i=0;i<rows.length;i+=200){const r=await call('createAgents',{agents:rows.slice(i,i+200)});res.push(...r.results.map(x=>({...x,row:x.row+i})))}st.results=res;st.review=null}catch(x){st.err=errMsg(x)}
      st.busy=false;draw()};
    const pickState=async v=>{st.add.state=v;st.add.lga='';st.add.ward='';st.add.puCode='';st.pu=[];draw();if(!v)return;
      try{const sn=await getDocs(query(collection(db,'polling_units'),where('stateCode','==',v),limit(2000)));st.pu=sn.docs.map(d=>({code:d.id,...d.data()}))}catch(e){st.err=e.message}draw()};
    const addForm=()=>{const us=st.pu||[],taken=new Set(live().map(a=>a.puCode)),A=st.add;
      const lgas=uniq(us.map(u=>[u.lgaCode,u.lgaName||u.lgaCode])),wards=uniq(us.filter(u=>u.lgaCode===A.lga).map(u=>[u.wardCode,'Ward '+u.wardCode])),
        pus=us.filter(u=>u.lgaCode===A.lga&&u.wardCode===A.ward&&!taken.has(u.code)).map(u=>[u.code,u.name]),pre=(live()[0]?.agentCode||'XXX-').split('-')[0];
      return h('div',{class:'card'},h('b',{},'Add one agent'),
        field({id:'an',label:'Full name',value:A.name,oninput:e=>A.name=e.target.value}),
        field({id:'ae',label:'Email',type:'email',value:A.email,oninput:e=>A.email=e.target.value}),
        sel('State','as',STATES,A.state,pickState),
        A.state&&sel('LGA','al',lgas,A.lga,v=>{A.lga=v;A.ward='';A.puCode='';draw()}),
        A.lga&&sel('Ward','aw',wards,A.ward,v=>{A.ward=v;A.puCode='';draw()}),
        A.ward&&sel('Polling unit (free ones only)','ap',pus,A.puCode,v=>{A.puCode=v;draw()}),
        A.state&&!us.length&&banner('warn','No polling units found for this state.'),
        A.puCode&&h('div',{class:'idprev'},h('small',{},'Agent ID will look like'),h('b',{},`${pre}-${A.state}-${A.ward}-###`),h('small',{},'The last digits are added automatically.')),
        btn('Add agent',{loading:st.busy,disabled:!A.puCode,onclick:saveOne}),btn('Cancel',{kind:'ghost',onclick:()=>{st.addOpen=false;draw()}}))};
    const saveOne=async()=>{st.busy=true;st.err='';draw();
      try{const r=await call('createAgents',{agents:[{name:st.add.name,email:st.add.email,puCode:st.add.puCode.trim()}]});const x=r.results[0];
        if(x.ok){toast('Agent created: '+x.agentCode);st.add={name:'',email:'',state:'',lga:'',ward:'',puCode:''};st.pu=[];st.addOpen=false}else st.err=x.error}catch(e){st.err=errMsg(e)}
      st.busy=false;draw()};
    const remove=async a=>{if(!confirm(`Remove ${a.name} (${a.agentCode})? They are logged out of reporting and the polling unit becomes free.`))return;
      try{await call('removeAgent',{agentId:a.id});toast('Agent removed')}catch(e){st.err=errMsg(e);draw()}};
    unsub=onSnapshot(collection(db,`parties/${pid}/agents`),snap=>{st.rows=snap.docs.map(d=>({id:d.id,...d.data()}));draw()},e=>{st.err=e.message;draw()})})
  return root}
