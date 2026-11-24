# ADR-0001: Firebase Security Hardening & Non-PII Guest Tracking Projection

- **Status:** Accepted
- **Date:** 2026-11-25
- **Related Findings:** `AUD-001`–`AUD-004`, `AUD-006`, `AUD-007`, `AUD-014`, `BUG-001`–`BUG-005`

## Context
During Phase 4 QA and Phase 5 Audit, we identified critical security vulnerabilities in [firestore.rules](../../firestore.rules):
1. `isStaff()` only checked `exists(/users/$(uid))`, while customers could self-write `/users/$(uid)` during checkout (`consumeCouponAndTrackLoyalty()`), granting every customer full POS staff permissions.
2. `/onlineOrders/{orderId}` included `allow read: ... || true` to allow guest order tracking by document ID, which inadvertently allowed unauthenticated `list` queries exposing all customers' PII (`name`, `phone`, `address`).
3. Customers could self-create arbitrary `10%` loyalty coupons and tamper with public promo `active`/`used`/`usedCount` fields.
4. `/banners` rules and `storage.rules` were missing, breaking banner reads in production.

## Decision
1. **Explicit Staff Role Gate on `isStaff()`:** Keep compatibility with the POS `/users/{uid}` employee document layout while requiring `isStaff == true` or `role in ['owner', 'admin', 'manager', 'staff', 'cashier', 'employee']`, and block customers from writing `role`, `isStaff`, or `permissions` on `/users/{uid}`.
2. **Non-PII `/orderTracking/{orderId}` Projection + `allow list: if false`:** Lock `/onlineOrders` reads strictly to `customerUid == request.auth.uid || isStaff()`, and project only non-PII tracking metadata (`orderId`, `status`, `orderType`, `total`, timestamps, `estimatedReadyTime`, `rejectionReason`) into `/orderTracking/{orderId}` with `allow get: if true; allow list: if false;`.
3. **Server-Side Cloud Functions (`functions/index.js`):** Introduce `onOrderCreated`, `onOrderUpdated`, and `createVerifiedOrder` so loyalty coupon issuance uses `crypto.randomBytes`, tracking projections stay synchronized even when POS updates `onlineOrders`, and pricing/coupon integrity can be verified server-side.
4. **Hardened Rules Coverage:** Add explicit `/banners` rules, `storage.rules` (5 MB / image MIME cap), `allow list: if false` on `usernameDirectory`, and one-way coupon redemption rules while disallowing client coupon `create`.

## Consequences
- **Positive:** Closes staff privilege escalation, customer PII collection dumps, username enumeration, and arbitrary coupon minting while staying backward-compatible with static hosting before and after deploying Cloud Functions.
- **Follow-up Required:** Deploy updated `firestore.rules`, `storage.rules`, `firestore.indexes.json`, and `functions/` to Firebase project `hungry-birds-3e16f`, and set `role`/`isStaff` fields (or Auth Custom Claims) on all genuine POS staff accounts.
