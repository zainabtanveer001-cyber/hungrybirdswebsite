# Product Requirements Document — Gemini AI Customer Assistant (Hungry Birds Website)

- **Status:** Draft — Awaiting Owner Approval (Phase 0 Gate)
- **Date:** 2026-11-25
- **Project:** Hungry Birds Restaurant Online Ordering Website (`hungrybirdswebsite`)
- **Size / Lifecycle:** Size **M** (Full Lifecycle)

---

## 1. Overview
- **Problem:** Customers browsing 26+ menu items on Hungry Birds often want quick help choosing meals by budget, craving, or group size, checking delivery/loyalty rules, or finding their active order status — in English or Roman Urdu — without calling or waiting on WhatsApp.
- **Target Users:** Guest visitors and signed-in customers ordering on mobile (`375px+`) and desktop browsers.
- **Goals:**
  1. Add a **\$0/month** Gemini AI customer assistant hosted on Vercel (`/api/chat`) using the restaurant's free Google AI Studio key (`GEMINI_API_KEY`) kept strictly server-side.
  2. Ground every recommendation on the live POS menu + current cart state, with one-click **Add to Cart**, **Track Order**, and **Chat on WhatsApp** action buttons inside chat.
  3. Match the customer's language automatically (English, Roman Urdu, or Urdu script) and stay strictly on Hungry Birds food & ordering.
  4. Protect free-tier quota and maintain 100% uptime via zero-quota local FAQ handling + a smart local browser fallback whenever Gemini hits its free-tier `429` rate limit or before `GEMINI_API_KEY` is configured.
  5. Keep the feature **strictly PII-free** and isolated from `hungrybirdspos` and `firestore.rules`.
- **Non-Goals:** Placing/submitting orders inside chat, collecting payments, modifying `firestore.rules` or `hungrybirdspos`, storing chat logs in Firestore, or requiring paid Gemini/Firebase plans.

---

## 2. Personas & Roles
| Role | Capabilities |
|---|---|
| **Guest Customer** (signed out) | Opens the Ask AI drawer, uses starter chips or types questions, receives grounded dish recommendations, adds items to cart in 1 tap, opens Track Order modal (manual ID lookup), or escalates to WhatsApp (`0325-7867774`). |
| **Signed-in Customer** | Everything a Guest can do, plus clicking **Track Order** inside chat launches their existing auto-tracking flow. |
| **Restaurant Owner / Operator** | Creates a free Google AI Studio key once and saves `GEMINI_API_KEY` (and optional `GEMINI_MODEL`) in Vercel Environment Variables; no ongoing manual maintenance required. |

---

## 3. User Stories & Acceptance Criteria

### Epic 1 — Chat Launcher & Accessible Drawer UI
- **US-AI-1 (Must):** As a customer on mobile or desktop, I want an easy-to-reach "Ask AI" button that never blocks my Cart, Bottom Nav, or Call/Directions buttons so I can get help at any time.
  - **Given** I am viewing `index.html` on desktop (`1280×800`) or mobile (`375×812`) **When** the page loads **Then** a floating "Ask AI" launcher button appears at bottom-left (`bottom-20 left-3 md:bottom-6 md:left-6 z-40`), with zero overlap against `#floatingCart`, `#bottomNav`, or the mobile `Directions / Call Now` pill.
  - **Given** I click "Ask AI" **When** the slide-up chat drawer (`role="dialog"`, `z-[60]`) opens **Then** I see a welcome message, 4 starter chips (*"Meal under Rs. 1,000"*, *"Best burgers?"*, *"Delivery info"*, *"Track my order"*), a text input (`maxlength="500"`), and a close button; pressing `Escape` or clicking the close button dismisses it cleanly.

### Epic 2 — Grounded Menu & Ordering Assistance
- **US-AI-2 (Must):** As a customer deciding what to eat, I want meal suggestions based on my budget, craving, group size, and current cart so I can decide quickly.
  - **Given** the live POS menu is loaded **When** I ask e.g. *"Suggest a meal under Rs. 1,000"* or *"bhai 1500 mein 2 logon ke liye kya best hai?"* **Then** the assistant replies concisely in my language recommending only real items currently on the live menu, accurately noting if my Delivery cart is still below the **Rs. 500** delivery minimum.
