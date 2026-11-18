// Run: npm install   then   firebase emulators:exec --only firestore "npm test"
const {test,before,after,beforeEach}=require('node:test');const assert=require('node:assert');const fs=require('fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,setDoc,updateDoc,collection,query,where,serverTimestamp,Timestamp}=require('firebase/firestore');
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-rules-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8080}})});
after(()=>env.cleanup());
const UNITS={U1:['0112','05','KN'],U2:['0113','05','KN'],U3:['0201','06','KN'],U4:['0301','01','LA']};   // ward, lga, state
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const d=c.firestore();
  for(const [id,[w,l,s]] of Object.entries(UNITS)){const area={stateCode:s,lgaCode:l,wardCode:w};
    await setDoc(doc(d,`parties/p1/units/${id}`),{puCode:id,accredited:10,...area});
    await setDoc(doc(d,`parties/p1/alerts/al_${id}`),{kind:'x',puCode:id,title:'t',body:'b',acknowledgedBy:null,...area});
    await setDoc(doc(d,`parties/p1/agents/ag_${id}`),{agentCode:'C',name:'n',email:'e',puCode:id,...area})}
  await setDoc(doc(d,'parties/p1/agents/a1'),{agentCode:'C1',name:'n',email:'e1',puCode:'U1',status:'active',stateCode:'KN',lgaCode:'05',wardCode:'0112'});
  await setDoc(doc(d,'parties/p1'),{name:'Accord'});await setDoc(doc(d,'parties/p1/audit/x'),{action:'a'});
  await setDoc(doc(d,'parties/p1/coordinators/c1'),{name:'Coordinator',email:'c1@example.com',scopeLevel:'state',stateCode:'KN'});
  await setDoc(doc(d,'parties/p1/reports/rr1'),{type:'incident',puCode:'U2',agentId:'a2',partyId:'p1',data:{},stateCode:'KN',lgaCode:'05',wardCode:'0113',lat:1,lng:1,clientTime:Timestamp.now(),clientUuid:'rr1',serverTime:Timestamp.now()})})});
const as=(uid,claims)=>env.authenticatedContext(uid,claims).firestore();
const owner=()=>as('o',{role:'owner',partyId:'p1'});
const ward=()=>as('cw',{role:'coordinator',partyId:'p1',scopeLevel:'ward',stateCode:'KN',lgaCode:'05',wardCode:'0112'});
const lga=()=>as('cl',{role:'coordinator',partyId:'p1',scopeLevel:'lga',stateCode:'KN',lgaCode:'05'});
const state=()=>as('cs',{role:'coordinator',partyId:'p1',scopeLevel:'state',stateCode:'KN'});
const agent=()=>as('a1',{role:'agent',partyId:'p1',agentId:'a1',puCode:'U1'});
const units=(db,...w)=>getDocs(query(collection(db,'parties/p1/units'),...w));
const eq=(f,v)=>where(f,'==',v);

test('anonymous user cannot read units',()=>assertFails(getDocs(collection(env.unauthenticatedContext().firestore(),'parties/p1/units'))));
test('owner of another party cannot read this party',()=>assertFails(getDocs(collection(as('x',{role:'owner',partyId:'p2'}),'parties/p1/units'))));
test('owner reads every unit',async()=>assert.equal((await assertSucceeds(getDocs(collection(owner(),'parties/p1/units')))).size,4));
test('only party owners and admins can read coordinator accounts',async()=>{
  await assertSucceeds(getDoc(doc(owner(),'parties/p1/coordinators/c1')));
  await assertFails(getDoc(doc(ward(),'parties/p1/coordinators/c1')));
  await assertFails(getDoc(doc(agent(),'parties/p1/coordinators/c1')));
});

