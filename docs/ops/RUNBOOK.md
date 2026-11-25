# Operations & Deployment Runbook — Hungry Birds Website

- **Project:** Hungry Birds Restaurant Website & Admin Panel
- **Firebase Project ID:** `hungry-birds-3e16f`
- **Hosting:** Vercel (`vercel.json` static root `.`)

---

## 1. Local Build & Verification

```powershell
# Install dev dependencies (do not commit node_modules)
npm ci

# Rebuild minified Tailwind CSS (styles.css)
npm run build:css

# Run automated QA & security regression suite (33 tests)
npm test

# Verify zero known dependency vulnerabilities
npm audit
```

---

## 2. Pre-Deployment Checklist (CRITICAL — POS Compatibility Verified)

1. **Unified POS + Website Rules (`firestore.rules`):**
   - [firestore.rules](../../firestore.rules) has been merged directly with `hungrybirdspos` (`C:\Users\Admin\.gemini\antigravity\scratch\hungrybirdspos\firestore.rules`): all **16 POS-only collections** (`suppliers`, `stockIn`, `supplierPayments`, `supplierLedger`, `expenses`, `deliveries`, `staff`, `attendance`, `leaves`, `salaryPayments`, `advancePayments`, `auditLogs`, `heldOrders`, `tableOrders` including `setting_ownerPinHash`, `recipes`, `customers`) and uppercase POS roles (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `isStaffActive`, `isManagerOrOwner`, `isCashierOrAbove`) are preserved.
   - POS login `usernameDirectory/{username}` uses `.doc(username).get()` and REST `GET`, which works with `allow get: if true; allow list: if false;`.
   - POS does not upload to Firebase Storage; `storage.rules` covers `/banners/{bannerId}/{fileName}` only.
   - Ensure `"rehan@hungrybirds-pos.local"` (if used in `admin.html`) has an active `/users/{uid}` doc with `role: "OWNER"` (or `"admin"`).

2. **Install Cloud Functions Dependencies:**
   ```powershell
   cd functions
   npm install
   cd ..
   ```

---

## 3. Deploy Firebase Rules, Indexes, Storage Rules & Functions

```powershell
# Authenticate Firebase CLI (one-time)
npx firebase-tools login

# Deploy Firestore rules & composite indexes
npx firebase-tools deploy --only firestore --project hungry-birds-3e16f

# Deploy Firebase Storage rules (5 MB / image MIME enforcement on /banners)
npx firebase-tools deploy --only storage --project hungry-birds-3e16f

# Deploy Cloud Functions (onOrderCreated, onOrderUpdated, createVerifiedOrder)
npx firebase-tools deploy --only functions --project hungry-birds-3e16f
```

> **Note:** Cloud Functions v2 requires the Firebase project to be on the Blaze (pay-as-you-go) plan.

---

## 4. Deploy Static Website (Vercel)

1. Verify `styles.css` is up to date (`npm run build:css`) and `npm test` passes (`33/33`).
2. Deploy via Vercel CLI or connected GitHub branch (`outputDirectory: "."`, security headers in `vercel.json`).
3. Verify HTTP response headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) on `/` and `/admin.html`.

---

## 5. Cloud Console Hardening (Manual Console Steps)

1. **Restrict Browser API Key (`firebase-config.js`):**
   - In Google Cloud Console → *APIs & Services → Credentials*, add HTTP referrer restrictions (your production domain + Vercel preview URLs + `http://localhost:*` if testing locally) and restrict to Firebase Auth, Firestore, Storage, and Installations APIs.
2. **Enable Firebase App Check:**
   - Register a reCAPTCHA Enterprise / v3 site key in Firebase Console → *App Check*, store the public site key in `.env` (reference `.env.example`), initialize App Check in `appwebsite.js` / `adminwebsite.js`, and set `enforceAppCheck: true` on `createVerifiedOrder` in `functions/index.js`.
3. **Migrate Legacy Menu Images:**
   - Replace inline `data:image/...;base64,...` menu images in Firestore `/menu` documents with Firebase Storage URLs so Service Worker caching (`sw.js`) and lazy-loading perform optimally.
4. **Monitoring & PII Retention:**
   - Configure Firebase Console budget alerts and Vercel/browser error monitoring; define retention/anonymization rules for `onlineOrders` customer phone/address data.

---

## 6. Rollback Procedure

- **Static Website (Vercel):** Promote the previous production deployment in Vercel Dashboard (`Deployments → Promote to Production`).
- **Firestore / Storage Rules:** In Firebase Console → *Firestore Database / Storage → Rules → Version History*, restore the prior published ruleset or run `git checkout <prior-commit> -- firestore.rules storage.rules` and re-deploy.
- **Service Worker (`sw.js`):** Bump `CACHE_NAME` (e.g., `hungrybirds-cache-v4`) and redeploy so browsers purge stale assets immediately via `activate`.
