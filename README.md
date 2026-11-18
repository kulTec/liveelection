# Election Live

This repository contains the Election Live web client and Firebase backend.

## Projects

- `election-live-web-A8/` is the static web client. Set this as the Vercel project's root directory.
- `election-live-backend-B4/` contains Firebase Functions, Firestore and Storage rules, and indexes. Deploy it separately with Firebase CLI.

The web client uses the Firebase project configured in `election-live-web-A8/js/config.js`. Before relying on a production deployment, verify that the Firebase project is configured and the backend has been deployed. Set the Web Push VAPID key in that file to enable push notifications.
