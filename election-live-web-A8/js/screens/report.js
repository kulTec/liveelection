import {h,go,back,btn,banner,toast,field} from '../ui.js';
import {get,set} from '../store.js';
import {enqueue,compress,stats,onChange,isBusy,flush,retryFailed} from '../queue.js';
import {PARTIES} from '../config.js';
import {logout} from './agents.js';

function pill(){const b=h('button',{class:'pill',onclick:flush,'aria-live':'polite'});
  const upd=async()=>{const s=await stats(),off=!navigator.onLine;b.className='pill '+(off||s.pending?'off':'ok');
    b.textContent=isBusy()?'● Sending…':off?`● Offline · ${s.pending} queued`:s.pending?`● ${s.pending} waiting · tap to send`:'● Synced'};
  upd();addEventListener('online',upd);addEventListener('offline',upd);const un=onChange(upd);b._off=()=>{un();removeEventListener('online',upd);removeEventListener('offline',upd)};return b}
const tile=(t,s,g,to)=>h('button',{class:'tile',onclick:()=>go(to)},h('span',{class:'ti'},g),h('b',{},t),h('small',{},s));
const guard=()=>{if(!get('agent')){go('agent-login');return false}return true};
const sendErr=x=>x.message||'Could not save the report.';

export function agentHome(){if(!guard())return h('div');const a=get('agent'),p=pill(),fail=h('div'),off=h('div');
  const root=h('section',{class:'screen'},h('div',{class:'toprow'},h('b',{},a.agentCode),p),
    h('div',{class:'hero'},h('span',{},'Your polling unit'),h('b',{style:'font-size:20px'},a.puCode),h('span',{},'GPS is checked on every report')),
    off,h('div',{class:'tiles'},tile('Accreditation',`${get('acc')??0} voters`,'#','agent-accr'),tile('Report incident','Photo optional','!','agent-incident'),tile('Enter result',get('resultSent')?'Sent ✓':'Votes + sheet photo','✓','agent-result')),
    fail,h('div',{class:'spacer'}),btn('Sign out',{kind:'ghost',onclick:logout}));
  const showFail=async()=>{const s=await stats();fail.replaceChildren(...(s.failed.length?[banner('error',`${s.failed.length} report(s) could not be sent: ${s.failed[0].error||'rejected'}`),btn('Try again',{kind:'outline',onclick:retryFailed})]:[]))};
  const showOff=()=>off.replaceChildren(...(navigator.onLine?[]:[banner('warn','No network. Your entries are saved on this phone and will send automatically.')]));
  showOff();addEventListener('online',showOff);addEventListener('offline',showOff);
  showFail();const un=onChange(showFail);root._cleanup=()=>{p._off();un();removeEventListener('online',showOff);removeEventListener('offline',showOff)};return root}

export function accreditation(){if(!guard())return h('div');let n=get('acc')||0,err='',busy=false;const root=h('section',{class:'screen'});
  const draw=()=>root.replaceChildren(back('agent-home','‹ Home'),h('h1',{},'Accreditation'),h('p',{class:'sub'},'Voters accredited so far at your unit.'),err&&banner('error',err),
    h('div',{class:'counter'},h('button',{class:'cbtn','aria-label':'Minus one',onclick:()=>{n=Math.max(0,n-1);draw()}},'−'),h('output',{},n),h('button',{class:'cbtn','aria-label':'Plus one',onclick:()=>{n++;draw()}},'+')),
    h('div',{class:'two'},btn('+10',{kind:'outline',onclick:()=>{n+=10;draw()}}),btn('+50',{kind:'outline',onclick:()=>{n+=50;draw()}})),h('div',{class:'spacer'}),
    btn('Save count',{loading:busy,onclick:async()=>{busy=true;err='';draw();try{await enqueue('accreditation',{count:n});set('acc',n);toast(navigator.onLine?'Saved':'Saved on phone, will send when online');go('agent-home')}catch(x){busy=false;err=sendErr(x);draw()}}}));
  draw();return root}

const CATS=['Violence','Vote buying','BVAS failure','Late materials','Other'];
export function incident(){if(!guard())return h('div');const s={cat:'Violence',sev:'medium',note:'',blob:null,err:'',busy:false};const root=h('section',{class:'screen'});
  const chip=(l,on,fn,cls='')=>h('button',{class:'chipb'+(on?' on '+cls:''),onclick:fn},l);
  const draw=()=>root.replaceChildren(back('agent-home','‹ Home'),h('h1',{},'Report incident'),s.err&&banner('error',s.err),
    h('div',{class:'chips'},...CATS.map(c=>chip(c,s.cat===c,()=>{s.cat=c;draw()}))),h('b',{},'How serious?'),
    h('div',{class:'chips'},...['low','medium','high'].map(v=>chip(v[0].toUpperCase()+v.slice(1),s.sev===v,()=>{s.sev=v;draw()},v==='high'?'hi':''))),
    field({id:'note',label:'Short note (optional)',value:s.note,oninput:e=>s.note=e.target.value}),
    h('label',{class:'btn outline'},s.blob?'✓ Photo added':'Add photo',h('input',{type:'file',accept:'image/*',capture:'environment',hidden:true,onchange:async e=>{if(e.target.files[0]){s.blob=await compress(e.target.files[0]);draw()}}})),
    h('div',{class:'spacer'}),btn('Send report',{loading:s.busy,onclick:async()=>{s.busy=true;s.err='';draw();try{await enqueue('incident',{category:s.cat,severity:s.sev,note:s.note.slice(0,200)},s.blob);toast(navigator.onLine?'Incident sent':'Saved on phone, will send when online');go('agent-home')}catch(x){s.busy=false;s.err=sendErr(x);draw()}}}));
  draw();return root}

