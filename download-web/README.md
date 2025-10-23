# SLSUTrack Download Site

A minimal, modern landing page to distribute the SLSUTrack Android APKs (Driver and Student).

## Features
- Single page with quick toggle between Driver and Student
- Primary button for APK download and a Copy Link action
- Simple install steps
- Support contact link

## Quick start

```powershell
cd download-web
npm install
npm run dev
```

Then open the printed localhost URL.

## Configure links

Use environment variables (set in `.env.local` for dev, and in your host for production):

```
# Preferred: separate links
VITE_DRIVER_APK_URL=https://example.com/driver.apk
VITE_STUDENT_APK_URL=https://example.com/student.apk

# Optional: require a passcode to download the Driver APK
# Note: This is a light gate and not a security boundary.
VITE_DRIVER_PASSCODE=your-secret-code

# Optional fallback (if you only ship one file):
# VITE_ANDROID_APK_URL=https://example.com/app.apk

VITE_SUPPORT_EMAIL=help@yourdomain.com
```

## Build & deploy

```powershell
npm run build
npm run preview
```

For Vercel: import the project and add the `VITE_*` env vars above in Project → Settings → Environment Variables, then deploy.
