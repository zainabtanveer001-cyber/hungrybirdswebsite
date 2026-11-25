const DEFAULT_MODEL_CHAIN = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
];

const ALLOWED_ACTIONS = new Set(['TRACK_ORDER', 'OPEN_CART', 'WHATSAPP']);
const MAX_BODY_BYTES = 32 * 1024;
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
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req?.socket?.remoteAddress || 'unknown';
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isAllowedOrigin(req) {
  const origin = req?.headers?.origin;
  if (!origin) return true;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const rawHost = req?.headers?.['x-forwarded-host'] || req?.headers?.host || '';
  const host = String(rawHost).split(',')[0].trim().toLowerCase();
  if (!host) return false;

  const originHost = originUrl.host.toLowerCase();
  if (originHost === host) return true;

  const [hostName, hostPort = ''] = host.split(':');
  if (isLoopbackHost(originUrl.hostname) && isLoopbackHost(hostName) && originUrl.port === hostPort) {
    return true;
  }

  return false;
}

function containsDataImage(str) {
  return typeof str === 'string' && /data:image\//i.test(str);
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
      const id = String(item.id ?? '').trim().slice(0, 80);
      const name = String(item.name ?? '').trim().slice(0, 120);
      const category = String(item.category ?? 'Menu').trim().slice(0, 60) || 'Menu';
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
      const id = String(item.id ?? '').trim().slice(0, 80);
      const name = String(item.name ?? '').trim().slice(0, 120);
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

  return {
    ok: true,
    value: {
      message,
      history,
      menu,
      cart: { items: cartItems, subtotal },
      orderType,
    },
  };
}

function getModelChain(envModel) {
  const trimmed = typeof envModel === 'string' ? envModel.trim() : '';
  const chain = trimmed ? [trimmed, ...DEFAULT_MODEL_CHAIN] : [...DEFAULT_MODEL_CHAIN];
  return Array.from(new Set(chain.filter(Boolean)));
}

function buildGeminiRequestBody(sanitized) {
  const menuLines = sanitized.menu
    .map((item) => `- [${item.id}] ${item.name} (${item.category}) - Rs. ${item.price}`)
    .join('\n');

  const cartLines = sanitized.cart.items.length
    ? sanitized.cart.items.map((item) => `${item.name} x${item.qty} (Rs. ${item.price * item.qty})`).join(', ')
    : 'Empty';

  const systemText = [
    'You are the Hungry Birds Restaurant online ordering assistant.',
    'Stay strictly focused on Hungry Birds food, menu recommendations, budget planning, cart help, delivery/takeaway basics, and order tracking.',
    'Politely decline unrelated off-topic questions and offer to help with the Hungry Birds menu.',
    'Reply concisely (2-4 short sentences) and naturally in the same language/script as the customer (English, Roman Urdu, or Urdu script).',
    'Verified store facts only: Minimum delivery order is Rs. 500; delivery fee varies by area and is confirmed by staff; every 10 completed online orders earns a 10% off loyalty coupon; WhatsApp/Call support is 0325-7867774; customer can track orders via the Track Order button.',
    'Do NOT guess opening hours, exact neighborhood delivery charges, allergen/ingredient guarantees, or unresolved complaints. Say plainly you do not have that exact detail and include "WHATSAPP" in actions.',
    'ONLY recommend items from the provided MENU list using exact item IDs in recommendedItemIds (max 3). Never invent prices or items.',
    'Allowed actions values: "TRACK_ORDER", "OPEN_CART", "WHATSAPP".',
    'Respond ONLY with JSON containing keys: reply (string), recommendedItemIds (string[]), actions (string[]).',
  ].join(' ');

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
      maxOutputTokens: 350,
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

  let parsed;
  try {
    parsed = JSON.parse(stripJsonCodeFence(candidateText));
  } catch {
    return { ok: false, error: 'Malformed JSON from Gemini.' };
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
  const requestBody = buildGeminiRequestBody(sanitized);
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
  validateAndSanitizeInput,
  getModelChain,
  buildGeminiRequestBody,
  parseAndValidateModelOutput,
  callGeminiWithFallback,
};
