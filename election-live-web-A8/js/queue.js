// Offline outbox: every report is saved on the phone FIRST (IndexedDB), then sent when there is network.
import {uuid} from './store.js';
import {db,storage,auth,doc,setDoc,serverTimestamp,Timestamp,collection,query,where,getDocs,ref,uploadBytes} from './firebase.js';
const open=()=>new Promise((res,rej)=>{const r=indexedDB.open('election-live-outbox',1);r.onupgradeneeded=()=>r.result.createObjectStore('q',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
const tx=async(mode,fn)=>{const d=await open();return new Promise((res,rej)=>{const t=d.transaction('q',mode),r=fn(t.objectStore('q'));t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error)})};
export const all=()=>tx('readonly',s=>s.getAll());
const put=i=>tx('readwrite',s=>s.put(i)),del=id=>tx('readwrite',s=>s.delete(id));
const bus=new EventTarget(),emit=()=>bus.dispatchEvent(new Event('change'));
export const onChange=fn=>{bus.addEventListener('change',fn);return()=>bus.removeEventListener('change',fn)};
let busy=false;export const isBusy=()=>busy;
export const stats=async()=>{const a=await all();return{pending:a.filter(i=>i.status!=='failed').length,failed:a.filter(i=>i.status==='failed')}};
export const retryFailed=async()=>{for(const i of await all())if(i.status==='failed'){i.status='pending';i.error='';await put(i)}emit();flush()};

// GPS is required on every report (anti-fraud). Cached position up to 2 minutes old is accepted so it works offline.
const position=()=>new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lng:p.coords.longitude}),()=>rej(new Error('Turn on location to send reports.')),{enableHighAccuracy:true,timeout:10000,maximumAge:120000}):rej(new Error('This phone cannot share its location.')));
export async function compress(file,max=1280){const b=await createImageBitmap(file),k=Math.min(1,max/Math.max(b.width,b.height)),c=document.createElement('canvas');c.width=Math.round(b.width*k);c.height=Math.round(b.height*k);c.getContext('2d').drawImage(b,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,'image/jpeg',.7))}

export async function enqueue(type,data,blob){const pos=await position();const id=uuid();   // id doubles as the Firestore doc id: retries can never duplicate
  await put({id,type,data,blob:blob||null,lat:pos.lat,lng:pos.lng,clientTime:Date.now(),status:'pending',attempts:0,error:''});emit();flush();return id}

async function send(it,c){const d={...it.data};
  if(it.blob){const path=`sheets/${c.partyId}/${c.puCode}/${it.id}.jpg`;
    try{await uploadBytes(ref(storage,path),it.blob,{contentType:'image/jpeg'})}catch(e){if(e.code!=='storage/unauthorized')throw e}   // create-only rule: "unauthorized" on retry means it is already there
    d.sheetPath=path}
  await setDoc(doc(db,`parties/${c.partyId}/reports`,it.id),{type:it.type,puCode:c.puCode,agentId:c.agentId,partyId:c.partyId,data:d,lat:it.lat,lng:it.lng,clientTime:Timestamp.fromMillis(it.clientTime),clientUuid:it.id,serverTime:serverTimestamp()})}
const already=async(it,c)=>!(await getDocs(query(collection(db,`parties/${c.partyId}/reports`),where('agentId','==',c.agentId),where('clientUuid','==',it.id)))).empty;

export async function flush(){if(busy||!navigator.onLine||!auth.currentUser)return;busy=true;emit();
  try{const c=(await auth.currentUser.getIdTokenResult()).claims;
    for(const it of (await all()).filter(i=>i.status!=='failed').sort((a,b)=>a.clientTime-b.clientTime)){
      try{await send(it,c);await del(it.id)}
      catch(e){it.attempts++;
        if(e.code==='permission-denied'||e.code==='invalid-argument'){if(await already(it,c).catch(()=>false)){await del(it.id);continue}it.status='failed';it.error=e.message;await put(it)}
        else{await put(it);break}}}}   // network trouble: stop and retry later, order is kept
  catch{}finally{busy=false;emit()}}
export const start=()=>{addEventListener('online',flush);addEventListener('offline',emit);setInterval(flush,20000);flush()};
