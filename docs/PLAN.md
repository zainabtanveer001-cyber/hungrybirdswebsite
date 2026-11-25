# Implementation Plan — Gemini AI Customer Assistant

- **Status:** Proposed (Phase 1 Gate — Awaiting Owner Approval)
- **Date:** 2026-11-25
- **Source Docs:** [docs/PRD.md](./PRD.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md), [docs/adr/0002-gemini-ai-assistant-architecture.md](./adr/0002-gemini-ai-assistant-architecture.md)
- **Delivery Cadence:** 4 small vertical slices (each <= half-day, Conventional Commit per slice, tests shipped with code). Riskiest boundary (Vercel serverless handler + Gemini REST contract) built first.

---

## Milestones & Ordered Tasks

### Milestone 0 — Walking Skeleton & Serverless Proxy (`US-AI-5`, `US-AI-7`)
*Proves the riskiest boundary first: Vercel CommonJS `/api/chat` contract, secret isolation, PII stripping, IP rate limiting, model fallback chain, and Service Worker `/api/` bypass.*

- **Task 0.1 — Server Core (`api/_lib/gemini-assistant.js`) & Handler (`api/chat.js`)**
  - Implement `checkRateLimit`, `isAllowedOrigin`, `validateAndSanitizeInput`, `buildGeminiRequestBody`, `parseAndValidateModelOutput`, `callGeminiWithFallback`, and CommonJS Vercel handler `api/chat.js`.
  - Pass `GEMINI_API_KEY` via `x-goog-api-key` header (never query string), use `responseMimeType: "application/json"`, and validate every returned `recommendedItemId` against request `menu` IDs.
  - **Done when:** `api/chat.js` handles valid requests with mocked Gemini fetch, rejects non-POST (`405`), bad origin (`403`), oversized/invalid payloads (`400`), rate-limit bursts (`429` + `fallback: true`), missing key (`503` + `fallback: true`), and model `404`/`429` failover cleanly.
  - **Tests (`TC-044`, `TC-045`):** Direct Node unit/integration tests calling `api/chat.js` with fake `req`/`res` and mocked `fetch` covering every status code, PII field stripping, hallucinated ID removal, and model fallback chain.

- **Task 0.2 — Environment, Edge Headers & SW `/api/` Bypass**
  - Add `GEMINI_API_KEY=` and `GEMINI_MODEL=` placeholders to `.env.example`.
  - Add `/api/chat` (`Cache-Control: no-store`) and `/ai-assistant.js` (`Cache-Control: no-cache, must-revalidate`) rules in `vercel.json`.
  - Update `sw.js` (`hungrybirds-cache-v7`) to return early on `url.pathname.startsWith('/api/')` and precache `/ai-assistant.js`; bump `sw-register.js` to `v7`.
  - **Done when:** No secrets exist in repo, `vercel.json` stays valid JSON with literal paths, and `sw.js` never intercepts `/api/*`.
  - **Tests (`TC-041` updated):** Verify `v7` cache bump, `/api/` bypass in `sw.js`, `.env.example` placeholders, and `vercel.json` rules.

---

### Milestone 1 — Zero-Quota Local FAQ Router & Smart Menu Fallback (`US-AI-2`, `US-AI-4`, `US-AI-6`, `US-AI-7`)
*Delivers instant `< 100 ms` local responses (English + Roman Urdu) and PII-free payload construction before UI polish.*

- **Task 1.1 — Client Core Logic in `ai-assistant.js`**
  - Implement pure exported helpers:
    - `buildSanitizedAiPayload({ message, history, menuItems, categories, cart, orderType })` (strips `img`/base64 and guarantees zero PII fields).
    - `tryLocalFaqAnswer(message, context)` (deterministic zero-quota answers for delivery minimum Rs. 500, phone/WhatsApp/location, 10-order loyalty coupon, Track Order shortcut, View Cart shortcut).
    - `buildLocalMenuFallback(message, menuItems, categories, cart, orderType)` (parses English & Roman Urdu budget numbers, meal/category keywords, delivery minimum gap, and returns real `recommendedItemIds` + `WHATSAPP` escalation for unknown policies like hours/allergens/delivery fees).
  - **Done when:** All deterministic FAQs answer locally with `0` network calls, fallback matches real menu items by budget/category, and sanitized payload has zero PII or base64 data.
  - **Tests (`TC-046`, `TC-047`):** Unit tests in `tests/qa.test.mjs` covering English + Roman Urdu prompts, budget extraction (`"under 1000"`, `"1500 mein"`), Rs. 500 delivery minimum reminders, unknown-policy WhatsApp escalation, and strict PII absence (`email`, `phone`, `address`, `uid`, `orderId`, `data:image`).

