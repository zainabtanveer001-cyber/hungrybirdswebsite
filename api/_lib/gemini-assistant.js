const DEFAULT_MODEL_CHAIN = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

const ALLOWED_ACTIONS = new Set(['TRACK_ORDER', 'OPEN_CART', 'WHATSAPP']);
const MAX_BODY_BYTES = 48 * 1024;
const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_TURNS = 6;
const MAX_MENU_ITEMS = 150;
const MAX_CART_ITEMS = 50;
const MAX_RECOMMENDATIONS = 3;

function createRateLimiter({ minuteLimit = 12, hourLimit = 60, maxIps = 1000 } = {}) {
  const hitsByIp = new Map();

  function checkRateLimit(ip, now = Date.now()) {
    const key = String(ip || 'unknown').slice(0, 128);
    if (!hitsByIp.has(key) && hitsByIp.size >= maxIps) {
      const oldestKey = hitsByIp.keys().next().value;
      if (oldestKey !== undefined) hitsByIp.delete(oldestKey);
    }

    const entry = hitsByIp.get(key) || { minuteHits: [], hourHits: [] };
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;

    entry.minuteHits = entry.minuteHits.filter((ts) => ts > oneMinuteAgo);
    entry.hourHits = entry.hourHits.filter((ts) => ts > oneHourAgo);

    if (entry.minuteHits.length >= minuteLimit) {
      const oldest = entry.minuteHits[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
      hitsByIp.set(key, entry);
      return { allowed: false, retryAfterSeconds };
    }

    if (entry.hourHits.length >= hourLimit) {
      const oldest = entry.hourHits[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + 3_600_000 - now) / 1000));
      hitsByIp.set(key, entry);
      return { allowed: false, retryAfterSeconds };
    }

    entry.minuteHits.push(now);
    entry.hourHits.push(now);
    hitsByIp.set(key, entry);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return { checkRateLimit, _hitsByIp: hitsByIp };
}

