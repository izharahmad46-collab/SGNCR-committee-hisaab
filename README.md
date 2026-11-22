# S.G.N Committee — Noori Jama Masjid & Madarsa Anwarool Uloom

Official Financial Management & Transparency Portal for **S.G.N Committee Noori Jama Masjid & Madarsa Anwarool Uloom**, At Ragdih, PO Chalkusha, District Hazaribagh, Jharkhand – 825109, India.

---

## Project Contents

- `src/` — Complete React 19 + TypeScript + Tailwind CSS v4 frontend application (Owner / Super Admin Control Panel, Dashboard, Admin Control Panel, Members, Funds & Ledger, Salaries, Bank & UPI QR, Dual Approvals & Monthly Closing, Committee Office Bearers, Reminders, Reports & Print-to-PDF, Audit Logs & Settings, Multilingual EN/HI/UR support).
- `server.ts`, `server/db.ts`, `server/scheduler.ts`, `server/sourceZip.ts` — Express backend API with Owner/Super Admin protection & locked app branding (`SGN Committee Hisaab`), SQLite double-entry ledger engine (auto-initialized on startup in `data/`), automated reminders, clean ZIP exporter, and backup scheduler.
- `public/assets/` — Committee logo and official UPI QR image assets.
- `firebase-applet-config.json` — Firebase Web SDK configuration (client-side public config).
- `firebase-blueprint.json`, `firestore.rules`, `storage.rules`, `firestore.rules.test.ts`, `security_spec.md` — Firebase Firestore & Storage schema blueprint, hardened security rules, and test specification.
- `.env.example` — Template for environment variables (no private secrets included).

> **Security Note:** No live `.env` secrets, private keys, or live SQLite database files (`data/*.db`) are included in this export archive.

---

## Prerequisites

- **Node.js** v20 or later (`node -v`)
- **npm** v10+ (or **Bun**)
- Optional: **Firebase CLI** (`npm install -g firebase-tools`) for deploying `firestore.rules` and `storage.rules`

---

## 1. Installation & Local Setup

1. Extract this ZIP archive into a local folder and open a terminal inside the project root.
2. Create your local `.env` file from the template:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your values if required:
   ```env
   GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   APP_URL="http://localhost:3000"
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server (runs Express API + Vite frontend on port `3000`):
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000` in your browser. On first run, the SQLite database (`data/sgn_committee.db`) is initialized automatically.

---

## 2. Production Build & Run

```bash
# Type-check TypeScript
npm run lint

# Build the frontend production bundle into dist/
npm run build

# Start production server on PORT (default 3000)
NODE_ENV=production PORT=3000 npx tsx server.ts
```

---

## 3. Firebase Configuration & Rules Deployment

The existing Firebase integration (`src/firebase.ts`, `src/lib/firestoreSync.ts`, `firebase-applet-config.json`) connects to:

- **Firebase Project ID:** `gen-lang-client-0559787771`
- **Firestore Database ID:** `ai-studio-sgncommitteehisa-4450e72e-1580-4194-88a0-bed4a688229b`

To deploy Firestore and Storage security rules from your machine:

```bash
npm install -g firebase-tools
firebase login
firebase use gen-lang-client-0559787771
firebase deploy --only firestore:rules,storage
```

To lint Firestore rules locally:

```bash
npx eslint firestore.rules
```

---

## 4. How to Build an Android APK (Without Changing Existing App Code)

Because this web application includes both a React frontend and a Node.js/Express backend, deploy the live web app first (or use your existing live App URL), then wrap it into an Android APK using either of the two standard approaches below:

### Option A: Trusted Web Activity (TWA) APK via Bubblewrap (Recommended — Keeps Live Backend & Firebase Sync Intact)

1. Install **Java JDK 17+** and **Android Studio** (with Android SDK & Build-Tools).
2. Install Google Bubblewrap CLI:
   ```bash
   npm install -g @bubblewrap/cli
   ```
3. Ensure your hosted app URL is live over HTTPS (for example, your deployed Cloud Run / Shared App URL).
4. Initialize a separate TWA Android wrapper folder outside the app source (so the existing app stays untouched):
   ```bash
   mkdir sgn-committee-android && cd sgn-committee-android
   bubblewrap init --manifest="https://YOUR-DEPLOYED-APP-URL/manifest.webmanifest"
   ```
   *(Or wrap the live URL using Android Studio's WebView / TWA template.)*
5. Build the signed release APK:
   ```bash
   bubblewrap build
   ```
   This generates `app-release-signed.apk` ready to install on Android devices.

### Option B: Capacitor Android Wrapper (Using Separate Wrapper Project Pointing to Deployed Server URL)

1. Install **Node.js 20+**, **Java JDK 17+**, and **Android Studio** (with Android SDK Platform 34+).
2. Create a separate wrapper folder next to the app so your existing source code remains unchanged:
   ```bash
   mkdir sgn-committee-apk && cd sgn-committee-apk
   npm init -y
   npm install @capacitor/core @capacitor/cli @capacitor/android
   npx cap init "SGN Committee" "com.sgncommittee.ragdih" --web-dir=www
   mkdir www && echo "<!doctype html><html><body>Loading...</body></html>" > www/index.html
   ```
3. In `capacitor.config.json`, point `server.url` to your deployed HTTPS app URL:
   ```json
   {
     "appId": "com.sgncommittee.ragdih",
     "appName": "S.G.N Committee",
     "webDir": "www",
     "server": {
       "url": "https://YOUR-DEPLOYED-APP-URL",
       "cleartext": false
     }
   }
   ```
4. Add Android platform and build the APK:
   ```bash
   npx cap add android
   npx cap sync android
   cd android
   ./gradlew assembleDebug
   ```
   - Debug APK output: `android/app/build/outputs/apk/debug/app-debug.apk`
   - For a signed Release APK, open `android/` in **Android Studio** -> **Build** -> **Generate Signed Bundle / APK** -> select **APK** and sign with your keystore.
   - Note for Google Sign-In in APK: Add your app's SHA-1 fingerprint and domain to **Firebase Console → Project Settings → Authorized Domains / Android App** so Firebase Google Authentication works smoothly on Android devices.
