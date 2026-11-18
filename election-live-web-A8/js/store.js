// Persistent state (localStorage, always guarded: storage can be empty or blocked)
const K='allyve:v1';
const read=()=>{try{return JSON.parse(localStorage.getItem(K))||{}}catch{return{}}};
const write=o=>{try{localStorage.setItem(K,JSON.stringify(o))}catch{}};
export const get=k=>read()[k];
export const set=(k,v)=>{const o=read();o[k]=v;write(o)};
export const clear=()=>{try{localStorage.removeItem(K)}catch{}};
// DEMO ONLY: the real server generates this number. Format: ACC-{year}-{6 digits}
export const nextRegNumber=()=>{const n=(get('regSeq')||0)+1;set('regSeq',n);return `ACC-${new Date().getFullYear()}-${String(n).padStart(6,'0')}`};

// crypto.randomUUID() only exists on HTTPS or localhost; this works on plain http (e.g. http://192.168.x.x) too.
export const uuid=()=>{const c=globalThis.crypto;if(c&&c.randomUUID)return c.randomUUID();const b=new Uint8Array(16);c.getRandomValues(b);b[6]=b[6]&0x0f|0x40;b[8]=b[8]&0x3f|0x80;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`};
