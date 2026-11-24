# QA Test Plan — Hungry Birds Website

- **Date:** 2026-11-25
- **Baseline Tested:** `4fbff72` (`main`)
- **Verified Post-Fix Commit:** `a8aebf3` (`main` — includes `d3f3c43`, `01c9b59`, `767a7bc`, `241666e`, `a8aebf3`)
- **Mode:** Full lifecycle (M) — Phase 4 QA Gate + Post-Fix Regression (`qa-testing` skill)
- **Automated Test Suite:** [tests/qa.test.mjs](../../tests/qa.test.mjs)
- **Bug Tracker:** [docs/qa/BUGS.md](./BUGS.md)

> **PRD Derivation Note:** No `docs/PRD.md` existed in the repository. User stories (`US-1` through `US-9`) were derived directly from the implemented customer website (`index.html`, `appwebsite.js`, `sw.js`), admin panel (`admin.html`, `adminwebsite.js`), and Firestore rules (`firestore.rules`).

---

## Derived User Stories

| Story | Capability |
|---|---|
| **US-1** | Customer browses promotional banners, menu categories, and menu items |
| **US-2** | Customer manages cart items (add, increment, decrement, remove, persist in `localStorage`) |
| **US-3** | Customer signs in/registers and submits a Delivery or Takeaway order |
| **US-4** | Customer applies promo/loyalty coupons and views loyalty progress in **My Coupons** |
| **US-5** | Guest or signed-in customer tracks order status in real time and views/repeats **Past Orders** |
| **US-6** | Responsive mobile (`375×812`) & desktop (`1280×800`) layout, modals, accessibility, and navigation |
| **US-7** | Security & access control (Firestore/Storage rules isolation, XSS prevention, admin gating) |
| **US-8** | Build integrity, offline Service Worker caching, HTTP security headers, and static asset consistency |
| **US-9** | Admin dashboard (`admin.html`): login gating, customer/order listing, coupon & banner management |

---

## Agreed Exit Criteria

1. **All Must-story (`US-1`..`US-9`) test cases pass** (`PASS` or explicitly noted if blocked on cloud deployment/auth credentials).
2. **Zero open `S1` (critical) or `S2` (high) bugs** in `docs/qa/BUGS.md`.
3. **All `S3` (medium) and `S4` (low) bugs triaged** with owner's agreement.
4. **Automated regression suite (`npm test`) green** on the release commit.
5. **Critical journeys verified in a production-like environment** (case-sensitive static server + desktop & mobile browser widths).
6. **Test results recorded** with date and commit hash.

---

## Automated & Live Regression Results (`TC-001` – `TC-039`)

