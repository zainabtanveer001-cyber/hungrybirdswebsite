# Bug Reports — Hungry Birds Website

- **Test Date:** 2026-11-25
- **Initial Commit Tested:** `4fbff72` (`main`)
- **Remediation Commits:** `d3f3c43`, `01c9b59`, `767a7bc`, `241666e`, `a8aebf3`
- **Environment:** Case-sensitive Node static server (`http://127.0.0.1:4173`), Chromium webview (`1280×800` desktop & `375×812` mobile), live Firebase project `hungry-birds-3e16f`, Node `v22.14.0`

## Severity Summary

| Severity | Open | Fixed (Code) | Verified | Total |
|---|---:|---:|---:|---:|
| **S1 Critical** | 0 | 2 *(awaiting Firebase deploy)* | 3 | 5 |
| **S2 High** | 0 | 4 | 6 | 10 |
| **S3 Medium** | 0 | 2 | 4 | 6 |
| **S4 Low** | 0 | 1 | 0 | 1 |
| **Total** | **0** | **9** | **13** | **22** |

---

## S1 — Critical

### BUG-001 [S1 critical]
- **Title:** Any signed-in customer can self-grant `isStaff()` privileges in Firestore rules
- **Steps to reproduce:** Register as customer, write `/users/{uid}`, and access `/menu`, `/sales`, `/inventory`, or `/onlineOrders`.
- **Expected vs actual:** Expected: only provisioned staff pass `isStaff()`. Actual (at `4fbff72`): `isStaff()` checked only `exists(/users/$(uid))` while `/users/{uid}` permitted self-writes.
- **Evidence:** Fixed in [firestore.rules](../../firestore.rules#L27-L38) and [L114-L137](../../firestore.rules#L114-L137); verified by `US-7 | TC-022` in [tests/qa.test.mjs](../../tests/qa.test.mjs) (`33/33` pass).
- **Environment:** `main` @ `01c9b59` / `a8aebf3`, Node `v22.14.0`
- **Status:** verified (`01c9b59` — deploy `firestore.rules` to activate on `hungry-birds-3e16f`)

### BUG-002 [S1 critical]
- **Title:** `onlineOrders` rule exposes all customer PII publicly (`|| true`) while live Firebase blocks guest order tracking (`permission-denied`)
- **Steps to reproduce:** Inspect `firestore.rules` `onlineOrders` read rule and query `trackOrderByID("NONEXISTENT_QA_TEST_ID")` logged out.
- **Expected vs actual:** Expected: PII-free guest tracking without listing `onlineOrders`. Actual (at `4fbff72`): repo `firestore.rules` had `|| true`, while deployed `hungry-birds-3e16f` returned `permission-denied`.
- **Evidence:** Removed `|| true`, added non-PII `/orderTracking/{orderId}` projection in [firestore.rules](../../firestore.rules#L62-L99), Cloud Functions sync in [functions/index.js](../../functions/index.js), and guest lookup in [appwebsite.js](../../appwebsite.js); verified by `US-7 | TC-023` & `TC-034` in `tests/qa.test.mjs` (`01c9b59`, `767a7bc`). Live browser still awaits `firebase deploy` onto `hungry-birds-3e16f`.
- **Environment:** `main` @ `01c9b59` / `767a7bc`, live Firebase `hungry-birds-3e16f`
- **Status:** fixed (`01c9b59`, `767a7bc` — pending `firebase deploy` to `hungry-birds-3e16f`)

### BUG-003 [S1 critical]
- **Title:** Firestore `coupons` rules allow any signed-in user to mint unlimited 10% loyalty coupons and tamper with public/single-use coupons
- **Steps to reproduce:** Call client `setDoc` on `/coupons/{code}` or `updateDoc` on public promos with `active: false`.
- **Expected vs actual:** Expected: server-only coupon issuance & one-way redemption. Actual (at `4fbff72`): client could self-create loyalty coupons and toggle `active`/`used`/`usedCount`.
- **Evidence:** Locked `/coupons/{couponId}` `create` to `isAdmin()` and `update` to strictly one-way redemption in [firestore.rules](../../firestore.rules#L140-L170), added server-side `onOrderCreated` & `createVerifiedOrder` in [functions/index.js](../../functions/index.js), and removed client coupon minting in [appwebsite.js](../../appwebsite.js); verified by `TC-024` & `TC-039`.
- **Environment:** `main` @ `01c9b59` / `767a7bc`, Node `v22.14.0`
- **Status:** verified (`01c9b59`, `767a7bc` — deploy `firestore.rules` & `functions` to `hungry-birds-3e16f`)

### BUG-004 [S1 critical]
- **Title:** Missing `banners` collection rule in `firestore.rules` breaks Promotional Banner Carousel live (`permission-denied`)
- **Steps to reproduce:** Load `index.html` and inspect console (`loadBanners()`).
- **Expected vs actual:** Expected: public read on `/banners`, admin-only write. Actual (at `4fbff72`): missing rule triggered `permission-denied`.
- **Evidence:** Added `match /banners/{bannerId} { allow read: if true; allow write: if isAdmin(); }` in [firestore.rules](../../firestore.rules#L55-L58); verified by `TC-025` in `tests/qa.test.mjs`. Live browser still awaits `firebase deploy` to `hungry-birds-3e16f`.
- **Environment:** `main` @ `01c9b59`, live Firebase `hungry-birds-3e16f`
- **Status:** fixed (`01c9b59` — pending `firebase deploy` to `hungry-birds-3e16f`)

### BUG-006 [S1 critical]
- **Title:** Stored XSS & unsafe inline `onclick` attribute interpolation in `adminwebsite.js` and `appwebsite.js`
- **Steps to reproduce:** Render Firestore documents containing HTML/quote payloads in `loadCoupons()`, `loadBanners()`, or inline `onclick="...('${id}')"` attributes.
- **Expected vs actual:** Expected: all dynamic text escaped and event delegation used instead of inline JS attributes. Actual (at `4fbff72`): unescaped `data.code`/`data.type`/`docSnap.id` in `adminwebsite.js` and inline `onclick` interpolation in `appwebsite.js` & `index.html`.
- **Evidence:** Fixed in [adminwebsite.js](../../adminwebsite.js), [appwebsite.js](../../appwebsite.js), and [index.html](../../index.html); verified by `TC-015`, `TC-021b`, and `TC-031` (`33/33` pass).
- **Environment:** `main` @ `767a7bc`, Node `v22.14.0`
- **Status:** verified (`767a7bc`)

---

## S2 — High

### BUG-005 [S2 high]
- **Title:** Admin email allowlist drift between `adminwebsite.js` and `firestore.rules`
- **Steps to reproduce:** Compare `ADMIN_EMAILS` (`adminwebsite.js`) vs `isAdmin()` (`firestore.rules`).
- **Expected vs actual:** Expected: synchronized admin allowlists. Actual (at `4fbff72`): `rehan@hungrybirds-pos.local` was missing from `firestore.rules`.
- **Evidence:** Synchronized `isAdmin()` in [firestore.rules](../../firestore.rules#L11-L24) with `ADMIN_EMAILS` in [adminwebsite.js](../../adminwebsite.js#L36-L40); verified by `TC-025`.
- **Environment:** `main` @ `01c9b59`
- **Status:** verified (`01c9b59`)

### BUG-007 [S2 high]
- **Title:** Committed `styles.css` is stale — Tailwind build not re-run after Banner Carousel and UI additions
- **Steps to reproduce:** Run `npm run build:css` and compare against committed `styles.css`.
- **Expected vs actual:** Expected: `styles.css` matches fresh Tailwind build across all HTML/JS files. Actual (at `4fbff72`): `styles.css` was `38,484` B and missing banner/responsive selectors.
- **Evidence:** Rebuilt `styles.css` (`42,059` B) in `241666e`; verified by `TC-027` (`33/33` pass) and live browser styling on `index.html` & `admin.html`.
- **Environment:** `main` @ `241666e`, Chromium `1280×800` & `375×812`
- **Status:** verified (`241666e`)

### BUG-008 [S2 high]
- **Title:** Service Worker (`sw.js`) references wrong-case filenames (`/Index.html`, `/Appwebsite.js`), breaking offline caching on case-sensitive hosts
- **Steps to reproduce:** Serve via case-sensitive HTTP server (`http://127.0.0.1:4173`) and inspect server logs.
- **Expected vs actual:** Expected: `sw.js` caches exact lowercase `/index.html`, `/styles.css`, `/appwebsite.js`, `/firebase-config.js`. Actual (at `4fbff72`): `/Index.html` returned `404` on every load.
- **Evidence:** Fixed `sw.js` (`hungrybirds-cache-v3`) in `241666e`; verified by `TC-030` (`33/33` pass) and live case-sensitive server log (`task-254.log`: zero `404`s).
- **Environment:** `main` @ `241666e`, case-sensitive static server, Chromium
- **Status:** verified (`241666e`)

### BUG-009 [S2 high]
- **Title:** Promotional banner displays `"Click to Learn More"` with no clickable link/handler and uses defunct `via.placeholder.com` fallback
- **Steps to reproduce:** Inspect `renderBannerCarousel()` in `appwebsite.js`.
- **Expected vs actual:** Expected: safe clickable `<a href>` link when `banner.link` is valid and SVG data URI fallback on error. Actual (at `4fbff72`): dead `"Click to Learn More"` text and `via.placeholder.com`.
- **Evidence:** Fixed `renderBannerCarousel()` & `getSafeUrl()` in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified by `TC-004`.
- **Environment:** `main` @ `767a7bc`
- **Status:** fixed (`767a7bc` — unit-verified; live carousel awaits `firebase deploy` of `banners` rule)

### BUG-010 [S2 high]
- **Title:** `My Coupons` copy button calls undefined `showToast` in global inline `onclick` scope
- **Steps to reproduce:** Click `Copy` in My Coupons.
- **Expected vs actual:** Expected: delegated copy handler triggers `showToast` and `window.showToast` is exported. Actual (at `4fbff72`): inline `onclick` threw `ReferenceError: showToast is not defined`.
- **Evidence:** Replaced inline `onclick` with `[data-action="copy-coupon"]` delegation and exported `window.showToast = showToast` in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified by `TC-015`.
- **Environment:** `main` @ `767a7bc`
- **Status:** fixed (`767a7bc`)

### BUG-011 [S2 high]
- **Title:** Duplicate click listeners on `#myCouponsBtn` execute `loadMyCoupons()` twice per click
- **Steps to reproduce:** Click `#myCouponsBtn` and inspect Firestore calls.
- **Expected vs actual:** Expected: single listener on `#myCouponsBtn`. Actual (at `4fbff72`): both direct and `document` click listeners fired `loadMyCoupons()`.
- **Evidence:** Removed duplicate delegated listener in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified by `TC-016`.
- **Environment:** `main` @ `767a7bc`
- **Status:** fixed (`767a7bc`)

### BUG-012 [S2 high]
- **Title:** `#trackOrderModal` cannot be closed via `Escape`/backdrop or submitted with `Enter`; `#pastOrdersModal` leaks Firestore listener on `Escape`/backdrop close
- **Steps to reproduce:** Open `#trackOrderModal`, press `Enter` inside `#orderIdInput`, press `Escape`, click backdrop `(10, 10)`.
- **Expected vs actual:** Expected: `Enter` submits tracking; `Escape` and backdrop close both modals and unsubscribe listeners. Actual (at `4fbff72`): `Enter`, `Escape`, and backdrop click failed on `#trackOrderModal`, and `#pastOrdersModal` leaked `pastOrdersListener`.
- **Evidence:** Fixed in [appwebsite.js](../../appwebsite.js) and [index.html](../../index.html) (`767a7bc`); verified by `TC-018` (`33/33` pass) and live desktop browser regression (`Enter` triggered lookup, `Escape` closed `#trackOrderModal`, backdrop `(10,10)` closed `#trackOrderModal`).
- **Environment:** `main` @ `767a7bc`, Chromium `1280×800`
- **Status:** verified (`767a7bc`)

### BUG-013 [S2 high]
- **Title:** Cart badge, `localStorage`, and menu card controls desynchronize across page reload, `repeatOrder`, and `placeOrder`
- **Steps to reproduce:** Add qty `2` to cart, reload `index.html` (`1280×800` and `375×812`), check `#cartCount` and `#bottomNavCartCount`.
- **Expected vs actual:** Expected: `#cartCount` and `#bottomNavCartCount` sync immediately (`"2"`); `repeatOrder` calls `saveCart()` & updates controls; `placeOrder` resets card controls. Actual (at `4fbff72`): badges stayed `"0"` on reload.
- **Evidence:** Fixed in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified by `TC-009` (`33/33` pass) and live browser regression (`#cartCount` = `"2"` on desktop `1280×800` and `#bottomNavCartCount` = `"2"` on mobile `375×812` immediately after reload).
- **Environment:** `main` @ `767a7bc`, Chromium `1280×800` & `375×812`
- **Status:** verified (`767a7bc`)

### BUG-014 [S2 high]
- **Title:** Admin `startNewOrderListener` lacks error handling and is never cleaned up on sign-out
- **Steps to reproduce:** Inspect `onAuthStateChanged` and `startNewOrderListener()` in `adminwebsite.js`.
- **Expected vs actual:** Expected: error callback attached and `newOrderListener` unsubscribed on sign-out/denial. Actual (at `4fbff72`): no error handler and listener leaked on sign-out.
- **Evidence:** Fixed via `cleanupNewOrderListener()`, `clearAdminTables()`, and bounded `limit(100)` `onSnapshot` error handler in [adminwebsite.js](../../adminwebsite.js) (`767a7bc`); verified by `TC-038`.
- **Environment:** `main` @ `767a7bc`
- **Status:** fixed (`767a7bc`)

### BUG-015 [S2 high]
- **Title:** Mobile floating `Directions / Call Now` bar (`z-[70]`) overlaps on top of open modals (`z-[60]`) and occludes `Place Order`
- **Steps to reproduce:** Open `#cartModal` via `#bottomNavCart` at `375×812`.
- **Expected vs actual:** Expected: `#cartModal` (`z-[60]`) sits above the mobile floating CTA bar (`z-40`). Actual (at `4fbff72`): CTA bar overlapped `Place Order`.
- **Evidence:** Changed floating bar to `z-40` in [index.html](../../index.html) (`767a7bc`); verified by `TC-020` and live mobile `375×812` browser regression (`Directions` and `Call Now` marked `[occluded]` behind `#cartModal`; `#placeOrderBtn` fully unobstructed).
- **Environment:** `main` @ `767a7bc`, Chromium `375×812`
- **Status:** verified (`767a7bc`)

---

## S3 — Medium

### BUG-016 [S3 medium]
- **Title:** `#authModal` and `#cartModal` omit initial `hidden` class on page load
- **Steps to reproduce:** Inspect initial modal markup in `index.html`.
- **Expected vs actual:** Expected: all 5 modals start with `hidden`. Actual (at `4fbff72`): `#authModal` and `#cartModal` omitted `hidden`.
- **Evidence:** Added initial `hidden`, `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` to all 5 modals in [index.html](../../index.html) (`767a7bc`); verified by `TC-020` and live browser regression (`isVisible: false` initially, `role="dialog"` / `aria-modal="true"` present when open).
- **Environment:** `main` @ `767a7bc`, Chromium
- **Status:** verified (`767a7bc`)

### BUG-017 [S3 medium]
- **Title:** Broken Tailwind class typo `rounde  d-[1.5rem]` renders Owner's Message card with square `0px` corners on mobile
- **Steps to reproduce:** Inspect Owner's Message card at `375×812`.
- **Expected vs actual:** Expected: `rounded-[1.5rem]` applies on mobile. Actual (at `4fbff72`): `rounde  d-[1.5rem]` produced sharp `0px` corners.
- **Evidence:** Fixed typo to `rounded-[1.5rem]` in [index.html](../../index.html) (`767a7bc`); verified by `TC-028` and live mobile `375×812` browser regression (confirmed class + rounded corners).
- **Environment:** `main` @ `767a7bc`, Chromium `375×812`
- **Status:** verified (`767a7bc`)

### BUG-018 [S3 medium]
- **Title:** `getStatusLabel('COMPLETED')` hardcodes `"Delivered"` even for `TAKEAWAY` orders
- **Steps to reproduce:** Call `getStatusLabel('COMPLETED', 'TAKEAWAY')`.
- **Expected vs actual:** Expected: `"Ready for Pickup"` for Takeaway, `"Delivered"` for Delivery. Actual (at `4fbff72`): returned `"Delivered"` for both.
- **Evidence:** Fixed `getStatusLabel(status, orderType = "DELIVERY")` in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified by `TC-019b` (`33/33` pass).
- **Environment:** `main` @ `767a7bc`
- **Status:** verified (`767a7bc`)

### BUG-019 [S3 medium]
- **Title:** Admin coupon expiry date parses `YYYY-MM-DD` at UTC midnight (`00:00Z`), expiring coupons prematurely on the chosen day
- **Steps to reproduce:** Create coupon in `admin.html` with today's date (`YYYY-MM-DD`).
- **Expected vs actual:** Expected: valid through `23:59:59.999` local time on expiry date. Actual (at `4fbff72`): `new Date("YYYY-MM-DD")` parsed as `00:00Z`.
- **Evidence:** Fixed via `parseLocalEndOfDay(expiryRaw)` in [adminwebsite.js](../../adminwebsite.js#L69-L77) (`767a7bc`); verified by `TC-032` (`33/33` pass).
- **Environment:** `main` @ `767a7bc`
- **Status:** fixed (`767a7bc` — unit-verified)

### BUG-020 [S3 medium]
- **Title:** `My Coupons` loyalty progress bar displays `"0 / 10 orders"` and `"10 more to go"` when `orderCount` is a multiple of 10
- **Steps to reproduce:** Call `renderMyCoupons(10, [], [])`.
- **Expected vs actual:** Expected: shows `"10 / 10 orders"` and `"Coupon earned!"`. Actual (at `4fbff72`): showed `"0 / 10 orders"` and `"10 more to go"`.
- **Evidence:** Fixed modulo calculation in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified by `TC-017` (`33/33` pass).
- **Environment:** `main` @ `767a7bc`
- **Status:** verified (`767a7bc`)

### BUG-021 [S3 medium]
- **Title:** `admin.html` & `google-maps-embed.html` load Tailwind Play CDN and `index.html` uses non-existent `backdrop-blur-xs`
- **Steps to reproduce:** Load `admin.html` and inspect CSS imports; inspect `index.html` `#bannerDots`.
- **Expected vs actual:** Expected: local `styles.css` on all pages and valid `backdrop-blur-sm`. Actual (at `4fbff72`): Play CDN loaded on `admin.html` & `google-maps-embed.html` and `backdrop-blur-xs` used in `index.html`.
- **Evidence:** Replaced Tailwind CDN in [admin.html](../../admin.html) & [google-maps-embed.html](../../google-maps-embed.html), changed `backdrop-blur-xs` → `backdrop-blur-sm` in [index.html](../../index.html), and rebuilt `styles.css` (`767a7bc`, `241666e`); verified by `TC-028`, `TC-029` and live `admin.html` regression (`0` CDN requests, [final_step_28.png](../../../../brain/c10eddfe-6ae4-4c28-a93c-6f0bc75a4b92/browser_evidence/73742824-e17e-431c-adae-89722dc47a0c/final_step_28.png)).
- **Environment:** `main` @ `241666e`, Chromium `1280×800` & `375×812`
- **Status:** fixed (`767a7bc`, `241666e` — `admin.html` verified live; `google-maps-embed.html` verified via automated test)

---

## S4 — Low

### BUG-022 [S4 low]
- **Title:** Minor asset/UX polish: missing `/favicon.ico` (`404`), footer email domain (`hungerbirds.rest`), and Takeaway orders retaining typed address
- **Steps to reproduce:** Load `index.html`/`admin.html`, inspect `/favicon.ico` requests, and switch Delivery → Takeaway after typing an address.
- **Expected vs actual:** Expected: SVG favicon prevents `/favicon.ico` `404`s; Takeaway sends `address: ""`; confirm `contact@hungerbirds.rest` with owner. Actual (at `4fbff72`): `/favicon.ico` returned `404` and Takeaway submitted hidden `#checkoutAddress`.
- **Evidence:** Added inline SVG favicon to all 3 HTML files and forced `address = ""` when `currentOrderType !== "DELIVERY"` in [appwebsite.js](../../appwebsite.js) (`767a7bc`); verified zero `/favicon.ico` `404`s in live server log (`task-254.log`) and `TC-039`. `contact@hungerbirds.rest` preserved per commit `80d62d6` pending owner confirmation.
- **Environment:** `main` @ `767a7bc`
- **Status:** fixed (`767a7bc` — favicon & Takeaway address verified; footer email domain flagged for owner)
