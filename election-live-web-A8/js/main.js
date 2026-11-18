import * as auth from './screens/auth.js';
import * as ag from './screens/agents.js';
import * as rp from './screens/report.js';
import * as dash from './screens/dashboard.js';
import * as co from './screens/coordinators.js';
import {initTheme} from './theme.js';
import {start} from './queue.js';
const routes={welcome:auth.welcome,signup:auth.signup,otp:auth.otp,registered:auth.registered,'admin-login':auth.adminLogin,
  'agent-login':ag.agentLogin,'agent-home':rp.agentHome,'agent-accr':rp.accreditation,'agent-incident':rp.incident,'agent-result':rp.resultVotes,'agent-sheet':rp.resultSheet,'agent-review':rp.resultReview,'agent-done':rp.resultDone,agents:ag.agents,dashboard:dash.dashboard,coordinators:co.coordinators};
const app=document.getElementById('app');let cleanup;
function render(){if(cleanup){cleanup();cleanup=null}const name=location.hash.replace('#/','')||'welcome';const view=(routes[name]||routes.welcome)();
  cleanup=view._cleanup;document.body.classList.toggle('wide',name==='dashboard');app.replaceChildren(view)}
addEventListener('hashchange',render);render();initTheme();start();
if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('sw.js').catch(()=>{});