- **US-AI-3 (Must):** As a customer viewing recommendations in chat, I want one-click action buttons so I do not have to scroll back and search the menu.
  - **Given** the assistant recommends 1–3 menu items **When** the reply renders **Then** each valid item shows a card/pill with its **live Firestore name & price** and an **Add to Cart** button (`data-action`) that calls `addToCart(itemId)` directly; any non-existent or hallucinated item ID returned by the model is silently discarded.
  - **Given** I ask to track my order or contact support **When** the reply renders **Then** a one-click **Track Order** button opens `#trackOrderModal` (running `autoTrackActiveOrder()` if signed in) and a **WhatsApp** link opens `https://wa.me/923257867774`.
- **US-AI-4 (Must):** As a restaurant owner, I want the assistant to stay on-topic and never invent policies, prices, hours, or ingredients so customers never receive false promises.
  - **Given** a customer asks about opening hours, exact delivery fee for their neighborhood, allergens/ingredients, or a complaint **When** the assistant responds **Then** it states plainly that it does not have that exact detail and provides a direct **WhatsApp `0325-7867774`** / **Call** link rather than guessing.
  - **Given** a customer asks an unrelated off-topic question (e.g., homework, coding, politics) **When** the assistant responds **Then** it politely declines and steers back to Hungry Birds food and ordering.

### Epic 3 — Free-Tier Proxy, Quota Guardrails & Local Fallback
- **US-AI-5 (Must):** As the restaurant owner, I want my Gemini API key kept secret on Vercel and protected against spam so the feature stays free and secure.
  - **Given** a browser sends `POST /api/chat` **When** the Vercel Serverless Function executes **Then** it reads `process.env.GEMINI_API_KEY` server-side (never present in any client file), validates same-origin, enforces message length (`<= 500` chars), history window (`<= 6` turns), and per-IP rate limits (`12 req/min`, `60 req/hr`), and enforces a `3s` client cooldown between sends.
- **US-AI-6 (Must):** As a customer, I want instant answers even when Gemini's free-tier quota is busy (`429`) or before the owner adds `GEMINI_API_KEY`.
  - **Given** I ask a deterministic FAQ (*"delivery minimum"*, *"phone/location"*, *"loyalty coupon"*, *"track order"*) **When** I submit the message **Then** the client answers locally in `< 100 ms` with **0** calls to `/api/chat`.
  - **Given** `/api/chat` returns `429`, `503`, `500`, network error, or `configured: false` **When** the client handles the fallback **Then** a local menu/budget matcher replies within `< 100 ms` with real matching menu items + **Add to Cart** buttons and a WhatsApp link (no raw error stack traces).

### Epic 4 — Privacy & Security Guardrails
- **US-AI-7 (Must):** As a privacy-conscious customer, I want none of my personal details sent to Google's free-tier Gemini API.
  - **Given** I am signed in and have items in my cart **When** the browser calls `POST /api/chat` **Then** the JSON request body contains ONLY `{ message, history, menu, cart, orderType }` where `menu` has only `{ id, name, price, category }` (zero base64 images) and `cart` has only `{ id, name, price, qty }` + `subtotal`; it NEVER contains `email`, `phone`, `address`, `customerUid`, or `orderId`.

