# Project Status — Hungry Birds Website

- **Current Phase:** Post-Audit Remediation & Regression Verification Complete (Ready for Firebase + Vercel Deployment)
- **Last Updated:** 2026-11-25
- **Branch / Commit:** `main` @ `a8aebf3` *(plus this documentation slice)*
- **Automated Regression (`npm test`):** **PASS (`33/33` tests green)**
- **Dependency Audit (`npm audit`):** **PASS (`0 vulnerabilities`)**
- **CSS Build (`npm run build:css`):** **PASS (`styles.css` `42,059` bytes)**

---

## Done
- **Repo Hygiene & Dependencies (`d3f3c43`):** Added `.gitignore` and `.env.example`, untracked `2,386` committed `node_modules` files, deleted dead `output.css`, cleaned `package.json`, and ran `npm audit fix` (`0 vulnerabilities`).
- **Firebase Hardening (`01c9b59`):** Hardened [firestore.rules](../firestore.rules) (`isStaff()` role verification, `/users` write restrictions, removed `|| true` on `onlineOrders`, added non-PII `/orderTracking`, locked `coupons` creation & redemption, blocked `usernameDirectory` listing, added `/banners` rules, synced `isAdmin()`), added [storage.rules](../storage.rules), [firestore.indexes.json](../firestore.indexes.json), [firebase.json](../firebase.json), Cloud Functions in [functions/index.js](../functions/index.js), and [docs/adr/0001-firebase-security-hardening.md](./adr/0001-firebase-security-hardening.md).
- **App Security, Functional & A11y Fixes (`767a7bc`):** Extracted [firebase-config.js](../firebase-config.js), removed Tailwind CDN from `admin.html` & `google-maps-embed.html`, added Font Awesome sha384 SRI, eliminated XSS (`escapeHTML` + `data-*` event delegation), fixed cart badge sync on reload/repeat/order, fixed modal `hidden`/ARIA/`Escape`/`Enter`/backdrop/`z-40` CTA layering, fixed `rounde  d-[1.5rem]`/`backdrop-blur-xs`, added SVG favicon, fixed Takeaway status label & address, fixed loyalty modulo UI & local end-of-day expiry, enforced banner upload bounds & Storage cleanup, and wired full sign-out teardown.
- **PWA, Styles & Security Headers (`241666e`):** Fixed `sw.js` case-sensitive asset paths (`hungrybirds-cache-v3`), added CSP/HSTS/XFO headers in [vercel.json](../vercel.json), and rebuilt `styles.css`.
- **Verification (`a8aebf3` + Live Browser):** Expanded [tests/qa.test.mjs](../tests/qa.test.mjs) (`33/33` pass) and re-verified desktop (`1280×800`) and mobile (`375×812`) flows on `http://127.0.0.1:4173` (zero `404`s, zero CDN Tailwind requests, cart reload sync, modal keyboard/backdrop, rounded mobile card, unobstructed `Place Order`).
- **Docs Updated:** [docs/qa/BUGS.md](./qa/BUGS.md), [docs/qa/TEST_PLAN.md](./qa/TEST_PLAN.md), [docs/audit/AUDIT_REPORT.md](./audit/AUDIT_REPORT.md), [docs/ops/RUNBOOK.md](./ops/RUNBOOK.md).

## Next (External Deployment Actions Required)
1. Confirm POS staff `/users/{uid}` docs in `hungry-birds-3e16f` have `role` / `isStaff` set (see [docs/ops/RUNBOOK.md](./ops/RUNBOOK.md)).
2. Deploy `firestore.rules`, `firestore.indexes.json`, `storage.rules`, and `functions/` to Firebase project `hungry-birds-3e16f`.
3. Deploy static site to Vercel and complete Google Cloud Console hardening (API key HTTP referrers, Firebase App Check).
4. Smoke-test live authenticated checkout, banner carousel, and guest order tracking against deployed Firebase rules.

## Known Gaps / External Scope
- **Cloud Deployment Pending:** Updated `firestore.rules`, `storage.rules`, `firestore.indexes.json`, and `functions/` are committed locally but **not yet deployed** to live Firebase project `hungry-birds-3e16f` (until deployed, live `banners` and guest order tracking queries on `hungry-birds-3e16f` still return `permission-denied`).
- **Live Authenticated Flows:** Live order submission, coupon redemption, Past Orders / My Coupons, and Admin CRUD were verified via static contracts/unit tests rather than live writes to avoid mutating production Firebase data.
- **POS Legacy Menu Images:** Base64 `data:image/...` strings inside `/menu` documents originate from the separate POS app and remain an operational migration item.
- **Footer Email Confirmation:** `contact@hungerbirds.rest` in [index.html](../index.html) was kept per commit `80d62d6` — confirm whether it should stay or change to `hungrybirds`.

## How to Run Locally & Run Tests
- **Build CSS:** `npm run build:css`
- **Run Automated QA & Security Suite:** `npm test`
- **Dependency Audit:** `npm audit`

## Changelog
- **2026-11-25 (Remediation & Regression):** Fixed all 22 QA bugs & 22 Audit findings across commits `d3f3c43`–`a8aebf3`; verified `33/33` tests passing, `0` npm audit vulnerabilities, and live desktop/mobile browser regression clean; added [docs/ops/RUNBOOK.md](./ops/RUNBOOK.md) and [docs/adr/0001-firebase-security-hardening.md](./adr/0001-firebase-security-hardening.md).
- **2026-11-25 (Phase 5 Audit):** Independent security and quality audit completed against `4fbff72`; added [docs/audit/AUDIT_REPORT.md](./audit/AUDIT_REPORT.md) (`6 Critical`, `7 High`, `6 Medium`, `3 Low` — Gate **FAIL**).
- **2026-11-25 (Phase 4 QA):** Live desktop/mobile browser QA and automated suite [tests/qa.test.mjs](../tests/qa.test.mjs) completed against `4fbff72` (`7/26` passed; `22` open bugs in [docs/qa/BUGS.md](./qa/BUGS.md) — Gate **FAIL**).