// ---- Result: 4 pages (votes > sheet photo > review > done). The draft is kept while the agent moves between them. ----
const R={votes:{},blob:null,url:'',ref:'',queued:false};
const tot=()=>Object.values(R.votes).reduce((a,b)=>a+(+b||0),0);

export function resultVotes(){if(!guard())return h('div');const acc=get('acc')||0,root=h('section',{class:'screen'});
  const okNext=()=>acc>0&&tot()>0&&tot()<=acc;
  root.replaceChildren(back('agent-home','‹ Home'),h('h1',{},'Enter result'),h('p',{class:'sub'},`Votes per party. Total must not be more than ${acc} accredited.`),
    acc===0&&banner('warn','Save your accreditation count first.'),
    h('div',{class:'card'},...PARTIES.map(p=>h('div',{class:'arow'},h('b',{},p),h('input',{class:'vin',inputmode:'numeric',value:R.votes[p]||'',placeholder:'0','aria-label':p+' votes',oninput:e=>{R.votes[p]=e.target.value.replace(/\D/g,'');e.target.value=R.votes[p];sum()}})))),
    h('div',{class:'banner ok',id:'sum'},''),h('div',{class:'spacer'}),btn('Next: photograph result sheet',{id:'nx',onclick:()=>go('agent-sheet')}));
  function sum(){const e=root.querySelector('#sum'),over=tot()>acc;e.className='banner '+(over?'error':'ok');e.textContent=`Total ${tot()} of ${acc} accredited`+(over?'. Check your figures.':'');root.querySelector('#nx').disabled=!okNext()}
  sum();return root}

export function resultSheet(){if(!guard())return h('div');const root=h('section',{class:'screen'});
  const draw=()=>root.replaceChildren(back('agent-result','‹ Result'),h('h1',{},'Result sheet'),h('p',{class:'sub'},'Place the sheet flat. Make sure all figures are readable.'),
    R.blob?h('img',{class:'sheet',src:R.url||(R.url=URL.createObjectURL(R.blob)),alt:'Result sheet photo'}):h('div',{class:'camph'},'No photo yet'),
    h('label',{class:'btn outline'},R.blob?'Retake photo':'Take photo',h('input',{type:'file',accept:'image/*',capture:'environment',hidden:true,onchange:async e=>{if(e.target.files[0]){R.blob=await compress(e.target.files[0]);R.url='';draw()}}})),
    R.blob&&banner('ok','Photo saved with the time and your location.'),h('div',{class:'spacer'}),btn('Review and submit',{disabled:!R.blob,onclick:()=>go('agent-review')}));
  draw();return root}

export function resultReview(){if(!guard())return h('div');const acc=get('acc')||0;if(!tot()||!R.blob){go('agent-result');return h('div')}
  let busy=false,err='';const root=h('section',{class:'screen'});
  const row=(l,v)=>h('div',{class:'arow'},h('span',{},l),h('b',{},String(v)));
  const draw=()=>root.replaceChildren(back('agent-sheet'),h('h1',{},'Review result'),h('p',{class:'sub'},'Check carefully. You can’t edit after submitting.'),err&&banner('error',err),
    h('div',{class:'card'},row('Accredited',acc),...PARTIES.map(p=>row(p,+R.votes[p]||0)),row('Total votes',tot()),row('Result sheet','Photo attached ✓')),
    h('div',{class:'spacer'}),btn('Submit result',{loading:busy,onclick:submit}));
  const submit=async()=>{busy=true;err='';draw();
    try{const votes={};PARTIES.forEach(p=>votes[p]=+R.votes[p]||0);const id=await enqueue('result',{votes,accredited:acc},R.blob);
      set('resultSent',true);R.ref='RS-'+id.slice(0,6).toUpperCase();R.queued=!navigator.onLine;R.votes={};R.blob=null;R.url='';go('agent-done')}
    catch(x){busy=false;err=sendErr(x);draw()}};
  draw();return root}

export function resultDone(){if(!R.ref){go('agent-home');return h('div')}
  return h('section',{class:'screen'},h('div',{class:'tick','aria-hidden':'true'},'✓'),h('h1',{},R.queued?'Result saved on your phone':'Result submitted'),
    h('p',{class:'sub'},R.queued?'It will send as soon as you are online. Reference:':'Your reference number:'),h('div',{class:'regno'},R.ref),h('div',{class:'spacer'}),btn('Back to home',{onclick:()=>go('agent-home')}))}
