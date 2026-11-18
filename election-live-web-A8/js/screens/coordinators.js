import {h,go,back,btn,banner,field} from '../ui.js';
import {call,errMsg,whenUser,db,collection,onSnapshot} from '../firebase.js';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uniq=pairs=>[...new Map(pairs).entries()].sort((a,b)=>a[1].localeCompare(b[1]));

export function coordinators(){const root=h('section',{class:'screen'},h('p',{class:'sub'},'Loading…'));let offUnits,offCoordinators;root._cleanup=()=>{offUnits&&offUnits();offCoordinators&&offCoordinators()};
  whenUser().then(s=>{if(!s||!['owner','admin'].includes(s.claims.role)){go('admin-login');return}
    const pid=s.claims.partyId,st={units:[],coordinators:[],name:'',email:'',level:'ward',state:'',lga:'',ward:'',busy:false,err:'',listErr:'',ok:''};
    const sel=(label,id,opts,val,on,blank=true)=>h('div',{class:'field'},h('label',{for:id},label),
      h('select',{id,class:'sel',onchange:e=>on(e.target.value)},blank&&h('option',{value:''},'Choose…'),...opts.map(([v,l])=>h('option',{value:v,selected:v===val},l))));
    const draw=()=>{const states=uniq(st.units.map(u=>[u.stateCode,u.stateName||u.stateCode])),
        lgas=uniq(st.units.filter(u=>u.stateCode===st.state).map(u=>[u.lgaCode,u.lgaName||u.lgaCode])),
        wards=uniq(st.units.filter(u=>u.stateCode===st.state&&u.lgaCode===st.lga).map(u=>[u.wardCode,'Ward '+u.wardCode]));
      root.replaceChildren(back('agents','‹ Agents'),h('h1',{},'Coordinators'),h('p',{class:'sub'},'A coordinator sees only their own area and gets an email to set a password.'),
        st.err&&banner('error',st.err),st.ok&&banner('ok',st.ok),
        h('h2',{},`Coordinator accounts (${st.coordinators.length})`),
        st.listErr&&banner('error',`Could not load coordinators: ${st.listErr}`),
        st.coordinators.length?h('div',{class:'card'},...st.coordinators.map(c=>{
          const state=st.units.find(u=>u.stateCode===c.stateCode),lga=st.units.find(u=>u.stateCode===c.stateCode&&u.lgaCode===c.lgaCode);
          const stateName=state?.stateName||c.stateCode||'Area not set',lgaName=lga?.lgaName||c.lgaCode;
          const area=c.level==='state'?`${stateName} · whole state`:c.level==='ward'?`${stateName} · ${lgaName||''} · Ward ${c.wardCode||''}`:`${stateName} · ${lgaName||''}`;
          return h('div',{class:'arow'},h('div',{},h('b',{},c.name||'Coordinator'),h('p',{class:'sub'},c.email||'No email recorded')),h('span',{class:'chip'},area))
        })):!st.listErr&&h('p',{class:'sub'},'No coordinators created yet.'),
        h('h2',{},'Create coordinator'),
        field({id:'cn',label:'Full name',value:st.name,oninput:e=>st.name=e.target.value}),
        field({id:'ce',label:'Email',type:'email',value:st.email,oninput:e=>st.email=e.target.value}),
        sel('Area limit','lv',[['state','Whole state'],['lga','One LGA'],['ward','One ward']],st.level,v=>{st.level=v;draw()},false),
        sel('State','stt',states,st.state,v=>{st.state=v;st.lga='';st.ward='';draw()}),
        st.level!=='state'&&sel('LGA','lga',lgas,st.lga,v=>{st.lga=v;st.ward='';draw()}),
        st.level==='ward'&&sel('Ward','wd',wards,st.ward,v=>{st.ward=v;draw()}),
        !states.length&&banner('warn','No areas yet. Areas appear after you add agents.'),
        h('div',{class:'spacer'}),btn('Create coordinator',{loading:st.busy,onclick:create}))};
    const create=async()=>{st.err='';st.ok='';
      if(st.name.trim().length<2)st.err='Enter the full name.';else if(!EMAIL.test(st.email.trim()))st.err='Enter a valid email address.';
      else if(!st.state||(st.level!=='state'&&!st.lga)||(st.level==='ward'&&!st.ward))st.err='Choose the area for this coordinator.';
      if(st.err){draw();return}
      st.busy=true;draw();
      try{await call('createCoordinator',{name:st.name.trim(),email:st.email.trim(),level:st.level,stateCode:st.state,lgaCode:st.lga,wardCode:st.ward});st.ok=`Created ${st.name.trim()}. They will get an email to set a password.`;st.name='';st.email=''}
      catch(e){st.err=errMsg(e)}st.busy=false;draw()};
    offUnits=onSnapshot(collection(db,`parties/${pid}/units`),sn=>{st.units=sn.docs.map(d=>d.data());draw()},e=>{st.err=e.message;draw()});
    offCoordinators=onSnapshot(collection(db,`parties/${pid}/coordinators`),sn=>{st.coordinators=sn.docs.map(d=>({id:d.id,...d.data()}));st.listErr='';draw()},e=>{st.listErr=e.message;draw()})});
  return root}
