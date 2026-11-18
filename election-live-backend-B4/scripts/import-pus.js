// Usage: node scripts/import-pus.js polling_units.csv
// The first row names the columns. Required: code,stateCode,lgaCode,wardCode,name,lat,lng
// Optional: stateName,lgaName (shown on the dashboard filters). No commas inside fields.
// Needs FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 (emulator) or GOOGLE_APPLICATION_CREDENTIALS (live).
const fs=require('fs');const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:process.env.GCLOUD_PROJECT||'demo-allyve'});
const db=admin.firestore();const lines=fs.readFileSync(process.argv[2],'utf8').trim().split(/\r?\n/);const head=lines.shift().split(',').map(s=>s.trim());
for(const h of ['code','stateCode','lgaCode','wardCode','name','lat','lng'])if(!head.includes(h)){console.log('Missing column: '+h);process.exit(1)}
(async()=>{let n=0;for(let i=0;i<lines.length;i+=400){const b=db.batch();for(const r of lines.slice(i,i+400)){const v=r.split(','),o={};head.forEach((h,k)=>o[h]=(v[k]||'').trim());const code=o.code;delete o.code;o.lat=+o.lat;o.lng=+o.lng;b.set(db.doc(`polling_units/${code}`),o);n++}await b.commit();console.log(n,'imported')}})();