### Future Backlog (Out of MVP)
- **US-AI-8 (Could):** Admin-editable restaurant FAQs (opening hours, delivery zones, halal/spice notes) in `admin.html`.
- **US-AI-9 (Won't for now):** Conversational checkout submission, voice chat, or reading live order details inside Gemini prompts.

---

## 4. Non-Functional Requirements
- **Cost:** **\$0/month** on Vercel Hobby + Google AI Studio Free Tier (no credit card required).
- **Performance:** Local FAQ/fallback replies `< 100 ms`; `/api/chat` timeout `<= 9 s` (safely inside Vercel Hobby 10s limit); compact menu context `< 10 KB` (zero base64 image strings).
- **Security:** `GEMINI_API_KEY` only in Vercel Environment Variables (empty placeholder in `.env.example`); all AI output escaped via `escapeHTML` (zero raw HTML / inline `onclick`); CSP `connect-src 'self'` already permits `/api/chat`; Service Worker (`sw.js`) bypasses `/api/*`.
- **Privacy:** Zero PII sent to `/api/chat` or Gemini; conversation kept in memory only (never stored in Firestore).
- **Accessibility & Responsive:** `role="dialog"`, `aria-modal="true"`, `aria-live="polite"` transcript, `>= 44×44px` tap targets, keyboard `Escape` close, zero overlap at `375×812` and `1280×800`.
- **POS Isolation:** Zero changes to `firestore.rules`, `storage.rules`, or `hungrybirdspos`.

---

## 5. Out of Scope
- Submitting or modifying orders directly from AI chat.
- Sending customer PII (email, phone, address, UID, order IDs) to Gemini.
- Paid Gemini billing tiers or Firebase Blaze Cloud Functions.
- Admin FAQ management UI in `admin.html`.
- Voice input/output or image analysis.

---

## 6. Assumptions, Open Questions & Top 3 Risks
- **[Assumption 1]:** The site runs on Vercel Hobby, which deploys `/api/*.js` Node serverless functions alongside static files.
- **[Assumption 2]:** The owner will obtain a free API key from Google AI Studio (`aistudio.google.com`) and add `GEMINI_API_KEY` in Vercel Environment Variables; until then, the local fallback powers the assistant cleanly.
- **[Assumption 3]:** The live POS menu remains under ~200 items so compact JSON fits comfortably in a single free-tier prompt.

### Top 3 Risks & Mitigations
| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Vercel `outputDirectory: "."` + `/api/chat.js` routing interaction** | `/api/chat` could return 404 or serve raw source instead of executing as a Serverless Function if misconfigured with static `outputDirectory`. | Verify Vercel's exact `/api` function convention in Phase 1 Architecture, ensure `sw.js` skips `/api/*`, and smoke-test `POST /api/chat` on Vercel immediately after deploy. |
| 2 | **Gemini Free Tier model-alias churn & tight RPM/RPD (`429`) quotas** | Hardcoded model IDs can deprecate or hit 5–15 RPM caps during dinner rush; in-memory IP limits reset on cold starts. | Support `GEMINI_MODEL` env override + ordered free-tier Flash-Lite/Flash fallback chain, handle simple FAQs locally (`0` API calls), enforce server IP + client session cooldowns, and degrade seamlessly to the local menu/budget recommender on any `429`. |
| 3 | **Hallucinated menu items, prices, or prompt injection** | AI could invent dishes/discounts or output unsafe markup. | Enforce Gemini `responseMimeType: "application/json"` (`reply`, `recommendedItemIds`, `actions`), validate every `recommendedItemId` against live client `menuItems` (always rendering real Firestore prices), and escape all text with `escapeHTML`. |

### What We Are Least Sure About
1. Which exact free-tier Flash-Lite/Flash model ID will have the highest RPD allocation on the owner's newly created Google AI Studio project (mitigated by `GEMINI_MODEL` env var + ordered fallback chain).
2. Whether any Vercel Dashboard project override interacts with `outputDirectory: "."` when adding the first `/api/chat.js` serverless function (verified during Phase 1 Architecture & deploy smoke test).

---

## 7. Success Metrics
1. **Availability:** `100%` of customer chat messages return a helpful, on-topic response (via Gemini or seamless local fallback) with `0` uncaught JS errors or leaked secrets.
2. **Privacy Compliance:** `0` PII fields (`email`, `phone`, `address`, `uid`, `orderId`) ever included in `/api/chat` payloads (verified by automated contract tests).
3. **Ordering Facilitation:** Customers can go from chat recommendation to item-in-cart or open Track Order in `1` tap on both `375×812` mobile and `1280×800` desktop with zero overlapping UI chrome.
