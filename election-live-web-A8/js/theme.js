// Light / dark switch on every page. Saved on this phone; first visit follows the phone's own setting.
import {get,set} from './store.js';
const sys=()=>matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
const cur=()=>get('theme')||sys();
export function initTheme(){const btn=document.createElement('button');btn.className='theme-btn';
  const apply=()=>{const d=cur()==='dark';document.documentElement.dataset.theme=d?'dark':'light';btn.textContent=d?'☀️':'🌙';btn.setAttribute('aria-label',d?'Switch to light mode':'Switch to dark mode');
    const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=d?'#17241B':'#0B6B3A'};
  btn.onclick=()=>{set('theme',cur()==='dark'?'light':'dark');apply()};document.body.append(btn);apply()}
