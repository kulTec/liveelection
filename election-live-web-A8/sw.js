const V='election-shell-v10';
const SHELL=['./','index.html','css/tokens.css','css/base.css','js/main.js','js/store.js','js/ui.js','js/screens/auth.js','js/screens/agents.js','js/config.js','js/queue.js','js/theme.js','js/states.js','icons/logo-512.png','js/screens/coordinators.js','js/screens/dashboard.js','js/screens/report.js','js/firebase.js','manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('index.html'))))});