- `TC-001` | US-1 | `index.html` local `styles.css` & `appwebsite.js` load | **PASS** (`tests/qa.test.mjs` + live `200 OK`, `26` menu items)
- `TC-002` | US-1 | Category filter (`Cold Drinks` → `3`, `All` → `26`) | **PASS** (live desktop browser)
- `TC-003` | US-1 | Live promotional banner read (`banners` rule) | **FIXED IN CODE / PENDING CLOUD DEPLOY** (`firestore.rules` updated in `01c9b59`; live `hungry-birds-3e16f` still returns `permission-denied` until deployed)
- `TC-004` | US-1 | Banner safe clickable links & non-defunct image fallback | **PASS** (`tests/qa.test.mjs` `US-1 \| TC-004`)
- `TC-005` | US-2 | Add item & increment qty in cart | **PASS** (live desktop browser)
- `TC-006` | US-2 | Subtotal, percentage discount rounding, and total math | **PASS** (`tests/qa.test.mjs` `US-2 \| TC-006`)
- `TC-007` | US-2 | Empty cart and `100%` discount edge cases | **PASS** (`tests/qa.test.mjs` `US-2 \| TC-007`)
- `TC-008` | US-2 | Cart badge sync immediately on page reload (desktop & mobile) | **PASS** (live desktop `1280×800` & mobile `375×812` regression: `#cartCount` = `"2"`, `#bottomNavCartCount` = `"2"`)
- `TC-009` | US-2/3 | `initMenu`, `repeatOrder`, `placeOrder` cart/UI/storage sync | **PASS** (`tests/qa.test.mjs` `US-2 / US-3 \| TC-009`)
- `TC-010` | US-3 | Delivery / Takeaway form field toggle | **PASS** (live desktop browser)
- `TC-011` | US-3 | Logged-out checkout redirect to `#authModal` | **PASS** (live desktop browser)
- `TC-012` | US-3 | `#authModal` login/register toggle & `Escape` dismissal | **PASS** (live desktop browser)
- `TC-013` | US-3 | Live authenticated order submission & loyalty increment | **NOT TESTED LIVE** (skipped to avoid mutating production Firebase `hungry-birds-3e16f`; Cloud Functions `createVerifiedOrder`/`onOrderCreated` & rules verified statically in `TC-034`/`TC-039`)
- `TC-014` | US-4 | `isCouponExpired` timestamp boundary helper | **PASS** (`tests/qa.test.mjs` `US-4 \| TC-014`)
- `TC-015` | US-4 | Logged-out coupon prompt & delegated copy / `window.showToast` | **PASS** (`tests/qa.test.mjs` `US-4 \| TC-015` + live browser)
- `TC-016` | US-4 | Single click binding on `#myCouponsBtn` | **PASS** (`tests/qa.test.mjs` `US-4 \| TC-016`)
- `TC-017` | US-4 | Loyalty progress UI at `orderCount = 10` (`10 / 10`, `"Coupon earned!"`) | **PASS** (`tests/qa.test.mjs` `US-4 \| TC-017`)
- `TC-018` | US-5 | `#trackOrderModal` `Enter`/`Escape`/backdrop & `#pastOrdersModal` listener cleanup | **PASS** (`tests/qa.test.mjs` `US-5 \| TC-018` + live browser `Enter`, `Escape`, backdrop `(10,10)`; note guest Firebase query still needs `firebase deploy`)
- `TC-019` | US-5 | `getProgressPercentage` & `getStatusLabel('COMPLETED', 'TAKEAWAY')` | **PASS** (`tests/qa.test.mjs` `TC-019` & `TC-019b`)
- `TC-020` | US-6 | Initial `hidden` + `role="dialog"` on modals, zero overflow, `z-40` CTA behind `#cartModal` (`z-[60]`) | **PASS** (`tests/qa.test.mjs` `US-6 \| TC-020` + live `1280×800` & `375×812` regression)
- `TC-021` | US-7 | `escapeHTML` encoding & `data-*` event delegation replacing inline `onclick` | **PASS** (`tests/qa.test.mjs` `TC-021` & `TC-021b`)
- `TC-022` | US-7 | Hardened `isStaff()` & `/users/{userId}` self-escalation lock | **PASS** (`tests/qa.test.mjs` `US-7 \| TC-022`)
- `TC-023` | US-7 | `onlineOrders` PII read lock (no `|| true`) | **PASS** (`tests/qa.test.mjs` `US-7 \| TC-023`)
- `TC-024` | US-7 | `coupons` rules lock self-minting & enforce one-way redemption | **PASS** (`tests/qa.test.mjs` `US-7 \| TC-024`)
- `TC-025` | US-7 | `banners` rules present & `ADMIN_EMAILS` synced | **PASS** (`tests/qa.test.mjs` `US-7 \| TC-025`)
- `TC-026` | US-9 | Admin `formatDate` helper | **PASS** (`tests/qa.test.mjs` `US-9 \| TC-026`)
- `TC-027` | US-8 | Committed `styles.css` (`42,059` B) matches fresh Tailwind build | **PASS** (`tests/qa.test.mjs` `US-8 \| TC-027`)
- `TC-028` | US-8 | Clean Tailwind classes (`rounded-[1.5rem]`, `backdrop-blur-sm`) | **PASS** (`tests/qa.test.mjs` `US-8 \| TC-028` + live `375×812` rounded corners)
- `TC-029` | US-8 | `admin.html` & `google-maps-embed.html` use local `styles.css` (zero Tailwind CDN) | **PASS** (`tests/qa.test.mjs` `US-8 \| TC-029` + live `admin.html` network log)
- `TC-030` | US-8 | Case-sensitive `sw.js` assets & zero `/Index.html`/`/Appwebsite.js`/`/favicon.ico` 404s | **PASS** (`tests/qa.test.mjs` `US-8 \| TC-030` + live server log `task-254.log`)
- `TC-031` | US-9 | `admin.html` login gate + escaped Firestore strings in `adminwebsite.js` | **PASS** (`tests/qa.test.mjs` `US-9 \| TC-031` + live `admin.html` desktop & mobile screenshot)
- `TC-032` | US-9 | Admin coupon expiry local end-of-day (`23:59:59.999`) | **PASS** (`tests/qa.test.mjs` `US-9 \| TC-032`)
- `TC-033`–`TC-039` | US-3/7/8/9 | `usernameDirectory` list lock, `onlineOrders`/`orderTracking` validation, `storage.rules`/indexes/git hygiene, `vercel.json` CSP/HSTS + Font Awesome SRI, banner upload bounds & Storage delete, sign-out listener/state teardown, ESM parse & Cloud Functions | **PASS** (`tests/qa.test.mjs` `TC-033`–`TC-039`)

---

## Automated & Live Verification Evidence

- **Command:** `npm test` (`node --test tests/qa.test.mjs`)
  - **Result:** Exited with code `0` — `tests 33 | pass 33 | fail 0 | skipped 0 | duration_ms 3141.2747`
- **Command:** `npm audit`
  - **Result:** Exited with code `0` — `found 0 vulnerabilities`
- **Command:** `npm run build:css`
  - **Result:** Exited with code `0` — `Done in 745ms`, `styles.css` = `42,059` bytes
- **Live Browser Host-Verified Origin:** `http://127.0.0.1:4173` (desktop `1280×800` and mobile `375×812` on `index.html` and `admin.html`; zero `404`s in `task-254.log`, zero CDN Tailwind requests on `admin.html`, zero SRI errors)
- **Latest Host-Verified Screenshot:** `C:/Users/Admin/.gemini/antigravity/brain/c10eddfe-6ae4-4c28-a93c-6f0bc75a4b92/browser_evidence/73742824-e17e-431c-adae-89722dc47a0c/final_step_28.png`

---

## Exit Gate Verdict: **CODE VERIFIED GREEN — PENDING FIREBASE DEPLOYMENT & AUTHENTICATED E2E**

- All **33/33** automated QA & security tests pass and all browser-reproducible UI/PWA/layout defects passed regression.
- Full end-to-end production sign-off requires running `firebase deploy --only firestore,storage,functions` against `hungry-birds-3e16f` (per [docs/ops/RUNBOOK.md](../ops/RUNBOOK.md)) and smoke-testing authenticated checkout, banners, and guest order tracking once live rules are published.