function getClientIp(req) {
  const realIp = req?.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  const vercelXff = req?.headers?.['x-vercel-forwarded-for'];
  if (typeof vercelXff === 'string' && vercelXff.trim()) {
    return vercelXff.split(',')[0].trim();
  }
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req?.socket?.remoteAddress || 'unknown';
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isAllowedOrigin(req) {
  const secFetchSite = String(req?.headers?.['sec-fetch-site'] || '').trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const originOrReferer = req?.headers?.origin || req?.headers?.referer;
  if (!originOrReferer) return false;

  let sourceUrl;
  try {
    sourceUrl = new URL(originOrReferer);
  } catch {
    return false;
  }

  const rawHost = req?.headers?.['x-forwarded-host'] || req?.headers?.host || '';
  const host = String(rawHost).split(',')[0].trim().toLowerCase();
  if (!host) return false;

  const sourceHost = sourceUrl.host.toLowerCase();
  if (sourceHost === host) return true;

  const [hostName, hostPort = ''] = host.split(':');
  if (isLoopbackHost(sourceUrl.hostname) && isLoopbackHost(hostName) && sourceUrl.port === hostPort) {
    return true;
  }

  return false;
}

function containsDataImage(str) {
  return typeof str === 'string' && /data:image\//i.test(str);
}

function sanitizeKnowledge(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const clip = (val, max) => {
    const s = typeof val === 'string' ? val.trim().slice(0, max) : '';
    return containsDataImage(s) ? '' : s;
  };
  const openingHours = clip(raw.openingHours, 240);
  const deliveryInfo = clip(raw.deliveryInfo, 400);
  const foodNotes = clip(raw.foodNotes, 500);
  const dealsAndUpsells = clip(raw.dealsAndUpsells, 500);
  const customInstructions = clip(raw.customInstructions, 1000);
  const faqs = Array.isArray(raw.faqs)
    ? raw.faqs
        .slice(0, 15)
        .map((f) => ({
          question: clip(f?.question, 160),
          answer: clip(f?.answer, 350),
        }))
        .filter((f) => f.question && f.answer)
    : [];

  if (!openingHours && !deliveryInfo && !foodNotes && !dealsAndUpsells && !customInstructions && !faqs.length) {
    return null;
  }
  return { openingHours, deliveryInfo, foodNotes, dealsAndUpsells, customInstructions, faqs };
}

function parseFirestoreRestValue(val) {
  if (!val || typeof val !== 'object') return undefined;
  if ('stringValue' in val) return String(val.stringValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('arrayValue' in val) {
    const items = (val.arrayValue && val.arrayValue.values) || [];
    return items.map((entry) => parseFirestoreRestValue(entry));
  }
  if ('mapValue' in val) {
    const out = {};
    const fields = (val.mapValue && val.mapValue.fields) || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = parseFirestoreRestValue(v);
    }
    return out;
  }
  return undefined;
}

const knowledgeCache = { data: null, expiresAt: 0 };

async function fetchServerAiKnowledge({
  fetchImpl = globalThis.fetch,
  projectId = 'hungry-birds-3e16f',
  ttlMs = 60_000,
  now = Date.now(),
} = {}) {
  if (knowledgeCache.expiresAt > now) {
    return knowledgeCache.data;
  }
  if (typeof fetchImpl !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/aiConfig/knowledge`;
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      return knowledgeCache.data;
    }
    const payload = await response.json();
    const raw = {};
    for (const [key, val] of Object.entries(payload?.fields || {})) {
      raw[key] = parseFirestoreRestValue(val);
    }
    const clean = sanitizeKnowledge(raw);
    knowledgeCache.data = clean;
    knowledgeCache.expiresAt = now + ttlMs;
    return clean;
  } catch {
    return knowledgeCache.data;
  } finally {
    clearTimeout(timer);
  }
}

function stripControlChars(str) {
  return String(str ?? '').replace(/[\r\n\t]+/g, ' ').trim();
}

function validateAndSanitizeInput(rawBody) {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  if (typeof rawBody.message !== 'string') {
    return { ok: false, error: 'Message is required.' };
  }
  const message = rawBody.message.trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Message must be between 1 and ${MAX_MESSAGE_CHARS} characters.` };
  }

  if (!Array.isArray(rawBody.menu) || rawBody.menu.length === 0) {
    return { ok: false, error: 'Menu context is required.' };
  }

  const menu = rawBody.menu
    .slice(0, MAX_MENU_ITEMS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = stripControlChars(item.id ?? '').slice(0, 80);
      const name = stripControlChars(item.name ?? '').slice(0, 120);
      const category = stripControlChars(item.category ?? 'Menu').slice(0, 60) || 'Menu';
      const price = Number(item.price);
      if (!id || !name || !Number.isFinite(price) || price < 0) return null;
      if (containsDataImage(id) || containsDataImage(name) || containsDataImage(category)) return null;
      return { id, name, price, category };
    })
    .filter(Boolean);

  if (menu.length === 0) {
    return { ok: false, error: 'Menu must contain at least one valid item.' };
  }

  const history = Array.isArray(rawBody.history)
    ? rawBody.history
        .slice(-MAX_HISTORY_TURNS)
        .map((turn) => {
          if (!turn || typeof turn !== 'object') return null;
          const role = turn.role === 'model' ? 'model' : turn.role === 'user' ? 'user' : null;
          const text = typeof turn.text === 'string' ? turn.text.trim().slice(0, MAX_MESSAGE_CHARS) : '';
          if (!role || !text) return null;
          return { role, text };
        })
        .filter(Boolean)
    : [];

  const orderType = rawBody.orderType === 'TAKEAWAY' ? 'TAKEAWAY' : 'DELIVERY';

  const rawCartItems = Array.isArray(rawBody.cart?.items) ? rawBody.cart.items : [];
  const cartItems = rawCartItems
    .slice(0, MAX_CART_ITEMS)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = stripControlChars(item.id ?? '').slice(0, 80);
      const name = stripControlChars(item.name ?? '').slice(0, 120);
      const price = Number(item.price);
      const qty = Math.floor(Number(item.qty));
      if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
        return null;
      }
      return { id, name, price, qty: Math.min(99, qty) };
    })
    .filter(Boolean);

  const rawSubtotal = Number(rawBody.cart?.subtotal);
  const subtotal =
    Number.isFinite(rawSubtotal) && rawSubtotal >= 0
      ? rawSubtotal
      : cartItems.reduce((sum, item) => sum + item.price * item.qty, 0);

  // Never trust client-supplied knowledge/customInstructions for Gemini systemInstruction.
  const value = {
    message,
    history,
    menu,
    cart: { items: cartItems, subtotal },
    orderType,
  };

  return {
    ok: true,
    value,
  };
}

