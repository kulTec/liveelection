# Election Live Updates System: backend (Firebase) - Module B0

## Production hosting

The callable API now runs in Vercel under `election-live-web-A8/api`; Firebase Auth, Firestore, and Messaging remain the identity and data services. Configure the environment variables listed in the repository README. Do not deploy the legacy `functions` directory to production. Deploy Firestore rules, indexes, and Storage rules from this folder with `firebase deploy --only firestore,storage`.

## Data model (Firestore)
| Path | Written by | Purpose |
|---|---|---|
| polling_units/{inecCode} | import script | stateCode, lgaCode, wardCode, name, lat, lng |
| parties/{pid} | function | name, prefix (ACC), regNumber, ownerUid |
| parties/{pid}/agents/{id} | function | agentCode, name, email, puCode, status, deviceId |
| parties/{pid}/coordinators/{uid} | function | coordinator profile and state/LGA/ward scope; owners/admins may read |
| parties/{pid}/units/{puCode} | function | LIVE unit status for map/charts: accredited, incidents, resultStatus, votes, lastSeen, lat/lng |
| parties/{pid}/reports/{clientUuid} | agent app (create only) | type accreditation/incident/result, data, lat/lng, clientTime, serverTime, flags |
| parties/{pid}/alerts/{id} | function | flagged items; staff may only acknowledge |
| parties/{pid}/audit/{id} | function | who did what, when |
| otps, counters, users, agent_emails | function only | hashed OTPs, sequences, roles, unique-email lock |

Roles are Firebase Auth custom claims: owner/admin/coordinator (staff), agent (also carries partyId, agentId, puCode).

Production server-side requests and report processing run through the Vercel API in the web project. The Functions implementation below is retained for emulator/reference use; it is not the production API.

## Setup on your PC (do in this order)
1. Install Node.js 20+. Run `npm i -g firebase-tools`, then `firebase login`.
2. console.firebase.google.com > Add project (e.g. allyve-monitor). Enable Email/Password authentication, Firestore, and Storage as needed. Cloud Storage may require a billing-enabled Firebase plan.
3. Build > Authentication > Get started > enable **Email/Password**.
4. Build > Firestore Database > Create (production mode, choose the region nearest Nigeria you are offered).
5. In this folder: `firebase use --add` (pick your project), then `cd functions && npm install && cd ..`.
6. For production API secrets, configure `FIREBASE_SERVICE_ACCOUNT_JSON`, `OTP_SALT`, and either `SMTP_URL` or `RESEND_API_KEY` in Vercel Project Settings. Never commit or paste secret values into source files.
7. For local emulation, create `functions/.secret.local` with `SMTP_URL=emulator-log-only` and `OTP_SALT=local-development-only-change-before-production`. This keeps the Functions Emulator from trying to fetch secrets from Google Secret Manager; OTP emails print in the emulator terminal and are never sent through SMTP. Agent login OTPs are only printed when the submitted ID matches an active agent in the emulator's Firestore data; unknown or inactive IDs still return the same success response, with a diagnostic in the emulator terminal. This local file is ignored by Git. Then test with `firebase emulators:start`. Import sample data with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/import-pus.js sample.csv`.
8. Deploy rules and indexes: `firebase deploy --only firestore,storage`. The old Firebase Functions code remains for emulator/reference use only.
9. Load the real polling unit list: get a CSV in the format above (check the source licence), then run the import script against production with a service-account key.

## Anti-fraud implemented
- OTPs are hashed, expire in 10 minutes, allow 5 tries, 60 s resend wait.
- One device per agent; a login from another phone is blocked and raises an alert (admin resets with resetAgentDevice).
- Every report is checked on the server: GPS more than 300 m from the unit, phone clock ahead, long offline delay, over-voting, missing result sheet photo, duplicate result.
- Reports are create-only and keyed by a client UUID, so offline retries never duplicate and nothing can be edited.
- Every report gets a server timestamp; alerts also send a push to staff (FCM topic party_{pid}_staff).

## Not done yet
Coordinator area scoping (ward/LGA claims), image-hash checks, rate limits (App Check), and automated tests. Not yet run against a live Firebase project.

## Added in A3: result sheet photos (Cloud Storage)
Firebase console > Build > Storage > Get started. Then `firebase deploy --only firestore,functions,storage`. Rules are in storage.rules.

## Coordinator area limits (B2)
Coordinators carry `scopeLevel` (state | lga | ward) and area codes in their login token. Rules only let them read units, agents, reports and alerts inside that area; admins and owners see everything. Create one with the `createCoordinator` function (admin only): it emails them a link to set a password. Queries from a coordinator must filter by their area (the dashboard does this); an unfiltered query is rejected by design.

## Automated tests
1. `npm install` (in this folder)   2. `firebase emulators:exec --only firestore "npm test"`
The 23 tests check: anonymous and cross-party access is denied; ward/LGA/state scope; coordinators cannot write; agents can only create valid reports for their own unit, cannot fake server time, cannot edit reports. Not yet run by me: please run them and send me any failure.
Deploy new indexes with `firebase deploy --only firestore`.