test('ward coordinator reads own ward only',async()=>assert.equal((await assertSucceeds(units(ward(),eq('stateCode','KN'),eq('lgaCode','05'),eq('wardCode','0112')))).size,1));
test('ward coordinator cannot read the neighbouring ward',()=>assertFails(units(ward(),eq('stateCode','KN'),eq('lgaCode','05'),eq('wardCode','0113'))));
test('ward coordinator cannot list without a filter',()=>assertFails(getDocs(collection(ward(),'parties/p1/units'))));
test('ward coordinator single-document reads follow scope',async()=>{await assertSucceeds(getDoc(doc(ward(),'parties/p1/units/U1')));await assertFails(getDoc(doc(ward(),'parties/p1/units/U2')))});

test('LGA coordinator sees both wards in the LGA',async()=>assert.equal((await assertSucceeds(units(lga(),eq('stateCode','KN'),eq('lgaCode','05')))).size,2));
test('LGA coordinator cannot read another LGA',()=>assertFails(units(lga(),eq('stateCode','KN'),eq('lgaCode','06'))));
test('state coordinator sees the whole state',async()=>assert.equal((await assertSucceeds(units(state(),eq('stateCode','KN')))).size,3));
test('state coordinator cannot read another state',()=>assertFails(units(state(),eq('stateCode','LA'))));

test('coordinators cannot write units',()=>assertFails(setDoc(doc(ward(),'parties/p1/units/U1'),{x:1})));
test('coordinators cannot read the audit log; owner can',async()=>{await assertFails(getDoc(doc(ward(),'parties/p1/audit/x')));await assertSucceeds(getDoc(doc(owner(),'parties/p1/audit/x')))});
test('coordinator reads agents and reports only inside scope',async()=>{await assertSucceeds(getDoc(doc(ward(),'parties/p1/agents/ag_U1')));await assertFails(getDoc(doc(ward(),'parties/p1/agents/ag_U2')));
  await assertFails(getDoc(doc(ward(),'parties/p1/reports/rr1')));await assertSucceeds(getDoc(doc(lga(),'parties/p1/reports/rr1')))});
test('coordinator can acknowledge an alert in scope, but not edit it',async()=>{
  await assertSucceeds(updateDoc(doc(ward(),'parties/p1/alerts/al_U1'),{acknowledgedBy:'cw',acknowledgedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(ward(),'parties/p1/alerts/al_U1'),{title:'changed'}));
  await assertFails(updateDoc(doc(ward(),'parties/p1/alerts/al_U2'),{acknowledgedBy:'cw',acknowledgedAt:serverTimestamp()}))});

const good=(o={})=>({type:'accreditation',puCode:'U1',agentId:'a1',partyId:'p1',data:{count:5},lat:12,lng:8,clientTime:Timestamp.now(),clientUuid:'r1',serverTime:serverTimestamp(),...o});
const rep=(db,id,d)=>setDoc(doc(db,`parties/p1/reports/${id}`),d);
test('agent can create a valid report for their own unit',()=>assertSucceeds(rep(agent(),'r1',good())));
test('agent cannot report for another unit',()=>assertFails(rep(agent(),'r1',good({puCode:'U2'}))));
test('agent cannot add extra fields',()=>assertFails(rep(agent(),'r1',good({flags:[]}))));
test('agent cannot fake the server time',()=>assertFails(rep(agent(),'r1',good({serverTime:Timestamp.now()}))));
test('document id must equal clientUuid',()=>assertFails(rep(agent(),'zzz',good())));
test('agent cannot edit a report after sending it',async()=>{await assertSucceeds(rep(agent(),'r1',good()));await assertFails(updateDoc(doc(agent(),'parties/p1/reports/r1'),{lat:1}))});
test('agent cannot read another agent\'s report or another unit',async()=>{await assertFails(getDoc(doc(agent(),'parties/p1/reports/rr1')));await assertFails(getDoc(doc(agent(),'parties/p1/units/U2')));await assertSucceeds(getDoc(doc(agent(),'parties/p1/units/U1')))});
test('a removed (revoked) agent can no longer report',async()=>{await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'parties/p1/agents/a1'),{status:'revoked'}));await assertFails(rep(agent(),'r9',good({clientUuid:'r9'})))});
