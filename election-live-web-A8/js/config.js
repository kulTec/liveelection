export const firebaseConfig={apiKey:'AIzaSyA8Nck4qrrWE11o6Vn1Y0bKsE-3jkcdHzs',authDomain:'accord-party-live-election.firebaseapp.com',projectId:'accord-party-live-election',appId:'1:649778624843:web:8c9426a9a865cee8f790ce',storageBucket:'accord-party-live-election.firebasestorage.app',messagingSenderId:'649778624843'};
const emulatorFlag=new URLSearchParams(location.search).get('emulator');
const localHost=['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname);
const ipv4=location.hostname.split('.').map(Number);
const validIpv4=ipv4.length===4&&ipv4.every(octet=>Number.isInteger(octet)&&octet>=0&&octet<=255);
const privateLanHost=validIpv4&&(ipv4[0]===10||(ipv4[0]===192&&ipv4[1]===168)||(ipv4[0]===172&&ipv4[1]>=16&&ipv4[1]<=31));
export const USE_EMULATOR=emulatorFlag==='true'||(emulatorFlag!=='false'&&(localHost||privateLanHost));
export const PARTIES=['Accord','Party B','Party C','Party D'];   // edit: the parties on the ballot
export const VAPID_KEY='REPLACE_ME';   // Firebase console > Project settings > Cloud Messaging > Web Push certificates > Generate key pair