function getModelChain(envModel) {
  const trimmed = typeof envModel === 'string' ? envModel.trim() : '';
  const chain = trimmed ? [trimmed, ...DEFAULT_MODEL_CHAIN] : [...DEFAULT_MODEL_CHAIN];
  return Array.from(new Set(chain.filter(Boolean)));
}

function buildGeminiRequestBody(sanitized, serverKnowledge = null) {
  const menuLines = sanitized.menu
    .map((item) => `- [${item.id}] ${item.name} (${item.category}) - Rs. ${item.price}`)
    .join('\n');

  const cartLines = sanitized.cart.items.length
    ? sanitized.cart.items.map((item) => `${item.name} x${item.qty} (Rs. ${item.price * item.qty})`).join(', ')
    : 'Empty';

  const trustedKnowledge = sanitizeKnowledge(serverKnowledge);
  const knowledgeParts = [];
  if (trustedKnowledge) {
    const k = trustedKnowledge;
    if (k.openingHours) knowledgeParts.push(`Opening Hours: ${k.openingHours}`);
    if (k.deliveryInfo) knowledgeParts.push(`Delivery Areas & Fees: ${k.deliveryInfo}`);
    if (k.foodNotes) knowledgeParts.push(`Bestsellers, Spice & Halal Notes: ${k.foodNotes}`);
    if (k.dealsAndUpsells) knowledgeParts.push(`Deals & Upsell Guidance: ${k.dealsAndUpsells}`);
    if (k.customInstructions) knowledgeParts.push(`Owner Instructions: ${k.customInstructions}`);
    if (k.faqs?.length) {
      knowledgeParts.push(
        `Custom Owner Q&As: ${k.faqs.map((f) => `Q: ${f.question} -> A: ${f.answer}`).join(' | ')}`
      );
    }
  }

  const systemText = [
    'You are the Hungry Birds Restaurant online ordering assistant.',
    'Stay strictly focused on Hungry Birds food, menu recommendations, budget planning, cart help, delivery/takeaway basics, and order tracking.',
    'Politely decline unrelated off-topic questions and offer to help with the Hungry Birds menu.',
    'Reply concisely (2-4 short sentences) and naturally in the same language/script as the customer (English, Roman Urdu, or Urdu script).',
    'Verified store facts: Minimum delivery order is Rs. 500; every 10 completed online orders earns a 10% off loyalty coupon; WhatsApp/Call support is 0325-7867774; customer can track orders via the Track Order button.',
    knowledgeParts.length
      ? `RESTAURANT OWNER KNOWLEDGE BASE (authoritative): ${knowledgeParts.join(' ; ')}`
      : 'Do NOT guess opening hours, exact neighborhood delivery charges, allergen/ingredient guarantees, or unresolved complaints. Say plainly you do not have that exact detail and include "WHATSAPP" in actions.',
    knowledgeParts.length
      ? 'For any detail NOT covered in the menu or owner knowledge base (like unresolved complaints or missing info), do not guess — direct the customer to WhatsApp 0325-7867774 with "WHATSAPP" in actions.'
      : '',
    'ONLY recommend items from the provided MENU list using exact item IDs in recommendedItemIds (max 3). Never invent prices or items.',
    'Allowed actions values: "TRACK_ORDER", "OPEN_CART", "WHATSAPP".',
    'Respond ONLY with JSON containing keys: reply (string), recommendedItemIds (string[]), actions (string[]).',
  ].filter(Boolean).join(' ');

  const contents = sanitized.history.map((turn) => ({
    role: turn.role,
    parts: [{ text: turn.text }],
  }));

  contents.push({
    role: 'user',
    parts: [
      {
        text: [
          `CURRENT MODE: ${sanitized.orderType}`,
          `CURRENT CART (Subtotal Rs. ${sanitized.cart.subtotal}): ${cartLines}`,
          `LIVE MENU:\n${menuLines}`,
          `CUSTOMER MESSAGE: ${sanitized.message}`,
        ].join('\n\n'),
      },
    ],
  });

  return {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          reply: { type: 'STRING' },
          recommendedItemIds: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
          actions: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['reply', 'recommendedItemIds', 'actions'],
      },
    },
  };
}

