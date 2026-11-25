# UI/UX Design Specification — Gemini AI Customer Assistant

- **Phase:** Phase 2 (Senior UI/UX Designer)
- **Date:** 2026-11-25
- **Source Requirements:** [docs/PRD.md](./PRD.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. Visual Direction & Top 3 Tasks
**Visual Direction:** *Warm, snappy Hungry Birds concierge* — crisp white frosted drawer (`bg-white`), Hungry Birds `#f97316` orange primary actions paired with dark `#111827` slate bubbles/headers for high contrast, soft `rounded-3xl` geometry matching the storefront modals, and zero intrusion on existing ordering controls.

**Top 3 User Tasks:**
1. **Discover meals by budget, craving, or group size** → tap **Ask AI** → tap a starter chip or type a query → tap **Add to Cart** directly on a recommended item card.
2. **Instant FAQ lookup** (delivery minimum `Rs. 500`, `0325-7867774` WhatsApp/Call, Google Maps location, 10-order loyalty coupon) in English or Roman Urdu.
3. **Track an order or escalate unknown questions** → tap **Track Order** (opens `#trackOrderModal`) or **Chat on WhatsApp** inside chat.

---

## 2. User Flows & Unhappy Paths
- **Flow A (Happy Path — Gemini / Recommendation):** Tap `#aiChatFab` → Drawer opens & focuses `#aiChatInput` → User taps `"Meal under Rs. 1,000"` or submits text → Bubble renders user prompt + typing dots (`< 9 s`) → Assistant bubble renders concise advice + `1–3` live-priced menu cards with **Add to Cart** buttons → User taps **Add to Cart** → `addToCart(id)` updates cart badge, floating cart, and shows `"Item added"` feedback.
- **Flow B (Zero-Quota Local FAQ):** User taps `"Delivery info"` or `"Track my order"` → Responds in `< 100 ms` without calling `/api/chat`, surfacing `"Track Order"` or `"Open Cart"` action pills.
- **Flow C (Unhappy Paths):**
  - *Gemini `429` / `503` unconfigured / offline:* Silently falls back to `buildLocalMenuFallback()`, tagging the reply subtly with `"Menu helper (offline/local mode)"` and serving real matched menu items + WhatsApp button (never raw error stacks).
  - *Cooldown active (`< 3 s`):* Input stays preserved; concise helper text warns `"Please wait a moment before sending another message."`
  - *Unknown details (hours, exact delivery fee, allergens, complaints):* Honestly states unavailability and shows `Chat on WhatsApp (0325-7867774)` button.

---

## 3. Design Tokens (WCAG 2.2 AA Checked)
| Token | Value | Contrast / Usage |
|---|---|---|
| Accent Primary | `#f97316` (`orange-500`) / hover `#ea580c` | Primary CTA pills (`>= 4.5:1` with dark ink or used as icon badge + crisp white/dark pairing) |
| Primary Surface & Ink | `#ffffff` surface, `#111827` (`gray-900`) ink | `17.7:1` contrast for body/header copy |
| Muted Meta Ink | `#4b5563` (`gray-600`) on `#ffffff` / `#f8fafc` | `7.5:1` contrast (`>= 4.5:1`) |
| User Bubble | `bg-gray-900 text-white` | `17.7:1` contrast, `rounded-2xl rounded-br-sm` |
| Assistant Bubble | `bg-orange-50/70 border border-orange-100 text-gray-900` | `>= 14:1` contrast, `rounded-2xl rounded-bl-sm` |
| Type Scale | Inherited `font-sans`: Header `16px` (`text-base font-bold`), Body `14px` (`text-sm`), Chips/Badges `12px` (`text-xs`) | Readable without pinch-zoom (`16px` input font `text-sm sm:text-sm`, preventing cramped controls) |
| Radii & Shadows | FAB `rounded-full shadow-xl`, Drawer `rounded-t-3xl sm:rounded-3xl shadow-2xl`, Cards `rounded-2xl` | Matches existing storefront modals |
| Z-Index Layers | Launcher `#aiChatFab`: `z-40`; Drawer `#aiChatDrawer`: `z-[60]` | Below modals (`z-[60]`) when closed; sits above nav (`z-50`) and CTA (`z-40`) when open |
| Motion | Backdrop & panel `0.28s–0.35s`; respects `@media (prefers-reduced-motion: reduce)` | Zero vestibular hazard |

---

## 4. Component Inventory & States
1. **`#aiChatFab` (Launcher Pill):** Bottom-left floating button (`bg-gray-900 text-white`, orange sparkle/robot icon badge, `"Ask AI"` label, `min-h-[44px] min-w-[44px] px-4 py-2.5`). States: default, hover (`bg-orange-500`), focus-visible ring, hidden behind open `z-[60]` drawer.
2. **`#aiChatDrawer` (Slide-Up Dialog):** `modal-backdrop` overlay + panel (`max-w-md w-full h-[82vh] sm:h-[600px] max-h-[88vh] flex flex-col`).
   - Header: icon badge, `#aiChatTitle` (`"Hungry Birds AI"` + subtle status pill), `#clearAiChatBtn` (`"Clear"`), `#closeAiChatBtn` (`40×40px` hit target).
   - Transcript (`#aiChatMessages`, `aria-live="polite"`, `overflow-y-auto`): Initial welcome greeting; typing dots state (`.ai-typing-dot`); user/assistant bubbles; inline menu recommendation cards (thumb/category badge, `escapeHTML(name)`, `Rs. X`, **Add to Cart** button); action buttons (`Track Order`, `Open Cart`, `WhatsApp`).
   - Quick Starter Chips (`#aiStarterChips`): 4 horizontal wrap/scroll chips (`Meal under Rs. 1,000`, `Best burgers?`, `Delivery info`, `Track my order`).
   - Composer Form (`#aiChatForm`): `#aiChatInput` (`maxlength="500"`, explicit label/aria-label) + `#aiChatSendBtn` (`min-w-[44px] min-h-[44px]`, disabled during send).

---

## 5. Responsive Placement & Non-Collision Spec
- **Mobile (`375×812`):**
  - `#bottomNav` occupies `bottom-0` (`~58px`).
  - Existing `Directions / Call Now` pill occupies `bottom-20 right-3 z-40`.
  - `#aiChatFab` occupies **`bottom-20 left-3 z-40`** → cleanly opposite side on the bottom row (`left-3` vs `right-3`), max width `~112px`, leaving `> 60px` horizontal clearance from `Directions / Call Now` (`~195px` on right) and `0px` overlap.
  - `#aiChatDrawer` spans full width (`rounded-t-3xl max-h-[85vh]`) anchored bottom above mobile keyboard.
- **Tablet / Desktop (`768px` & `1280×800`):**
  - `#floatingCart` occupies desktop bottom-right (`bottom-6 right-6`).
  - `#aiChatFab` occupies **`md:bottom-6 md:left-6 z-40`** → opposite corner from `#floatingCart`.
  - `#aiChatDrawer` anchors bottom-left (`md:items-end md:justify-start md:p-6`), max width `420px`.

---

## 6. Accessibility Bar (WCAG 2.2 AA)
- `#aiChatDrawer`: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="aiChatTitle"`, `aria-hidden="true"` when closed.
- `#aiChatFab`: `type="button"`, `aria-label="Open Hungry Birds AI Assistant"`, `aria-haspopup="dialog"`, `aria-controls="aiChatDrawer"`, `aria-expanded="false"`.
- Keyboard: `Escape` closes drawer and returns focus to `#aiChatFab`; `Enter` submits form cleanly; visible Tailwind focus rings on every button/chip/input.
- Security-by-design in UI: all assistant text escaped via `escapeHTML`, zero markdown HTML injection, all dynamic clicks routed via `data-action` attributes.
