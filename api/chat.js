const {
  MAX_BODY_BYTES,
  createRateLimiter,
  getClientIp,
  isAllowedOrigin,
  fetchServerAiKnowledge,
  validateAndSanitizeInput,
  callGeminiWithFallback,
} = require('./_lib/gemini-assistant');

function sendJson(res, statusCode, payload) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
  return undefined;
}

async function readJsonBody(req) {
  if (req && req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
        const err = new Error('Payload too large.');
        err.code = 'TOO_LARGE';
        throw err;
      }
      return JSON.parse(req.body);
    }
    if (typeof req.body === 'object' && req.body !== null) {
      const serialized = JSON.stringify(req.body);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
        const err = new Error('Payload too large.');
        err.code = 'TOO_LARGE';
        throw err;
      }
      return req.body;
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buf.length;
      if (totalBytes > MAX_BODY_BYTES) {
        settled = true;
        const err = new Error('Payload too large.');
        err.code = 'TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('Malformed JSON body.');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function createChatHandler({
  fetchImpl = globalThis.fetch,
  env = process.env,
  rateLimiter = createRateLimiter(),
  loadKnowledgeImpl = null,
} = {}) {
  return async function chatHandler(req, res) {
    if (!req || req.method !== 'POST') {
      return sendJson(res, 405, {
        error: 'METHOD_NOT_ALLOWED',
        message: 'Use POST.',
        fallback: false,
      });
    }

    if (!isAllowedOrigin(req)) {
      return sendJson(res, 403, {
        error: 'FORBIDDEN_ORIGIN',
        message: 'Cross-origin requests are not allowed.',
        fallback: false,
      });
    }

    const clientIp = getClientIp(req);
    const rate = rateLimiter.checkRateLimit(clientIp);
    if (!rate.allowed) {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      }
      return sendJson(res, 429, {
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please try again shortly.',
        retryAfterSeconds: rate.retryAfterSeconds,
        fallback: true,
      });
    }

    let rawBody;
    try {
      rawBody = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, {
        error: err?.code === 'TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON',
        message: err?.message || 'Invalid JSON body.',
        fallback: false,
      });
    }

    const sanitized = validateAndSanitizeInput(rawBody);
    if (!sanitized.ok) {
      return sendJson(res, 400, {
        error: 'INVALID_REQUEST',
        message: sanitized.error,
        fallback: false,
      });
    }

    const apiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
    if (!apiKey) {
      return sendJson(res, 503, {
        error: 'AI_NOT_CONFIGURED',
        message: 'Gemini API key not configured.',
        fallback: true,
      });
    }

    const serverKnowledge = loadKnowledgeImpl
      ? await Promise.resolve(loadKnowledgeImpl()).catch(() => null)
      : await fetchServerAiKnowledge({ fetchImpl }).catch(() => null);

    const upstream = await callGeminiWithFallback({
      apiKey,
      sanitized: sanitized.value,
      serverKnowledge,
      envModel: env.GEMINI_MODEL,
      fetchImpl,
    });

    if (!upstream.ok) {
      return sendJson(res, upstream.status, {
        error: upstream.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE',
        message: upstream.error,
        fallback: true,
      });
    }

    return sendJson(res, 200, {
      reply: upstream.result.reply,
      recommendedItemIds: upstream.result.recommendedItemIds,
      actions: upstream.result.actions,
      model: upstream.model,
      source: 'gemini',
    });
  };
}

const defaultHandler = createChatHandler();
defaultHandler.createChatHandler = createChatHandler;
module.exports = defaultHandler;
