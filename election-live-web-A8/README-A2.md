# Module A2: web app connected to the Firebase backend
1. Backend folder: in firebase.json set each emulator to listen on your network so the phone can reach it:
   "auth":{"port":9099,"host":"0.0.0.0"}, "functions":{"port":5001,"host":"0.0.0.0"}, "firestore":{"port":8080,"host":"0.0.0.0"}
2. Fill js/config.js with your Firebase web app values (Project settings > Your apps > Web).
3. Terminal 1 (backend): firebase emulators:start      Terminal 2 (web): npx serve .
   Localhost and private-network IPs use the emulators automatically. To force emulators use ?emulator=true; use ?emulator=false to force production (the emulator ports must be reachable from the phone).
4. Add one test polling unit in the Emulator UI (localhost:4000 > Firestore) at polling_units/24-05-12-007:
   {stateCode:"KN",lgaCode:"05",wardCode:"0112",name:"Gwale PU 007",lat:12.0,lng:8.5}
5. Test: sign up (code is printed in the functions terminal) > registration number > Agents > upload CSV
   (name,email,puCode) > agent email prints in terminal with the agent ID > log in as agent in another browser profile.