---

### Milestone 2 — Design Spec, Accessible Chat UI & One-Click Actions (`US-AI-1`, `US-AI-3`)
*Delivers the complete customer-facing chat experience following Phase 2 `docs/DESIGN.md`.*

- **Task 2.1 — Phase 2 Design Spec (`docs/DESIGN.md`)**
  - Define user flows, visual tokens (reusing existing Hungry Birds orange/slate palette), mobile/desktop placement coordinates (zero collision with `#floatingCart`, `#bottomNav`, and mobile `Directions / Call Now`), drawer states (initial, loading, reply with item cards, fallback notice, cooldown/error), and ARIA rules.
  - **Done when:** `docs/DESIGN.md` written before any UI markup changes.

- **Task 2.2 — Chat Launcher, Slide-Up Drawer & `appwebsite.js` Integration**
  - Add `#aiChatFab` (`bottom-20 left-3 md:bottom-6 md:left-6 z-40`) and `#aiChatDrawer` (`role="dialog"`, `aria-modal="true"`, `z-[60]`) to `index.html` with 4 starter chips, `aria-live="polite"` transcript, `maxlength="500"` input, Clear button, and Close button.
  - Add drawer/bubble animation styles in `src/tailwind.css` and rebuild `styles.css` (`npm run build:css`).
  - Wire `initAiAssistant(...)` in `appwebsite.js` passing live getters + `addToCart`, `openTrackOrderModal`, `openCartModal`, and `showToast` callbacks; enforce `3s` send cooldown, `Escape`/backdrop close, `escapeHTML`, and `data-action` delegation.
  - **Done when:** Customers can click "Ask AI", tap starter chips or send free-text queries, add recommended items to cart in 1 tap (updating badge & floating cart), or open Track Order directly from chat.
  - **Tests (`TC-048`, `TC-049`):** Contract tests verifying ARIA attributes, bottom-left non-collision positioning, zero inline `onclick`, XSS escaping of AI text, ESM syntax check of `ai-assistant.js` (`TC-039`), and fresh Tailwind CSS sync (`TC-027`).

---

### Milestone 3 — QA, Security Audit & Operator Runbook (Phases 4–7)
*Verifies live desktop + mobile UX, security boundaries, and hands off step-by-step free Google AI Studio + Vercel setup.*

- **Task 3.1 — Phase 4 Live Browser QA & Phase 5 Security Audit**
  - Run `npm run build:css`, `npm test`, and `npm audit` (`0 vulnerabilities`).
  - Run strictly read-only live browser verification at desktop (`1280×800`) and mobile (`375×812`) testing: zero overlap with `#floatingCart`, `#bottomNav`, and `Directions / Call Now`; opening `#aiChatDrawer`; starter chips; one-click **Add to Cart** syncing badge; one-click **Track Order** opening `#trackOrderModal`; `Escape` dismissal; and `0` console/CSP/SW errors.
  - Run security audit checklist (secret isolation, XSS escaping, PII stripping, origin & rate-limit guards, POS/rules untouched).
  - **Done when:** All automated tests green, desktop & mobile QA pass with zero open critical/high bugs or findings.

- **Task 3.2 — Phase 6/7 Runbook, CHANGELOG & Deployment Handoff**
  - Document step-by-step free Google AI Studio key creation and Vercel Environment Variables (`GEMINI_API_KEY`, optional `GEMINI_MODEL`) setup + post-deploy smoke test in `docs/ops/RUNBOOK.md`, update `README.md` / `docs/STATUS.md`, and complete handoff.
  - **Done when:** Owner can enable live Gemini in under 3 minutes with zero ambiguity.

---

## Risk Table
| Risk | Early Milestone | Mitigation |
|---|---|---|
| Vercel `/api/chat.js` routing vs. `outputDirectory: "."` | Milestone 0 | CommonJS `api/chat.js`, literal `vercel.json` headers, post-deploy smoke test of `POST /api/chat`. |
| Free-tier Gemini model deprecation or `429` burst | Milestone 0 & 1 | `GEMINI_MODEL` env override + ordered fallback chain + zero-quota local FAQs + local menu/budget recommender. |
| Mobile UI collision (`bottomNav` + `Call Now` + `floatingCart`) | Milestone 2 & 3 | Bottom-left placement (`bottom-20 left-3 md:bottom-6 md:left-6`) verified live at `375×812` and `1280×800`. |
| Hallucinated item IDs/prices or XSS from LLM text | Milestone 0 & 2 | Structured JSON output + strict ID allowlist against live Firestore `menuItems` + `escapeHTML` everywhere. |
