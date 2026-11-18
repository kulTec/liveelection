import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,connectAuthEmulator,signInWithEmailAndPassword,signInWithCustomToken,signOut,onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,connectFirestoreEmulator,collection,onSnapshot,doc,setDoc,serverTimestamp,Timestamp,query,where,getDocs,updateDoc,orderBy,limit} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import {getStorage,connectStorageEmulator,ref,uploadBytes} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import {firebaseConfig,USE_EMULATOR} from './config.js';
export const app=initializeApp(firebaseConfig);
export const auth=getAuth(app);
// persistent cache = Firestore keeps working offline and syncs queued writes later (used by A3)
export const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
const fns=getFunctions(app);export const storage=getStorage(app);
if(USE_EMULATOR){const host=location.hostname;connectAuthEmulator(auth,`http://${host}:9099`,{disableWarnings:true});connectFirestoreEmulator(db,host,8080);connectFunctionsEmulator(fns,host,5001);connectStorageEmulator(storage,host,9199)}
export const call=(name,data={})=>httpsCallable(fns,name)(data).then(r=>r.data);
export const whenUser=()=>new Promise(res=>{const off=onAuthStateChanged(auth,async u=>{off();res(u?{user:u,claims:(await u.getIdTokenResult()).claims}:null)})});
export const errMsg=e=>{
  if(e?.code==='functions/unavailable'||!e?.message)return'Could not reach the server. Check your connection and try again.';
  if(e.code==='functions/internal')return'The server could not complete this request. Please try again later.';
  if(e.code==='functions/not-found')return'This server function is not deployed to the selected Firebase project. Deploy the backend functions and try again.';
  return e.message;
};
export {signInWithEmailAndPassword,signInWithCustomToken,signOut,collection,onSnapshot,doc,setDoc,serverTimestamp,Timestamp,query,where,getDocs,ref,uploadBytes,updateDoc,orderBy,limit};
