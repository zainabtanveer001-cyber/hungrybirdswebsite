# Security & Quality Audit Report — Hungry Birds Website

- **Audit Date:** 2026-11-25
- **Initial Audited Commit:** `4fbff72` (`main`)
- **Remediation Commits:** `d3f3c43`, `01c9b59`, `767a7bc`, `241666e`, `a8aebf3`
- **Mode:** Full lifecycle (M) — Phase 5 Independent Security & Quality Audit (`security-and-quality-audit` skill)

---

## 1. Release Gate Verdict: **CODE HARDENED & VERIFIED — PENDING CLOUD DEPLOYMENT & CONSOLE ACTIONS**

All code, rules, build, dependency, and configuration findings in the repository have been fixed and verified locally (`33/33` automated tests passing, `0` `npm audit` vulnerabilities, live desktop/mobile browser regression clean). Remaining deployment & cloud-console steps are listed explicitly in Section 5 and [docs/ops/RUNBOOK.md](../ops/RUNBOOK.md).

### Severity Summary

| Severity | Open (Console/External) | Fixed (Awaiting Firebase Deploy) | Verified in Repo/Live | Total |
|---|---:|---:|---:|---:|
| **Critical** | 0 | 4 *(rules/functions committed, need `firebase deploy`)* | 2 | 6 |
| **High** | 0 | 2 | 5 | 7 |
| **Medium** | 1 *(legacy base64 menu images in POS Firestore)* | 0 | 5 | 6 |
| **Low** | 2 *(Cloud Console API key restrictions, monitoring/email check)* | 1 | 0 | 3 |
| **Total** | **3** | **7** | **12** | **22** |

---

## 2. Detailed Findings & Remediation Status

### Critical Findings

