const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onDocumentCreated}=require('firebase-functions/v2/firestore');
const {defineSecret}=require('firebase-functions/params');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const admin=require('firebase-admin');const crypto=require('crypto');const nodemailer=require('nodemailer');
admin.initializeApp();
const db=getFirestore(),FV=FieldValue;
const SMTP_URL=defineSecret('SMTP_URL'),OTP_SALT=defineSecret('OTP_SALT');const S={secrets:[SMTP_URL,OTP_SALT]};
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const val=s=>{try{return s.value()}catch{return''}};
const sha=s=>crypto.createHash('sha256').update(s+(val(OTP_SALT)||'dev-salt')).digest('hex');
const norm=e=>String(e||'').trim().toLowerCase();
const need=(auth,roles)=>{const t=auth&&auth.token;if(!t||!roles.includes(t.role))throw new HttpsError('permission-denied','Not allowed.');return t};

// ---------- email + OTP ----------
async function mail(to,subject,text){
  if(process.env.FUNCTIONS_EMULATOR==='true'){console.log('[DEV EMAIL]',to,subject,text);return}   // emulator: never send real email, just print it in the terminal
  const url=val(SMTP_URL);if(!url)throw new HttpsError('internal','Email is not configured.');
  await nodemailer.createTransport(url).sendMail({from:process.env.MAIL_FROM||'Election Live <no-reply@accord.ng>',to,subject,text})}
async function issueOtp(purpose,email,subject){const ref=db.doc(`otps/${purpose}_${sha(email)}`);const s=await ref.get();
  if(s.exists&&Date.now()-s.data().sentAt<60000)throw new HttpsError('resource-exhausted','Wait 60 seconds before asking for a new code.');
  const code=String(crypto.randomInt(100000,1000000));
  await ref.set({hash:sha(code),expires:Date.now()+600000,tries:0,sentAt:Date.now()});   // only a hash is stored
  await mail(email,subject,`Your Election Live code is ${code}. It expires in 10 minutes. If you did not ask for it, ignore this email.`)}
async function checkOtp(purpose,email,code){const ref=db.doc(`otps/${purpose}_${sha(email)}`);const d=(await ref.get()).data();
  if(!d||Date.now()>d.expires)throw new HttpsError('deadline-exceeded','Code expired. Request a new one.');
  if(d.tries>=5)throw new HttpsError('resource-exhausted','Too many wrong codes. Request a new one.');
  if(!crypto.timingSafeEqual(Buffer.from(sha(String(code||''))),Buffer.from(d.hash))){await ref.update({tries:FV.increment(1)});throw new HttpsError('permission-denied','Wrong code.')}
  await ref.delete()}

// ---------- alerts + push ----------
async function raise(pid,a){const pu=a.puCode?(await db.doc(`polling_units/${a.puCode}`).get()).data():null;const area=pu?{stateCode:pu.stateCode,lgaCode:pu.lgaCode,wardCode:pu.wardCode}:{};await db.collection(`parties/${pid}/alerts`).add({...a,...area,createdAt:FV.serverTimestamp(),acknowledgedBy:null});
  try{await admin.messaging().send({topic:`party_${pid}_staff`,notification:{title:a.title,body:a.body},data:{puCode:String(a.puCode||''),kind:String(a.kind||'')}})}catch(e){console.error('push failed',e.message)}}
const audit=(pid,action,meta)=>db.collection(`parties/${pid}/audit`).add({action,...meta,at:FV.serverTimestamp()});

// ---------- 1. party sign-up ----------
exports.requestSignupOtp=onCall(S,async({data})=>{const email=norm(data.email);if(!EMAIL.test(email))throw new HttpsError('invalid-argument','Enter a valid email.');
  try{await admin.auth().getUserByEmail(email);throw new HttpsError('already-exists','This email is already registered.')}
  catch(e){if(e instanceof HttpsError)throw e;if(e.code!=='auth/user-not-found')throw e}
  await issueOtp('signup',email,'Your Election Live sign-up code');return{ok:true}});

