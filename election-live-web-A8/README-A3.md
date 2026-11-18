# Module A3: reporting + offline queue
Flow: Agent login > Home > Accreditation / Incident / Result. Each report is saved on the phone first (IndexedDB), then sent. The pill shows Synced / Offline N queued / Sending.
Test on your PC (location works on localhost):
1. Backend: `firebase emulators:start`  (Storage emulator now included). Web: `npx serve .` > http://localhost:3000
2. Log in as an agent (see README-A2). Chrome DevTools > More tools > Sensors > set Location to near the polling unit (lat/lng you stored).
3. Network tab > Offline. Save accreditation + an incident: pill says "Offline · 2 queued". Switch back Online: they send, pill says Synced.
4. Result: enter votes, add a photo, submit. Check Emulator UI > Firestore > parties > reports (flags appear) and Storage > sheets.
5. Fraud test: set DevTools location far away (e.g. another city): the report is saved but flagged gps_mismatch, and an alert is created.
Phone testing needs HTTPS (GPS is blocked on plain http): deploy functions + host the web folder (Netlify drop). Public hosts use production Firebase by default; private-network IPs use emulators unless you add ?emulator=false.

# Module A4: live dashboard (map, charts, filters)
Open on a laptop: log in as party admin > Agents > "Open live dashboard".
1. Demo data: find your party id in Emulator UI (localhost:4000 > Firestore > parties), then in the backend folder:
   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/seed-demo.js PARTY_ID
2. You should see 45 units on the map (green = result in, red = flagged, blue = reporting, amber = silent 40+ min), KPI cards, two charts, alerts you can acknowledge, filters, and CSV export.
3. Push alerts: Firebase console > Project settings > Cloud Messaging > Web Push certificates > Generate key pair. Put it in js/config.js (VAPID_KEY). The service worker uses this project's Firebase web config. Click "Enable alerts" (needs HTTPS or localhost). Serious flags then notify every enabled staff device.
Limits: the map needs internet for tiles. Coordinator dashboard queries are scoped to the state, LGA, or ward in their custom claims.
