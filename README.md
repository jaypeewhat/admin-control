# SLSU Admin Web

A minimal admin web dashboard to manage Driver/Student user profiles in Firestore.

Features:
- Email/password login (must be an admin account)
- List user profiles with filters and search
- Block / Unblock users (app enforces blocks at login)
- Soft-delete profiles (marks `deleted: true`)

## Quick start

1) Install dependencies

```powershell
cd admin-web; npm install
```

2) Run the dev server

```powershell
npm run dev
```

It will open the site (default http://localhost:5173). Log in using an account whose profile has `user_type = admin`.

### Enable admin registration (optional)

To allow creating admins from the site, set a passcode in an env var (never hardcode secrets):

1. Create `admin-web/.env.local` with:

```
VITE_ADMIN_PASSCODE=your-strong-passcode
```

2. Restart the dev server. The Register admin form will require this passcode.

For Vercel: add `VITE_ADMIN_PASSCODE` in Project → Settings → Environment Variables, then redeploy.

## Firebase

The app reads Firebase config from environment variables. Do not hardcode the config in `src/firebase.ts`.

1) Create `admin-web/.env.local` and fill in:

```
VITE_ADMIN_PASSCODE=your-strong-passcode
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
```

2) For hosting (e.g., Vercel), add the same keys in Project → Settings → Environment Variables and redeploy.

Note: Firebase Web API keys are not secrets (they must be bundled to run on the client). Security depends on Firestore Rules and restricting usage to your authorized domains. You can also restrict API key usage in Google Cloud → Credentials to allowed referrers.

## Security rules (critical)

Ensure Firestore Security Rules only allow admins to modify other users. See the `ADMIN_SETUP.md` in the repo root for an example ruleset.

Tip: Keep the passcode out of source control. Use `.env.local` (ignored by git) locally, and environment variables in Vercel.

## Limitations

- Deleting a profile here only soft-deletes the Firestore document. Deleting the Firebase Auth user requires Admin SDK or a Cloud Function.