exports.verifySignupOtp=onCall(S,async({data})=>{const email=norm(data.email),name=String(data.partyName||'').trim(),pw=String(data.password||'');
  if(!EMAIL.test(email)||name.length<3||pw.length<8)throw new HttpsError('invalid-argument','Check the party name, email and password.');
  await checkOtp('signup',email,data.code);
  const prefix=name.replace(/[^A-Za-z]/g,'').slice(0,3).toUpperCase()||'PTY';
  const user=await admin.auth().createUser({email,password:pw,emailVerified:true,displayName:name});
  const pref=db.collection('parties').doc();
  const reg=await db.runTransaction(async tx=>{const cr=db.doc('counters/party');const n=((await tx.get(cr)).data()||{}).seq+1||1;tx.set(cr,{seq:n});
    const reg=`${prefix}-${new Date().getFullYear()}-${String(n).padStart(6,'0')}`;      // e.g. ACC-2026-000001
    tx.set(pref,{name,prefix,regNumber:reg,ownerUid:user.uid,email,createdAt:FV.serverTimestamp()});
    tx.set(db.doc(`users/${user.uid}`),{role:'owner',partyId:pref.id,email});return reg});
  await admin.auth().setCustomUserClaims(user.uid,{role:'owner',partyId:pref.id});
  await mail(email,'Your party registration number',`${name} is registered. Registration number: ${reg}`);
  return{regNumber:reg,partyId:pref.id}});   // client then signs in with email+password and refreshes its token

// ---------- 2. agents: bulk create + ID generation ----------
exports.createAgents=onCall(S,async({auth,data})=>{const t=need(auth,['owner','admin']),pid=t.partyId;
  const rows=Array.isArray(data.agents)?data.agents.slice(0,200):[];const party=(await db.doc(`parties/${pid}`).get()).data();const out=[];
  for(const [i,r] of rows.entries()){try{
    const email=norm(r.email),name=String(r.name||'').trim(),puCode=String(r.puCode||'').trim();
    if(!EMAIL.test(email)||name.length<2)throw new Error('Invalid name or email');
    const pu=await db.doc(`polling_units/${puCode}`).get();if(!pu.exists)throw new Error('Polling unit code not found');const p=pu.data();
    const aref=db.collection(`parties/${pid}/agents`).doc();
    const code=await db.runTransaction(async tx=>{const em=db.doc(`agent_emails/${sha(email)}`),cr=db.doc(`counters/ward_${p.stateCode}_${p.wardCode}`),uref=db.doc(`parties/${pid}/units/${puCode}`);
      const [e,c,u]=await Promise.all([tx.get(em),tx.get(cr),tx.get(uref)]);
      if(e.exists)throw new Error('Email already used by another agent');if(u.exists&&u.data().agentId)throw new Error('Polling unit already has an agent');
      const n=((c.data()||{}).seq||0)+1;const code=`${party.prefix}-${p.stateCode}-${p.wardCode}-${String(n).padStart(3,'0')}`;   // e.g. ACC-KN-0112-007
      tx.set(cr,{seq:n});tx.set(em,{agentId:aref.id});
      tx.set(aref,{agentCode:code,name,email,puCode,stateCode:p.stateCode,lgaCode:p.lgaCode,wardCode:p.wardCode,status:'active',deviceId:null,createdAt:FV.serverTimestamp()});
      tx.set(uref,{puCode,name:p.name,lat:p.lat,lng:p.lng,stateCode:p.stateCode,stateName:p.stateName||p.stateCode,lgaCode:p.lgaCode,lgaName:p.lgaName||p.lgaCode,wardCode:p.wardCode,agentId:aref.id,agentName:name,accredited:0,incidents:0,resultStatus:'none',lastSeen:null},{merge:true});
      return code});
    await mail(email,'Your Election Live agent ID',`Hello ${name}, your agent ID is ${code}. Open the Election Live app and log in with this ID. We will email you a code each time.`);
    out.push({row:i,ok:true,agentCode:code})}catch(e){out.push({row:i,ok:false,error:e.message})}}
  await audit(pid,'agents_created',{by:auth.uid,count:out.filter(x=>x.ok).length});return{results:out}});

