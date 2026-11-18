import {h,go,btn,banner,toast} from '../ui.js';
import {call,errMsg,whenUser,db,app,auth,collection,onSnapshot,query,where,orderBy,limit,doc,updateDoc,serverTimestamp} from '../firebase.js';
import {logout} from './agents.js';
import {VAPID_KEY} from '../config.js';
const COL={submitted:'#1B9E5A',flagged:'#D93025',active:'#2F6FD0',silent:'#B86E00'};
const LBL={submitted:'Result in',flagged:'Flagged',active:'Reporting',silent:'Silent 40+ min'};
const status=u=>u.resultStatus==='flagged'?'flagged':u.resultStatus==='submitted'?'submitted':(u.lastSeen&&Date.now()-u.lastSeen<2400000)?'active':'silent';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const loadJs=src=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.append(s)});
const LEAF='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min';

export function dashboard(){const root=h('section',{class:'screen dash'},h('p',{class:'sub'},'Loading…'));const offs=[];let map,group,fitted=false;
  root._cleanup=()=>{offs.forEach(f=>f());if(map)map.remove()};
  whenUser().then(async s=>{if(!s||!['owner','admin','coordinator'].includes(s.claims.role)){go('admin-login');return}
    const pid=s.claims.partyId,S={units:[],alerts:[],f:{st:'',lga:'',status:'',q:''}};
    // Coordinators must query inside their area (Firestore rules are not filters), so scope the listeners.
    const W=()=>{const c=s.claims;if(c.role!=='coordinator')return[];const w=[where('stateCode','==',c.stateCode)];if(c.scopeLevel!=='state')w.push(where('lgaCode','==',c.lgaCode));if(c.scopeLevel==='ward')w.push(where('wardCode','==',c.wardCode));return w};
    const sel=(k,label)=>h('select',{'aria-label':label,onchange:e=>{S.f[k]=e.target.value;if(k==='st')S.f.lga='';fitted=false;refresh()}});
    const fSt=sel('st','State'),fLga=sel('lga','LGA'),fStatus=sel('status','Status');
    const fQ=h('input',{type:'search',placeholder:'Search unit or agent','aria-label':'Search',oninput:e=>{S.f.q=e.target.value.toLowerCase();refresh()}});
    const kpis=h('div',{class:'kpis'}),mapDiv=h('div',{class:'map',role:'application','aria-label':'Map of polling units'}),charts=h('div',{class:'card'}),alertsEl=h('div',{class:'card'});
    const pushBtn=btn('Enable alerts',{kind:'outline',onclick:enablePush}),csvBtn=btn('Export CSV',{kind:'outline',onclick:exportCsv});
    root.replaceChildren(h('div',{class:'toprow'},h('button',{class:'back',onclick:s.claims.role==='coordinator'?logout:()=>go('agents')},s.claims.role==='coordinator'?'‹ Sign out':'‹ Agents'),h('div',{class:'dbtns'},pushBtn,csvBtn)),h('h1',{},'Live dashboard'),
      h('div',{class:'filters'},fSt,fLga,fStatus,fQ),kpis,h('div',{class:'dgrid'},mapDiv,h('div',{class:'side'},charts,alertsEl)));
    try{if(!window.L){const l=h('link',{rel:'stylesheet',href:LEAF+'.css'});document.head.append(l);await loadJs(LEAF+'.js')}
      map=L.map(mapDiv).setView([9.08,8.67],6);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);group=L.layerGroup().addTo(map)}
    catch{mapDiv.replaceChildren(banner('warn','Map could not load (it needs internet). Lists and charts still work.'))}
    const list=()=>S.units.filter(u=>(!S.f.st||u.stateCode===S.f.st)&&(!S.f.lga||(u.stateCode+':'+u.lgaCode)===S.f.lga)&&(!S.f.status||status(u)===S.f.status)&&(!S.f.q||(u.name+' '+(u.agentName||'')+' '+u.puCode).toLowerCase().includes(S.f.q)));
    const opts=(el,vals,cur,all)=>{el.replaceChildren(h('option',{value:''},all),...vals.map(([v,l])=>h('option',{value:v,selected:v===cur},l)))};
    function refresh(){const all=S.units,u=list();
      opts(fSt,[...new Map(all.map(x=>[x.stateCode,x.stateName||x.stateCode])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),S.f.st,'All states');opts(fLga,[...new Map(all.filter(x=>!S.f.st||x.stateCode===S.f.st).map(x=>[x.stateCode+':'+x.lgaCode,(S.f.st?'':(x.stateName||x.stateCode)+' · ')+(x.lgaName||x.lgaCode)])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),S.f.lga,'All LGAs');
      fStatus.replaceChildren(h('option',{value:''},'All statuses'),...Object.keys(LBL).map(k=>h('option',{value:k,selected:S.f.status===k},LBL[k])));
      const cnt={submitted:0,flagged:0,active:0,silent:0};u.forEach(x=>cnt[status(x)]++);
      const k=(n,l,c)=>h('div',{class:'kpi'},h('b',{style:c?`color:${c}`:''},n),h('small',{},l));
      kpis.replaceChildren(k(u.length,'Polling units'),k(cnt.submitted+cnt.flagged,'Results in',COL.submitted),k(cnt.flagged,'Flagged',COL.flagged),k(cnt.silent,'Silent 40+ min',COL.silent),k(u.reduce((a,x)=>a+(x.incidents||0),0),'Incidents'),k(u.reduce((a,x)=>a+(x.accredited||0),0).toLocaleString(),'Accredited'));
      const tot=u.length||1,votes={};u.forEach(x=>Object.entries(x.votes||{}).forEach(([p,v])=>votes[p]=(votes[p]||0)+v));const mx=Math.max(1,...Object.values(votes));
      charts.replaceChildren(h('b',{},'Polling units by status'),h('div',{class:'stack','aria-hidden':'true'},...Object.keys(LBL).map(x=>h('i',{style:`width:${cnt[x]/tot*100}%;background:${COL[x]}`}))),
        h('div',{class:'legend'},...Object.keys(LBL).map(x=>h('span',{},h('i',{style:`background:${COL[x]}`}),`${LBL[x]} ${cnt[x]}`))),
        h('b',{style:'margin-top:14px;display:block'},'Votes by party (units reported)'),
        Object.keys(votes).length?h('div',{class:'bars'},...Object.entries(votes).map(([p,v])=>h('div',{class:'bcol'},h('small',{},v.toLocaleString()),h('div',{class:'bar',style:`height:${v/mx*100}px`}),h('small',{},p)))):h('p',{class:'sub'},'No results yet.'));
      if(group){group.clearLayers();u.forEach(x=>{if(typeof x.lat!=='number')return;const c=COL[status(x)];
        L.circleMarker([x.lat,x.lng],{radius:8,color:c,fillColor:c,fillOpacity:.8}).bindPopup(`<b>${esc(x.name)}</b><br>${esc(x.agentName)}<br>${LBL[status(x)]}<br>Accredited ${x.accredited||0} · Incidents ${x.incidents||0}`).addTo(group)});
        if(!fitted&&u.length){map.fitBounds(L.featureGroup(group.getLayers()).getBounds().pad(.2));fitted=true}}
      alertsEl.replaceChildren(h('b',{},'Alerts'),...(S.alerts.length?S.alerts.map(a=>h('div',{class:'alert'+(a.acknowledgedBy?' done':'')},h('div',{},h('b',{},a.title),h('p',{class:'sub'},a.body),h('small',{},a.createdAt?a.createdAt.toDate().toLocaleTimeString():'')),
        a.acknowledgedBy?h('span',{class:'chip'},'Seen'):h('button',{class:'back',onclick:()=>updateDoc(doc(db,`parties/${pid}/alerts`,a.id),{acknowledgedBy:auth.currentUser.uid,acknowledgedAt:serverTimestamp()})},'Acknowledge'))):[h('p',{class:'sub'},'No alerts.')]))}
    function exportCsv(){const rows=[['puCode','name','lga','agent','status','accredited','incidents','totalVotes'],...list().map(x=>[x.puCode,x.name,x.lgaCode,x.agentName,LBL[status(x)],x.accredited||0,x.incidents||0,x.totalVotes||0])];
      const a=h('a',{href:URL.createObjectURL(new Blob([rows.map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n')],{type:'text/csv'})),download:'units.csv'});a.click()}
    async function enablePush(){try{if(VAPID_KEY==='REPLACE_ME')throw new Error('Web push is not configured. Add the Firebase Web Push VAPID key in js/config.js.');
      const M=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js');if(!(await M.isSupported()))throw new Error('Push is not supported in this browser.');
      if(await Notification.requestPermission()!=='granted')throw new Error('Notifications are blocked for this site.');
      const reg=await navigator.serviceWorker.register('firebase-messaging-sw.js',{scope:'./fcm/'});const m=M.getMessaging(app);
      const token=await M.getToken(m,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});await call('subscribeStaffPush',{token});M.onMessage(m,p=>toast(p.notification?.title||'New alert'));toast('Alerts enabled on this device')}catch(x){toast(errMsg(x))}}
    offs.push(onSnapshot(query(collection(db,`parties/${pid}/units`),...W()),sn=>{S.units=sn.docs.map(d=>({id:d.id,...d.data()}));refresh()},e=>toast(e.message)));
    offs.push(onSnapshot(query(collection(db,`parties/${pid}/alerts`),...W(),orderBy('createdAt','desc'),limit(30)),sn=>{S.alerts=sn.docs.map(d=>({id:d.id,...d.data()}));refresh()},e=>toast(`Could not load alerts: ${e.message}`)));
    refresh()});
  return root}
