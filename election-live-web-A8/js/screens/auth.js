import {h,go,back,btn,field,banner,toast} from '../ui.js';
import {get,set} from '../store.js';
import {auth,call,errMsg,signInWithEmailAndPassword} from '../firebase.js';
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;const mmss=n=>`0:${String(n).padStart(2,'0')}`;
const draft={};   // kept in memory only: the password is never written to storage

export function welcome(){return h('section',{class:'screen'},
  h('div',{class:'brand'},h('img',{class:'logo-img',src:'icons/logo-512.png',alt:'Accord logo'}),'Election Live Updates System'),
  h('div',{class:'logo-hero'},h('img',{src:'icons/logo-512.png',alt:'Accord: Oneness and Progress'})),
  h('div',{class:'hero'},h('b',{},'176,846'),h('span',{},'polling units across 774 LGAs and 8,809 wards')),
  h('h1',{},'Every polling unit, live.'),
  h('p',{class:'sub'},'Verified agents report accreditation, incidents and results as they happen.'),
  btn('Create party account',{onclick:()=>go('signup')}),
  btn('I’m an agent',{kind:'outline',onclick:()=>go('agent-login')}),
  btn('Party admin log in',{kind:'ghost',onclick:()=>go('admin-login')}))}

export function signup(){
  const s={name:draft.name||'Accord',email:draft.email||'',password:'',errors:{},loading:false,banner:''};
  const root=h('section',{class:'screen'});
  const draw=()=>root.replaceChildren(back('welcome'),h('h1',{},'Create party account'),
    h('p',{class:'sub'},'We’ll send a code to your email. No phone number needed.'),s.banner&&banner('error',s.banner),
    field({id:'name',label:'Party name',value:s.name,error:s.errors.name,oninput:e=>s.name=e.target.value}),
    field({id:'email',label:'Official email',type:'email',value:s.email,placeholder:'chair@accord.ng',autocomplete:'email',error:s.errors.email,oninput:e=>s.email=e.target.value}),
    field({id:'pw',label:'Password',type:'password',value:s.password,autocomplete:'new-password',hint:'At least 8 characters',error:s.errors.password,oninput:e=>s.password=e.target.value}),
    h('div',{class:'spacer'}),btn('Send email code',{loading:s.loading,onclick:submit}));
  const submit=async()=>{s.errors={};s.banner='';const e=s.errors;
    if(s.name.trim().length<3)e.name='Enter the party name';if(!EMAIL.test(s.email.trim()))e.email='Enter a valid email address';if(s.password.length<8)e.password='Use at least 8 characters';
    if(Object.keys(e).length){draw();root.querySelector('[aria-invalid="true"]')?.focus();return}
    s.loading=true;draw();
    try{await call('requestSignupOtp',{email:s.email.trim()});Object.assign(draft,{name:s.name.trim(),email:s.email.trim().toLowerCase(),password:s.password,sentAt:Date.now()});go('otp')}
    catch(x){s.loading=false;s.banner=errMsg(x);draw()}};
  draw();return root}

export function otp(){
  if(!draft.email){go('signup');return h('div')}
  let left=Math.max(0,60-Math.floor((Date.now()-draft.sentAt)/1000)),err='',busy=false,timer;const root=h('section',{class:'screen'});
  const val=()=>[...root.querySelectorAll('#otp input')].map(i=>i.value).join('');
  const draw=()=>{const boxes=Array.from({length:6},(_,i)=>h('input',{inputmode:'numeric',maxlength:1,autocomplete:i?'off':'one-time-code','aria-label':`Digit ${i+1}`,disabled:busy,oninput:e=>onIn(e,i),onkeydown:e=>{if(e.key==='Backspace'&&!e.target.value&&i>0)e.target.parentNode.children[i-1].focus()},onpaste}));
    root.replaceChildren(back('signup'),h('h1',{},'Check your email'),h('p',{class:'sub'},`Enter the 6-digit code we sent to ${draft.email}. It expires in 10 minutes.`),
      err&&banner('error',err),h('div',{class:'otp'+(err?' bad':''),id:'otp'},boxes),
      left>0?h('p',{class:'sub',id:'rt'},`Resend code in ${mmss(left)}`):btn('Resend code',{kind:'ghost',onclick:resend}),
      h('div',{class:'spacer'}),btn('Verify and continue',{loading:busy,onclick:verify}));if(!busy)boxes[0].focus()};
  const onIn=(e,i)=>{e.target.value=e.target.value.replace(/\D/g,'').slice(-1);const n=e.target.parentNode.children[i+1];if(e.target.value&&n)n.focus();if(val().length===6)verify()};
  const onpaste=e=>{const t=(e.clipboardData.getData('text')||'').replace(/\D/g,'').slice(0,6);if(!t)return;e.preventDefault();[...e.target.parentNode.children].forEach((b,i)=>b.value=t[i]||'');if(t.length===6)verify()};
  const verify=async()=>{if(busy)return;const code=val();if(code.length<6){err='Enter all 6 digits.';draw();return}
    busy=true;err='';draw();
    try{const r=await call('verifySignupOtp',{email:draft.email,partyName:draft.name,password:draft.password,code});
      await signInWithEmailAndPassword(auth,draft.email,draft.password);await auth.currentUser.getIdToken(true);   // pull in the owner role claim
      set('party',{name:draft.name,email:draft.email,regNumber:r.regNumber,partyId:r.partyId});draft.password='';go('registered')}
    catch(x){busy=false;err=errMsg(x);draw()}};
  const resend=async()=>{try{await call('requestSignupOtp',{email:draft.email});draft.sentAt=Date.now();left=60;err='';toast('New code sent');draw();tick()}catch(x){err=errMsg(x);draw()}};
  const tick=()=>{clearInterval(timer);timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return}left=Math.max(0,left-1);if(!left){clearInterval(timer);draw()}else{const t=root.querySelector('#rt');if(t)t.textContent=`Resend code in ${mmss(left)}`}},1000)};
  draw();tick();return root}

export function registered(){const p=get('party');if(!p){go('welcome');return h('div')}
  const copy=async()=>{try{await navigator.clipboard.writeText(p.regNumber);toast('Registration number copied')}catch{toast('Press and hold the number to copy')}};
  return h('section',{class:'screen'},h('div',{class:'tick','aria-hidden':'true'},'✓'),h('h1',{},`${p.name} is registered`),
    h('p',{class:'sub'},'Your party registration number. Keep it safe; we also sent it to your email.'),h('div',{class:'regno'},p.regNumber),
    btn('Copy number',{kind:'outline',onclick:copy}),h('div',{class:'spacer'}),btn('Add agents and assign polling units',{onclick:()=>go('agents')}))}

export function adminLogin(){const s={email:'',pw:'',err:'',loading:false};const root=h('section',{class:'screen'});
  const draw=()=>root.replaceChildren(back('welcome'),h('h1',{},'Party admin log in'),s.err&&banner('error',s.err),
    field({id:'e',label:'Email',type:'email',value:s.email,autocomplete:'email',oninput:x=>s.email=x.target.value}),
    field({id:'p',label:'Password',type:'password',value:s.pw,autocomplete:'current-password',oninput:x=>s.pw=x.target.value}),
    h('div',{class:'spacer'}),btn('Log in',{loading:s.loading,onclick:async()=>{s.loading=true;s.err='';draw();
      try{await signInWithEmailAndPassword(auth,s.email.trim(),s.pw);const r=await auth.currentUser.getIdTokenResult();go(r.claims.role==='coordinator'?'dashboard':'agents')}catch{s.loading=false;s.err='Wrong email or password.';draw()}}}));
  draw();return root}