exports.removeAgent=onCall(S,async({auth,data})=>{const t=need(auth,['owner','admin']);const ref=db.doc(`parties/${t.partyId}/agents/${data.agentId}`);const snap=await ref.get();
  if(!snap.exists)throw new HttpsError('not-found','Agent not found.');const a=snap.data();
  await ref.update({status:'revoked',deviceId:null,revokedAt:FV.serverTimestamp()});                       // login and reports stop (see firestore.rules)
  await db.doc(`parties/${t.partyId}/units/${a.puCode}`).set({agentId:FV.delete(),agentName:FV.delete()},{merge:true});   // unit is free again
  await db.doc(`agent_emails/${sha(a.email)}`).delete().catch(()=>{});                                    // email can be used again
  try{await admin.auth().updateUser(`agent_${data.agentId}`,{disabled:true});await admin.auth().revokeRefreshTokens(`agent_${data.agentId}`)}catch(e){}
  await audit(t.partyId,'agent_removed',{by:auth.uid,agentId:data.agentId});return{ok:true}});

exports.resetAgentDevice=onCall(S,async({auth,data})=>{const t=need(auth,['owner','admin']);
  await db.doc(`parties/${t.partyId}/agents/${data.agentId}`).update({deviceId:null});await audit(t.partyId,'device_reset',{by:auth.uid,agentId:data.agentId});return{ok:true}});

// ---------- 3. agent login (ID + email OTP + device binding) ----------
const findAgent=async code=>{const q=await db.collectionGroup('agents').where('agentCode','==',String(code||'').trim().toUpperCase()).limit(1).get();return q.empty?null:q.docs[0]};
exports.requestAgentOtp=onCall(S,async({data})=>{const d=await findAgent(data.agentCode);
  if(d&&d.data().status==='active')await issueOtp('agent',d.data().email,'Your Election Live login code');
  else if(process.env.FUNCTIONS_EMULATOR==='true')console.log('[DEV OTP] No active agent matched this ID; no code was sent.');
  return{ok:true}});   // same answer whether or not the ID exists
exports.verifyAgentLogin=onCall(S,async({data})=>{const d=await findAgent(data.agentCode);const bad=new HttpsError('permission-denied','Wrong agent ID or code.');
  if(!d||d.data().status!=='active')throw bad;const a=d.data(),pid=d.ref.parent.parent.id,dev=String(data.deviceId||'');
  if(dev.length<8)throw new HttpsError('invalid-argument','Device ID missing.');
  await checkOtp('agent',a.email,data.code);
  if(a.deviceId&&a.deviceId!==dev){await raise(pid,{kind:'device_mismatch',puCode:a.puCode,title:'Agent login from a new phone',body:`${a.name} (${a.agentCode}) tried to log in on another device.`});
    throw new HttpsError('failed-precondition','This ID is bound to another phone. Ask your admin to reset it.')}
  if(!a.deviceId)await d.ref.update({deviceId:dev,deviceBoundAt:FV.serverTimestamp()});
  await audit(pid,'agent_login',{agentId:d.id});
  const token=await admin.auth().createCustomToken(`agent_${d.id}`,{role:'agent',partyId:pid,agentId:d.id,puCode:a.puCode});
  return{token,partyId:pid,puCode:a.puCode}});

// ---------- 4. push topics for staff phones/browsers ----------
exports.subscribeStaffPush=onCall(async({auth,data})=>{const t=need(auth,['owner','admin','coordinator']);
  await admin.messaging().subscribeToTopic(String(data.token),`party_${t.partyId}_staff`);return{ok:true}});