function stripJsonCodeFence(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function parseAndValidateModelOutput(rawGeminiJson, validMenuIds) {
  const candidateText = rawGeminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof candidateText !== 'string' || !candidateText.trim()) {
    return { ok: false, error: 'Empty Gemini candidate response.' };
  }

  const stripped = stripJsonCodeFence(candidateText);
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return {
      ok: true,
      data: {
        reply: stripped.slice(0, 1200),
        recommendedItemIds: [],
        actions: [],
      },
    };
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.reply !== 'string') {
    return { ok: false, error: 'Missing reply string in Gemini JSON.' };
  }

  const reply = parsed.reply.trim().slice(0, 1200);
  if (!reply) {
    return { ok: false, error: 'Blank reply from Gemini.' };
  }

  const recommendedItemIds = [];
  if (Array.isArray(parsed.recommendedItemIds)) {
    for (const rawId of parsed.recommendedItemIds) {
      const id = String(rawId ?? '').trim();
      if (id && validMenuIds.has(id) && !recommendedItemIds.includes(id)) {
        recommendedItemIds.push(id);
        if (recommendedItemIds.length >= MAX_RECOMMENDATIONS) break;
      }
    }
  }

  const actions = [];
  if (Array.isArray(parsed.actions)) {
    for (const rawAction of parsed.actions) {
      const action = String(rawAction ?? '').trim().toUpperCase();
      if (ALLOWED_ACTIONS.has(action) && !actions.includes(action)) {
        actions.push(action);
      }
    }
  }

  return {
    ok: true,
    data: {
      reply,
      recommendedItemIds,
      actions,
    },
  };
}

async function callGeminiWithFallback({
  apiKey,
  sanitized,
  serverKnowledge = null,
  envModel,
  fetchImpl = globalThis.fetch,
  timeoutMs = 6500,
  totalDeadlineMs = 8500,
}) {
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 502, error: 'Fetch API unavailable.' };
  }

  const models = getModelChain(envModel);
  const validMenuIds = new Set(sanitized.menu.map((item) => item.id));
  const requestBody = buildGeminiRequestBody(sanitized, serverKnowledge);
  const startedAt = Date.now();
  let sawRateLimit = false;

  for (const model of models) {
    const remaining = totalDeadlineMs - (Date.now() - startedAt);
    if (remaining <= 400) break;

    const perAttemptMs = Math.min(timeoutMs, remaining);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perAttemptMs);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) sawRateLimit = true;
        console.warn('Gemini upstream status:', model, response.status);
        if (response.status === 404 || response.status === 429 || response.status >= 500) {
          continue;
        }
        return { ok: false, status: 502, error: `Upstream HTTP ${response.status}` };
      }

      const rawJson = await response.json();
      const validated = parseAndValidateModelOutput(rawJson, validMenuIds);
      if (!validated.ok) {
        console.warn('Gemini output parse failure:', model, validated.error);
        continue;
      }

      return {
        ok: true,
        model,
        result: validated.data,
      };
    } catch (err) {
      console.warn('Gemini upstream fetch error:', model, err?.name || 'Error');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: sawRateLimit ? 429 : 502,
    error: sawRateLimit ? 'Gemini free-tier quota temporarily exhausted.' : 'AI service temporarily unavailable.',
  };
}

module.exports = {
  DEFAULT_MODEL_CHAIN,
  ALLOWED_ACTIONS,
  MAX_BODY_BYTES,
  createRateLimiter,
  getClientIp,
  isAllowedOrigin,
  sanitizeKnowledge,
  fetchServerAiKnowledge,
  validateAndSanitizeInput,
  getModelChain,
  buildGeminiRequestBody,
  parseAndValidateModelOutput,
  callGeminiWithFallback,
};
