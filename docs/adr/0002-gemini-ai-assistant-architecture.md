# ADR-0002: Zero-Cost Gemini AI Customer Assistant Architecture

- **Status:** Proposed (Phase 1 Gate — Awaiting Owner Approval)
- **Date:** 2026-11-25
- **Related Requirements:** `US-AI-1`–`US-AI-7` in [PRD.md](../PRD.md)

## Context
Hungry Birds wants a customer-facing Gemini AI assistant on its Vercel-hosted static website (`hungrybirdswebsite`) that:
1. Costs **\$0/month** (no paid Gemini tier, no Firebase Blaze upgrade).
2. Keeps `GEMINI_API_KEY` completely hidden from client browsers.
3. Stays responsive even when Google AI Studio's free tier enforces tight RPM/RPD caps (`429`) or before `GEMINI_API_KEY` is configured.
4. Sends **zero customer PII** to Google's free tier and leaves `firestore.rules` and `hungrybirdspos` untouched.

## Options Considered

### Decision 1 — Backend Proxy Hosting
| Option | Cost | Pros | Cons |
|---|---|---|---|
| **A. Vercel Serverless Function (`api/chat.js`)** *(Recommended)* | \$0/mo (Vercel Hobby) | Already hosted on Vercel; keeps `GEMINI_API_KEY` server-side; same-origin `/api/chat` works with existing CSP `connect-src 'self'`; zero Firebase billing change. | 10s execution timeout on Hobby; in-memory rate limits reset on cold starts. |
| **B. Firebase Cloud Functions (`functions/`)** | Requires Blaze billing | Co-located with Firebase project. | Requires credit card / Blaze plan upgrade (violates free-to-use goal); cross-origin CORS + CSP changes required. |
| **C. Direct browser call with embedded API key** | \$0/mo | No backend file needed. | **Rejected (Critical Security Risk):** Exposes `GEMINI_API_KEY` in client JS so anyone can steal quota; violates `connect-src` minimization. |

### Decision 2 — Gemini Client & Quota Protection Strategy
| Option | Cost | Pros | Cons |
|---|---|---|---|
| **A. Zero-dependency Node `fetch` to Gemini REST API + structured JSON schema + hybrid client local FAQ/fallback engine** *(Recommended)* | \$0/mo | Zero new npm dependencies (`0` supply-chain/audit bloat); native `AbortSignal.timeout` fits Vercel's 10s limit; ordered model fallback list (`GEMINI_MODEL` override -> Flash-Lite/Flash chain); simple FAQs use `0` Gemini calls; seamless local recommender on `429`/unconfigured key. | Slightly more handwritten fetch/validation code (~150 LOC), covered by unit tests. |
| **B. Install `@google/genai` SDK + send every message to Gemini** | \$0/mo | Official SDK wrappers. | Adds package dependency & cold-start size; wastes scarce free-tier RPM/RPD quota on deterministic FAQs; dead UI when `429` hits or key is missing. |

## Decision
Adopt **Option A** for both decisions:
1. Deploy a CommonJS Vercel Serverless Function at `api/chat.js` (backed by private helper `api/_lib/gemini-assistant.js`) matching `package.json` `"type": "commonjs"`, invoking `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` via native Node `fetch` with `responseMimeType: "application/json"`.
2. Ship a client ES module `ai-assistant.js` containing a zero-quota deterministic FAQ router (`tryLocalFaqAnswer`), a smart local menu/budget recommender (`buildLocalMenuFallback`), a strict PII-stripping payload builder (`buildSanitizedAiPayload`), and the accessible bottom-left chat drawer UI.

## Consequences
- **Positive:** Strictly **\$0/month** on Vercel Hobby + Google AI Studio Free Tier; zero new npm runtime dependencies; `GEMINI_API_KEY` never enters client bundles or git; zero changes to `firestore.rules` or `hungrybirdspos`; works immediately in local fallback mode even before `GEMINI_API_KEY` is added.
- **Trade-offs:** In-memory per-IP rate limiting in `api/chat.js` is best-effort per warm serverless instance (mitigated by pairing with same-origin checks, `3s` client cooldown, zero-quota local FAQs, and Google AI Studio's own project cap + graceful `429` fallback).
- **Follow-up:** Owner creates a free Google AI Studio key and adds `GEMINI_API_KEY` in Vercel Project Settings → Environment Variables (documented in `docs/ops/RUNBOOK.md`).
