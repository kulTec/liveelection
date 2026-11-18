// Demo data for the dashboard (emulator only). Usage: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-demo.js <partyId>
// partyId = the document id under parties/ (Emulator UI > Firestore) created when you signed up.
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:process.env.GCLOUD_PROJECT||'demo-election-live'});
const db=admin.firestore(),pid=process.argv[2];if(!pid){console.log('Usage: node scripts/seed-demo.js <partyId>');process.exit(1)}
const LG=[['KN','05','Gwale',12.0,8.5],['KN','06','Nassarawa',11.98,8.55],['KN','07','Fagge',12.01,8.52]],P=['Accord','Party B','Party C','Party D'];
(async()=>{const b=db.batch();for(let i=0;i<45;i++){const [st,lga,name,la,ln]=LG[i%3],r=Math.random(),acc=150+Math.floor(Math.random()*200),status=r<.4?'submitted':r<.5?'flagged':'none',votes={};let tot=0;
  if(status!=='none')P.forEach(p=>{votes[p]=Math.floor(Math.random()*acc/4);tot+=votes[p]});
  b.set(db.doc(`parties/${pid}/units/${st}-${lga}-${String(i).padStart(3,'0')}`),{puCode:`${st}-${lga}-${String(i).padStart(3,'0')}`,name:`${name} PU ${i}`,lat:la+(Math.random()-.5)*.08,lng:ln+(Math.random()-.5)*.08,stateCode:st,lgaCode:lga,wardCode:'0112',agentName:'Agent '+i,accredited:acc,incidents:Math.random()<.2?1+Math.floor(Math.random()*3):0,resultStatus:status,votes,totalVotes:tot,lastSeen:r<.85?Date.now()-Math.floor(Math.random()*30)*60000:Date.now()-3*3600000})}
 ['gps_mismatch','over_voting','device_mismatch'].forEach(k=>b.set(db.collection(`parties/${pid}/alerts`).doc(),{kind:k,puCode:'KN-05-000',title:'Report flagged',body:'Demo alert: '+k,createdAt:admin.firestore.FieldValue.serverTimestamp(),acknowledgedBy:null}));
 await b.commit();console.log('seeded 45 units and 3 alerts')})();
