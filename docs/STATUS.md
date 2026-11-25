# Project Status — Hungry Birds Website

- **Current Phase:** Post-Deploy Hardening & Live Connectivity Recovery Complete
- **Last Updated:** 2026-11-25
- **Branch:** `main` (pushed to `origin/main`)
- **Automated Regression (`npm test`):** **PASS (`37/37` tests green)**
- **Dependency Audit (`npm audit`):** **PASS (`0 vulnerabilities`)**
- **CSS Build (`npm run build:css`):** **PASS (`styles.css` `42,059` bytes)**

---

## Done
- **Repo Hygiene & Dependencies (`d3f3c43`):** Added `.gitignore` and `.env.example`, untracked `2,386` committed `node_modules` files, deleted dead `output.css`, cleaned `package.json`, and ran `npm audit fix` (`0 vulnerabilities`).
- **Firebase & POS-Compatible Rules (`01c9b59`, `94c9bf2` — Published Live):** Hardened [firestore.rules](../firestore.rules) while preserving all 16 POS collections and uppercase POS RBAC (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `isStaffActive`, `isManagerOrOwner`, `isCashierOrAbove`, `setting_ownerPinHash`); added [storage.rules](../storage.rules), [firestore.indexes.json](../firestore.indexes.json), [firebase.json](../firebase.json), Cloud Functions in [functions/index.js](../functions/index.js), and [docs/adr/0001-firebase-security-hardening.md](./adr/0001-firebase-security-hardening.md).
- **App Security, Functional & A11y Fixes (`767a7bc`, `241666e`):** Extracted [firebase-config.js](../firebase-config.js), removed Tailwind CDN from `admin.html` & `google-maps-embed.html`, added Font Awesome sha384 SRI, eliminated XSS (`escapeHTML` + `data-*` event delegation), fixed cart badge sync on reload/repeat/order, fixed modal `hidden`/ARIA/`Escape`/`Enter`/backdrop/`z-40` CTA layering, fixed `rounde  d-[1.5rem]`/`backdrop-blur-xs`, added SVG favicon, fixed Takeaway status label & address, fixed loyalty modulo UI & local end-of-day expiry, enforced banner upload bounds & Storage cleanup, wired sign-out teardown, and rebuilt `styles.css`.
- **Live Vercel CSP, Self-Healing Service Worker `v6` & Firestore Transport Resilience (`7044b71`, `b1a4283`, `cf0d51e` + latest fix):**
  - Expanded `connect-src` in [vercel.json](../vercel.json) and added literal `Cache-Control: no-cache` routes for `/`, `/index.html`, `/appwebsite.js`, `/adminwebsite.js`, `/sw.js`, and `/sw-register.js`.
  - Added standalone [sw-register.js](../sw-register.js) before `appwebsite.js` in [index.html](../index.html) to automatically purge pre-`v6` legacy Service Workers (`hungrybirds-cache-v1`..`v5`) and bumped [sw.js](../sw.js) (`hungrybirds-cache-v6`) with `fetch(event.request, { cache: 'no-cache' })` on same-origin assets.
  - Replaced `getFirestore` with `initializeFirestore(..., { experimentalAutoDetectLongPolling: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` in [appwebsite.js](../appwebsite.js) (and `experimentalAutoDetectLongPolling: true` in [adminwebsite.js](../adminwebsite.js)), eliminated composite-index `orderBy`/`where` combinations in `loadBanners()`, `autoTrackActiveOrder()`, `loadPastOrders()`, and `loadMyCoupons()` using synchronous `getOrderTimestampMs()` client-side sorting, fixed `openModal` focus selection and Track Order error UI fallback, and added a direct HTTPS Firestore REST API fallback (`fetchCollectionViaRest`) when WebChannel hits a 10-second `WatchStream` cold-cache timeout.
- **Verification:** `37/37` automated tests passing in [tests/qa.test.mjs](../tests/qa.test.mjs) (`TC-001`–`TC-043`), `0` npm audit vulnerabilities, and live browser verification under full `vercel.json` CSP headers (`26` menu items loaded on initial load and reload, `0` console/CSP/SW errors).

## Next (Optional Operational Follow-Ups)
1. Sync the unified [firestore.rules](../firestore.rules) file into the sibling `hungrybirdspos` repo so both repositories track the identical rules source.
2. Deploy `functions/` (`firebase deploy --only functions`) if server-side loyalty minting and `/orderTracking` projection are desired (requires Firebase Blaze plan), and configure Google Cloud Console HTTP referrer restrictions + Firebase App Check.

## Known Gaps / External Scope
- **Live Authenticated Mutation Flows:** Live order placement, coupon redemption, and Admin writes were verified via unit/rules/contract tests rather than live production writes to avoid polluting `hungry-birds-3e16f`.
- **POS Legacy Menu Images:** Base64 `data:image/jpeg;base64,...` strings inside `/menu` documents originate from the POS app; migrating them to Firebase Storage URLs in the POS will further shrink initial menu payload size.
- **Browser Extension Noise (`share-modal.js`):** Console errors mentioning `share-modal.js:1` originate from a local browser extension in the user's browser, not repository code (verify in an Incognito window).

## How to Run Locally & Run Tests
- **Build CSS:** `npm run build:css`
- **Run Automated QA & Security Suite:** `npm test`
- **Dependency Audit:** `npm audit`

## Changelog
- **2026-11-25 (Timestamp Sort Fix, Track Modal Guard & SW `v6` Forced Cache Refresh):** Fixed accidentally `async` `getOrderTimestampMs()` in `appwebsite.js`, ensured `autoTrackActiveOrder()` error handler shows a non-blank fallback inside `#trackingContent`, prevented `openModal()` from focusing close X buttons by default, bumped `sw.js` & `sw-register.js` to `hungrybirds-cache-v6` with `cache: 'no-cache'` fetches, and replaced regex SW header routing in `vercel.json` with explicit literal `no-cache` routes for HTML/JS/SW files.
- **2026-11-25 (Order Tracking / Past Orders / Coupons Index Fix):** Removed composite-index `orderBy("createdAt", "desc")` + `limit(...)` from `autoTrackActiveOrder()`, `loadPastOrders()`, and `loadMyCoupons()` in `appwebsite.js` (sorting client-side via `getOrderTimestampMs()` instead), restored manual Order ID input visibility when a signed-in user has no active order or falls back on error, added `TC-043`, and verified `37/37` tests passing.
- **2026-11-25 (SW `v5` Self-Healing & Firestore Long-Polling/REST Fallback):** Added `sw-register.js`, updated `sw.js` (`v5`, same-origin only) and `vercel.json` (`no-cache` for SW scripts), enabled Firestore auto-detected long-polling + IndexedDB cache + HTTPS REST fallback in `appwebsite.js`/`adminwebsite.js`, and verified `36/36` tests passing + live browser reload clean.
- **2026-11-25 (POS Rules Merge & Vercel CSP Fix):** Merged all 16 POS collections and uppercase POS roles into `firestore.rules` (`94c9bf2`, published live) and expanded Vercel CSP + client-side banner sort (`7044b71`).
- **2026-11-25 (Remediation & Regression):** Fixed all 22 QA bugs & 22 Audit findings across commits `d3f3c43`–`923cb63`.