// ---------- 5. anti-fraud on every report ----------
const rad=x=>x*Math.PI/180;
const meters=(a,b,c,d)=>{const R=6371000,dl=rad(c-a),dn=rad(d-b),x=Math.sin(dl/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))};
exports.onReport=onDocumentCreated('parties/{pid}/reports/{rid}',async e=>{
  const d=e.data.data(),pid=e.params.pid;const pu=(await db.doc(`polling_units/${d.puCode}`).get()).data();
  const uref=db.doc(`parties/${pid}/units/${d.puCode}`),unit=(await uref.get()).data()||{};const flags=[];
  if(pu&&meters(d.lat,d.lng,pu.lat,pu.lng)>300)flags.push('gps_mismatch');                 // not at the polling unit
  const ct=d.clientTime.toMillis(),st=d.serverTime.toMillis();
  if(ct>st+300000)flags.push('clock_ahead');                                              // phone clock set into the future
  if(st-ct>6*3600000)flags.push('late_sync');                                             // queued offline for a long time
  const up={lastSeen:st};
  if(d.type==='accreditation')up.accredited=Number(d.data.count)||0;
  if(d.type==='incident')up.incidents=FV.increment(1);
  if(d.type==='result'){const votes=d.data.votes||{},sum=Object.values(votes).reduce((s,v)=>s+(Number(v)||0),0);
    if(sum>(unit.accredited||0))flags.push('over_voting');
    if(!d.data.sheetPath)flags.push('no_sheet_photo');
    if(unit.resultStatus&&unit.resultStatus!=='none')flags.push('duplicate_result');
    up.votes=votes;up.totalVotes=sum;up.resultStatus=flags.some(f=>f!=='late_sync')?'flagged':'submitted'}
  await e.data.ref.update({flags,...(pu?{stateCode:pu.stateCode,lgaCode:pu.lgaCode,wardCode:pu.wardCode}:{})});await uref.set(up,{merge:true});
  const severe=flags.some(f=>['gps_mismatch','over_voting','clock_ahead','duplicate_result'].includes(f))||(d.type==='incident'&&d.data.severity==='high');
  if(severe)await raise(pid,{kind:flags[0]||'high_incident',puCode:d.puCode,reportId:e.params.rid,title:d.type==='incident'?'High-severity incident':'Report flagged',body:`PU ${d.puCode}: ${flags.join(', ')||d.data.category||'check now'}`})});

// ---------- 6. coordinators with an area limit (state, LGA or ward) ----------
exports.createCoordinator=onCall(S,async({auth,data})=>{const t=need(auth,['owner','admin']);
  const email=norm(data.email),name=String(data.name||'').trim(),level=data.level;
  if(!EMAIL.test(email)||name.length<2||!['state','lga','ward'].includes(level))throw new HttpsError('invalid-argument','Check name, email and level.');
  const st=String(data.stateCode||'').trim(),lg=String(data.lgaCode||'').trim(),wd=String(data.wardCode||'').trim();
  if(!st||(level!=='state'&&!lg)||(level==='ward'&&!wd))throw new HttpsError('invalid-argument','Area codes are missing for this level.');
  let user;try{user=await admin.auth().createUser({email,displayName:name,emailVerified:true})}
  catch(e){if(e.code==='auth/email-already-exists')throw new HttpsError('already-exists','This email is already in use.');throw e}
  const claims={role:'coordinator',partyId:t.partyId,scopeLevel:level,stateCode:st,...(level!=='state'?{lgaCode:lg}:{}),...(level==='ward'?{wardCode:wd}:{})};
  await admin.auth().setCustomUserClaims(user.uid,claims);await db.doc(`users/${user.uid}`).set({...claims,email,name});
  await db.doc(`parties/${t.partyId}/coordinators/${user.uid}`).set({...claims,email,name,level,createdAt:FV.serverTimestamp()});
  const link=await admin.auth().generatePasswordResetLink(email);
  await mail(email,'Your Election Live coordinator account',`Hello ${name}, set your password here: ${link}`);
  await audit(t.partyId,'coordinator_created',{by:auth.uid,email,level});return{ok:true}});
