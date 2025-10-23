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

The app uses the same Firebase project as your mobile app. Connection settings are in `src/firebase.ts`. Keep it in sync with the root `constants/firebase.ts` if those change.

## Security rules (critical)

Ensure Firestore Security Rules only allow admins to modify other users. See the `ADMIN_SETUP.md` in the repo root for an example ruleset.

Tip: Keep the passcode out of source control. Use `.env.local` (ignored by git) locally, and environment variables in Vercel.

## Limitations

- Deleting a profile here only soft-deletes the Firestore document. Deleting the Firebase Auth user requires Admin SDK or a Cloud Function.
