# Election Live

This repository contains the Election Live web client and backend.

## Projects

- `election-live-web-A8/` contains the static client and Vercel API functions. Set this as the Vercel project's root directory.
- `election-live-backend-B4/` contains Firestore and Storage rules, indexes, and the previous Firebase Functions implementation.

The Vercel API functions use Firebase Auth, Firestore, and Messaging through the Firebase Admin SDK. Configure these Vercel Production environment variables before using registration or other server-backed features:

- `FIREBASE_PROJECT_ID`: `accord-party-live-election`
- `FIREBASE_SERVICE_ACCOUNT_JSON`: the Firebase service-account JSON, stored as a secret
- `OTP_SALT`: a random secret of at least 32 characters
- `SMTP_URL` or `RESEND_API_KEY`, plus `MAIL_FROM` set to an address verified with the email provider

Never commit or share service-account keys, email credentials, or OTP secrets. Deploy Firestore and Storage rules from `election-live-backend-B4` with Firebase CLI; do not deploy the old Firebase Functions to production. Push-alerts also require a Web Push VAPID key in `election-live-web-A8/js/config.js`.