| ID | Category | Location | Status & Verification Evidence |
|---|---|---|---|
| **AUD-001** | OWASP A01 — Privilege Escalation (`BUG-001`) | [firestore.rules](../../firestore.rules#L27-L38), [L114-L137](../../firestore.rules#L114-L137) | **Fixed & unit-verified (`01c9b59`)** — `isStaff()` requires explicit `isStaff == true` or `role`; `/users/{uid}` blocks writing `role`/`isStaff`/`permissions` (`TC-022`). *Deploy `firestore.rules` to activate.* |
| **AUD-002** | OWASP A01 — `onlineOrders` PII Leak (`BUG-002`) | [firestore.rules](../../firestore.rules#L62-L99), [functions/index.js](../../functions/index.js), [appwebsite.js](../../appwebsite.js) | **Fixed & unit-verified (`01c9b59`, `767a7bc`)** — Removed `|| true`; locked `onlineOrders` to owner/staff; added non-PII `/orderTracking/{orderId}` (`allow list: if false`) synced by Cloud Functions (`TC-023`, `TC-034`). *Deploy rules & functions to activate.* |
| **AUD-003** | OWASP A04/A08 — Order Integrity & Coupon Minting (`BUG-003`) | [firestore.rules](../../firestore.rules#L65-L83), [L140-L170](../../firestore.rules#L140-L170), [functions/index.js](../../functions/index.js) | **Fixed & unit-verified (`01c9b59`, `767a7bc`)** — Rules enforce `PENDING`, subtotal `>= 500` for Delivery, `total == subtotal - discountAmount`, block client coupon `create`, restrict `update` to one-way redemption; added `createVerifiedOrder` & `onOrderCreated` (`TC-024`, `TC-034`, `TC-039`). *Deploy rules & functions to activate.* |
| **AUD-004** | OWASP A01 — Staff Username Enumeration | [firestore.rules](../../firestore.rules#L109-L112) | **Verified (`01c9b59`)** — Replaced `allow read: if true` with `allow get: if true; allow list: if false;` (`TC-033`). *Deploy rules to activate.* |
| **AUD-005** | OWASP A03 — Stored XSS (`BUG-006`) | [adminwebsite.js](../../adminwebsite.js), [appwebsite.js](../../appwebsite.js), [index.html](../../index.html) | **Verified (`767a7bc`)** — All Firestore strings escaped with `escapeHTML()` in `adminwebsite.js`; all inline `onclick="..."` handlers removed and replaced with `data-*` delegation in `appwebsite.js` & `index.html` (`TC-015`, `TC-021b`, `TC-031`). |
| **AUD-006** | OWASP A01/A05 — Missing `banners` & `storage.rules` (`BUG-004`) | [firestore.rules](../../firestore.rules#L55-L58), [storage.rules](../../storage.rules) | **Fixed (`01c9b59`)** — Added `match /banners/{bannerId}` and created `storage.rules` (`TC-025`, `TC-035`). *Deploy `firestore.rules` & `storage.rules` to `hungry-birds-3e16f`.* |

### High Findings

| ID | Category | Location | Status & Verification Evidence |
|---|---|---|---|
| **AUD-007** | OWASP A07 — Weak Admin Gate (`BUG-005`) | [firestore.rules](../../firestore.rules#L11-L24), [adminwebsite.js](../../adminwebsite.js#L36-L40) | **Verified (`01c9b59`)** — `isAdmin()` checks custom claim `admin == true` or `email_verified == true` for `owner@hungrybirds.com` or verified staff role doc for `rehan@hungrybirds-pos.local`; allowlists synchronized (`TC-025`). |
| **AUD-008** | OWASP A05 — Missing Security Headers, Tailwind CDN & SRI (`BUG-021`) | [vercel.json](../../vercel.json), [admin.html](../../admin.html), [index.html](../../index.html), [google-maps-embed.html](../../google-maps-embed.html) | **Verified (`767a7bc`, `241666e`)** — Added CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` in `vercel.json`; removed `cdn.tailwindcss.com` from `admin.html` & `google-maps-embed.html`; added sha384 SRI `integrity` on Font Awesome (`TC-029`, `TC-036`, live browser `admin.html` `0` CDN requests). |
| **AUD-009** | OWASP A04/A05 — Unvalidated Banner Uploads & Links (`BUG-009`) | [adminwebsite.js](../../adminwebsite.js), [storage.rules](../../storage.rules), [appwebsite.js](../../appwebsite.js) | **Fixed (`01c9b59`, `767a7bc`)** — Enforced max 5 files / 5 MB / JPEG|PNG|WebP|GIF in JS + `storage.rules`, Storage object cleanup (`deleteObject`) on banner delete, and `https:`/`http:`/`/` link validation (`TC-004`, `TC-037`). |
| **AUD-010** | OWASP A06 — Vulnerable Dependencies | [package.json](../../package.json), [package-lock.json](../../package-lock.json) | **Verified (`d3f3c43`)** — Cleaned `dependencies` and ran `npm audit fix`; `npm audit` confirms **`found 0 vulnerabilities`**. |
| **AUD-011** | OWASP A07 — Auth Hygiene & Sign-Out Teardown (`BUG-014`) | [index.html](../../index.html), [admin.html](../../admin.html), [appwebsite.js](../../appwebsite.js), [adminwebsite.js](../../adminwebsite.js) | **Verified (`767a7bc`)** — Added password reset (`sendPasswordResetEmail`), `minlength="6"` validation, and full sign-out teardown clearing coupons, caches, tables, and live `onSnapshot` listeners (`TC-038`). |
| **AUD-012** | Abuse / Cost Amplification | [appwebsite.js](../../appwebsite.js), [adminwebsite.js](../../adminwebsite.js), [firestore.indexes.json](../../firestore.indexes.json) | **Fixed (`01c9b59`, `767a7bc`)** — Bounded queries with `limit(20)`/`limit(50)`/`limit(100)`/`limit(200)`, eliminated 3× admin `onlineOrders` scan, added composite indexes; App Check enrollment documented in [docs/ops/RUNBOOK.md](../ops/RUNBOOK.md) (external console step). |
| **AUD-013** | Correctness Blockers (`BUG-007`, `008`, `010`, `011`, `013`, `015`) | [styles.css](../../styles.css), [sw.js](../../sw.js), [appwebsite.js](../../appwebsite.js), [index.html](../../index.html) | **Verified (`767a7bc`, `241666e`)** — Rebuilt `styles.css`, fixed `sw.js` casing, exported `window.showToast` + delegated copy, removed duplicate `#myCouponsBtn` binding, fixed cart reload/repeat/post-order sync, lowered mobile CTA bar to `z-40`; verified in `npm test` (`33/33`) and live browser regression. |

### Medium Findings

| ID | Category | Location | Status & Verification Evidence |
|---|---|---|---|
| **AUD-014** | OWASP A02 — Weak PRNG Loyalty Codes | [functions/index.js](../../functions/index.js#L13-L16) | **Verified (`01c9b59`)** — Loyalty codes moved server-side using `crypto.randomBytes(5)` + `create()` (`TC-039`). |
| **AUD-015** | OWASP A09 — Logging, Raw Errors & Silent Catches | [appwebsite.js](../../appwebsite.js), [adminwebsite.js](../../adminwebsite.js) | **Verified (`767a7bc`)** — Removed `customerUid` debug `console.log`, mapped Firebase auth errors to safe messages (`getFriendlyAuthError`), surfaced warning toast on sync failure, added listener error handlers (`TC-039`). |
| **AUD-016** | Performance — Base64 Menu Images & Indexes | [firestore.indexes.json](../../firestore.indexes.json), [docs/ops/RUNBOOK.md](../ops/RUNBOOK.md) | **Partially Fixed (`01c9b59`)** — `firestore.indexes.json` & `firebase.json` committed; migrating existing base64 `/menu` images stored by the separate POS app remains an operational task in `RUNBOOK.md`. |
| **AUD-017** | Accessibility — WCAG 2.1 AA (`BUG-012`, `BUG-016`) | [index.html](../../index.html), [admin.html](../../admin.html), [google-maps-embed.html](../../google-maps-embed.html), [appwebsite.js](../../appwebsite.js) | **Verified (`767a7bc`)** — Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus management, initial `hidden`, `Escape`/`Enter`/backdrop fixes, input `<label>`/`aria-label`, iframe `title`, and darker contrast tokens (`TC-018`, `TC-020`). |
| **AUD-018** | Maintainability — Repo Hygiene | [.gitignore](../../.gitignore), [package.json](../../package.json) | **Verified (`d3f3c43`)** — Added `.gitignore` & `.env.example`, untracked `2,386` `node_modules` files, deleted dead `output.css`, cleaned `package.json` (`TC-035`). |
| **AUD-019** | Code Quality & Logic (`BUG-009`, `017`–`020`) | [firebase-config.js](../../firebase-config.js), [appwebsite.js](../../appwebsite.js), [adminwebsite.js](../../adminwebsite.js), [index.html](../../index.html) | **Verified (`767a7bc`)** — Extracted shared `firebase-config.js`, fixed Takeaway `COMPLETED` label, loyalty `% 10` UI, UTC-midnight expiry, `rounde  d-[1.5rem]`, and `backdrop-blur-xs` (`TC-017`, `TC-019b`, `TC-028`, `TC-032`). |

### Low Findings

| ID | Category | Location | Status & Action |
|---|---|---|---|
| **AUD-020** | Operability — Runbook & Monitoring | [docs/ops/RUNBOOK.md](../ops/RUNBOOK.md) | **Fixed (Docs) / Open (Console)** — Added deployment & rollback runbook; external error monitoring/budget alerts documented in `RUNBOOK.md`. |
| **AUD-021** | Secrets / API Key Governance | [firebase-config.js](../../firebase-config.js) | **Open (Console)** — Secret scan confirmed `0` leaked private keys/secrets; restrict Firebase browser API key HTTP referrers in Google Cloud Console per `RUNBOOK.md`. |
| **AUD-022** | Asset & Takeaway Address Hygiene (`BUG-022`) | [index.html](../../index.html), [admin.html](../../admin.html), [appwebsite.js](../../appwebsite.js) | **Fixed (`767a7bc`)** — Added inline SVG favicon (verified zero `/favicon.ico` 404s) and cleared address for Takeaway orders; `contact@hungerbirds.rest` kept intentionally per `80d62d6` for owner confirmation. |
