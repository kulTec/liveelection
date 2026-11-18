# Flutter Android integration

The Flutter Android client is in the sibling `election-live-flutter-B2\flutter-app` project. It shares Firebase Auth, Firestore, Storage, and callable Functions with this web client; it should not duplicate account creation, authorization, or election-report rules in the Android client.

## Existing client/backend contract

The web client currently calls these Firebase callable Functions:

| Function | Purpose |
| --- | --- |
| `requestSignupOtp`, `verifySignupOtp` | Party administrator registration |
| `requestAgentOtp`, `verifyAgentLogin` | Agent OTP login; login returns a Firebase custom token |
| `createAgents`, `removeAgent`, `resetAgentDevice` | Agent administration |
| `createCoordinator` | Create a coordinator with a state, LGA, or ward scope |
| `subscribeStaffPush` | Register a staff push-notification token |

Firebase Auth custom claims carry roles and party/area scope. Coordinator access is limited by claims and the dashboard's scoped Firestore queries. The app also reads party data from Firestore, including `parties/{partyId}/agents`, `parties/{partyId}/coordinators`, `parties/{partyId}/units`, and `parties/{partyId}/reports`; polling-unit lookup uses the top-level `polling_units` collection.

Keep the Firebase project configuration aligned with `js/config.js`. For local development, use the same Firebase Emulator Suite and provide an Android emulator-compatible host address (Android emulators commonly reach the development machine through `10.0.2.2`, not `localhost`).

## Coordinator list backend requirement

The web screen creates coordinators and listens for account records in `parties/{partyId}/coordinators`. This repository does not include the Functions implementation or Firestore rules, so the backend must be checked to ensure `createCoordinator` writes records there and owners/admins have read access. If the function uses a different collection or doesn't persist account records, align the function/rules with this contract before relying on the list. The screen does not edit, resend setup instructions, or deactivate accounts.

Before adding edit, resend, or deactivation controls to either client, update the shared backend and rules to support those operations. Define and test the record schema, ensure only party owners/admins can manage coordinators in their party, and ensure deactivation invalidates or refreshes the coordinator's access. Then use that same supported backend contract from the web and Flutter clients.

## Android configuration and validation

- Run `flutterfire configure` in the Flutter project and select the same Firebase project; the included options file is only an emulator placeholder.
- Use the Android emulator host `10.0.2.2` for local Firebase emulators. For a phone on Wi-Fi, pass the development PC's IP with `--dart-define=FIREBASE_EMULATOR_HOST=...`.
- Debug builds use emulators by default; release builds use production Firebase unless explicitly overridden.
- The Flutter app includes staff dashboard, scoped unit and alert queries, agent and coordinator administration, the durable report outbox, and Android FCM opt-in.
- Validate the Android client against the Firebase Emulator Suite and production rules before release. Deploy new Firestore indexes and rules with the backend.
