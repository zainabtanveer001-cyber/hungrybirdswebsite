import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const readRepoFile = (relPath) =>
  fs.readFileSync(path.join(ROOT, relPath), 'utf8');

const indexHtml = readRepoFile('index.html');
const adminHtml = readRepoFile('admin.html');
const mapHtml = readRepoFile('google-maps-embed.html');
const appJs = readRepoFile('appwebsite.js');
const adminJs = readRepoFile('adminwebsite.js');
const rulesText = readRepoFile('firestore.rules');
const storageRulesText = readRepoFile('storage.rules');
const swJs = readRepoFile('sw.js');
const committedCss = readRepoFile('styles.css');
const vercelJson = JSON.parse(readRepoFile('vercel.json'));
const functionsJs = readRepoFile('functions/index.js');

/**
 * Extracts a top-level function declaration from source text by brace matching.
 */
function extractFunctionSource(source, fnName) {
  const signatureRe = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\(`);
  const match = signatureRe.exec(source);
  assert.ok(match, `Could not find function ${fnName}`);
  const startIdx = match.index;
  const openBraceIdx = source.indexOf('{', startIdx);
  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error(`Unclosed function body for ${fnName}`);
}

/**
 * Loads pure helper functions from appwebsite.js inside an isolated VM context
 * with controllable cart / appliedCoupon state and optional DOM element mocks.
 */
function loadAppLogic(initialState = {}) {
  const fnNames = [
    'escapeHTML',
    'getSafeUrl',
    'getFriendlyAuthError',
    'getCartSubtotal',
    'getDiscountAmount',
    'getCartTotal',
    'isCouponExpired',
    'getStatusLabel',
    'getProgressPercentage',
    'renderMyCoupons',
    'fromFirestoreRestValue',
    'parseFirestoreRestDoc',
    'getOrderTimestampMs',
  ];
  const snippets = fnNames.map((n) => extractFunctionSource(appJs, n)).join('\n\n');
  const elements = initialState.elements || {};
  const context = {
    cart: initialState.cart || [],
    appliedCoupon: initialState.appliedCoupon ?? null,
    $: (id) => elements[id] || null,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
  };
  vm.createContext(context);
  vm.runInContext(snippets, context);
  return context;
}

function loadAdminHelpers() {
  const fnNames = ['formatDate', 'parseLocalEndOfDay', 'isValidBannerLink', 'escapeHTML'];
  const snippets = fnNames.map((n) => extractFunctionSource(adminJs, n)).join('\n\n');
  const context = { Date, Number, String };
  vm.createContext(context);
  vm.runInContext(snippets, context);
  return context;
}

/**
 * Verifies exact case-sensitive file existence on disk (even on Windows).
 */
function existsCaseSensitive(rootDir, relPosixPath) {
  const segments = relPosixPath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length === 0) {
    return fs.existsSync(path.join(rootDir, 'index.html'));
  }
  let current = rootDir;
  for (const seg of segments) {
    if (!fs.existsSync(current)) return false;
    const entries = fs.readdirSync(current);
    if (!entries.includes(seg)) return false;
    current = path.join(current, seg);
  }
  return fs.statSync(current).isFile();
}

// =====================================================================
// 1. Unit & Core Calculation Tests
// =====================================================================

test('US-2 | TC-006: Cart subtotal, percentage discount rounding, and total calculate accurately', () => {
  const ctx = loadAppLogic({
    cart: [
      { id: '1', name: 'Zinger Burger', price: 455, qty: 2 },
      { id: '2', name: 'Mint Margarita', price: 180, qty: 1 },
    ],
    appliedCoupon: { code: 'SAVE15', discountPercent: 15 },
  });

  assert.equal(ctx.getCartSubtotal(), 1090);
  assert.equal(ctx.getDiscountAmount(), 164);
  assert.equal(ctx.getCartTotal(), 926);
});

test('US-2 | TC-007: Cart total equals subtotal when no coupon is applied and handles empty cart', () => {
  const emptyCtx = loadAppLogic({ cart: [], appliedCoupon: null });
  assert.equal(emptyCtx.getCartSubtotal(), 0);
  assert.equal(emptyCtx.getDiscountAmount(), 0);
  assert.equal(emptyCtx.getCartTotal(), 0);

  const fullDiscountCtx = loadAppLogic({
    cart: [{ id: '1', name: 'Sajji', price: 1200, qty: 1 }],
    appliedCoupon: { code: 'FREE100', discountPercent: 100 },
  });
  assert.equal(fullDiscountCtx.getCartTotal(), 0);
});

test('US-4 | TC-014: isCouponExpired handles null, Firestore-like .toDate(), past and future ISO dates', () => {
  const ctx = loadAppLogic();
  assert.equal(ctx.isCouponExpired({}), false);
  assert.equal(
    ctx.isCouponExpired({
      expiresAt: { toDate: () => new Date(Date.now() - 60_000) },
    }),
    true
  );
  assert.equal(
    ctx.isCouponExpired({
      expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
    }),
    false
  );
});

test('US-5 | TC-019: getProgressPercentage computes accurate delivery and takeaway step percentages', () => {
  const ctx = loadAppLogic();
  assert.equal(ctx.getProgressPercentage('PENDING', 'DELIVERY'), 20);
  assert.equal(ctx.getProgressPercentage('PREPARING', 'DELIVERY'), 60);
  assert.equal(ctx.getProgressPercentage('OUT_FOR_DELIVERY', 'DELIVERY'), 80);
  assert.equal(ctx.getProgressPercentage('COMPLETED', 'DELIVERY'), 100);

  assert.equal(ctx.getProgressPercentage('PENDING', 'TAKEAWAY'), 25);
  assert.equal(ctx.getProgressPercentage('COMPLETED', 'TAKEAWAY'), 100);
  assert.equal(ctx.getProgressPercentage('UNKNOWN_STATUS', 'DELIVERY'), 0);
});

test('US-9 | TC-026: adminwebsite.js formatDate handles null, invalid strings, and Firestore timestamps', () => {
  const { formatDate } = loadAdminHelpers();
  assert.equal(formatDate(null), 'Date unavailable');
  assert.equal(formatDate('not-a-date'), 'Date unavailable');
  const sample = new Date('2026-11-25T10:00:00Z');
  assert.equal(formatDate({ toDate: () => sample }), sample.toLocaleString());
});

test('US-7 | TC-021: escapeHTML encodes &, <, >, ", and single quotes', () => {
  const ctx = loadAppLogic();
  assert.equal(
    ctx.escapeHTML(`<img src="x" onerror='alert(1)'> &`),
    '&lt;img src=&quot;x&quot; onerror=&#039;alert(1)&#039;&gt; &amp;'
  );
});

test('US-1 | TC-001: index.html includes local styles.css and module script appwebsite.js', () => {
  assert.equal(/<link\s+rel="stylesheet"\s+href="styles\.css">/.test(indexHtml), true);
  assert.equal(/<script[\s\S]*?src="appwebsite\.js"[\s\S]*?>/.test(indexHtml), true);
  assert.equal(/cdn\.tailwindcss\.com/.test(indexHtml), false);
});

// =====================================================================
// 2. CSS & Build Integrity (US-8)
// =====================================================================

test('US-8 | TC-027 [BUG-007]: Committed styles.css matches fresh Tailwind CSS build for all HTML & JS files', () => {
  const tmpOut = path.join(os.tmpdir(), `hb-qa-tailwind-${Date.now()}.css`);
  try {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execFileSync(npxCmd, ['tailwindcss', '-i', './src/tailwind.css', '-o', tmpOut, '--minify'], {
      cwd: ROOT,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    const rebuiltCss = fs.readFileSync(tmpOut, 'utf8');
    const requiredSelectors = [
      '.pt-20{',
      '.bottom-3{',
      '.ring-white',
      '.flex-none{',
      '.via-amber-500',
      '.to-orange-600',
      '.min-h-\\[160px\\]',
      '.md\\:opacity-0',
      '.group-hover\\:opacity-100',
    ];
    const missingFromCommitted = requiredSelectors.filter(
      (sel) => rebuiltCss.includes(sel) && !committedCss.includes(sel)
    );
    assert.deepEqual(missingFromCommitted, []);
    assert.equal(committedCss.length, rebuiltCss.length);
  } finally {
    fs.rmSync(tmpOut, { force: true });
  }
});

test('US-8 | TC-028 [BUG-017 / BUG-021]: index.html contains no malformed Tailwind classes', () => {
  assert.equal(/rounde\s+d-\[1\.5rem\]/.test(indexHtml), false);
  assert.equal(/\bbackdrop-blur-xs\b/.test(indexHtml), false);
  assert.equal(indexHtml.includes('rounded-[1.5rem]'), true);
});

test('US-8 | TC-029 [BUG-021 / AUD-008]: admin.html and google-maps-embed.html use local styles.css without Tailwind Play CDN', () => {
  assert.equal(/cdn\.tailwindcss\.com/.test(adminHtml), false);
  assert.equal(/cdn\.tailwindcss\.com/.test(mapHtml), false);
  assert.equal(adminHtml.includes('href="styles.css"'), true);
  assert.equal(mapHtml.includes('href="styles.css"'), true);
});

// =====================================================================
// 3. Service Worker Case Sensitivity & Offline Assets (US-8)
// =====================================================================

test('US-8 | TC-030 [BUG-008]: Every local asset in sw.js ASSETS and offline fallback exists with exact filename casing', () => {
  const assetsMatch = swJs.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(assetsMatch, 'ASSETS array not found in sw.js');
  const entries = [...assetsMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const fallbackMatch = swJs.match(/caches\.match\(\s*['"]([^'"]+)['"]\s*\)/);
  if (fallbackMatch) entries.push(fallbackMatch[1]);

  const missingLocalAssets = entries
    .filter((entry) => !/^https?:\/\//i.test(entry))
    .filter((entry) => !existsCaseSensitive(ROOT, entry));

  assert.deepEqual(missingLocalAssets, []);
});

// =====================================================================
// 4. Firestore & Storage Security Rules Contracts (US-7)
// =====================================================================

test('US-7 | TC-022 [BUG-001 / AUD-001]: isStaff() requires active explicit POS role/flag and /users/{userId} blocks self-escalation', () => {
  assert.equal(
    /function\s+isStaff\(\)\s*\{[\s\S]*?staffProfile\(\)\.get\('role',\s*null\)\s*in\s*\['OWNER',\s*'MANAGER',\s*'CASHIER',\s*'WAITER'\]/.test(
      rulesText
    ),
    true,
    'isStaff() must verify active explicit POS role or isStaff flag'
  );
  assert.equal(
    /match\s+\/users\/\{userId\}[\s\S]*?!request\.resource\.data\.keys\(\)\.hasAny\(\['role',\s*'isStaff',\s*'active',\s*'permissions'\]\)/.test(
      rulesText
    ),
    true,
    '/users/{userId} create must reject role/isStaff/active/permissions'
  );
  assert.equal(
    /match\s+\/users\/\{userId\}[\s\S]*?!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['role',\s*'isStaff',\s*'active',\s*'permissions'\]\)/.test(
      rulesText
    ),
    true,
    '/users/{userId} update must reject role/isStaff/active/permissions'
  );
});

test('US-7 | TC-023 [BUG-002 / AUD-002]: onlineOrders read rule removes || true and locks reads to owner or staff', () => {
  const onlineOrdersBlock = rulesText.match(/match\s+\/onlineOrders\/\{orderId\}[\s\S]*?\n\s{8}\}/)?.[0] || '';
  assert.equal(/\|\|\s*true\b/.test(onlineOrdersBlock), false);
  assert.equal(
    /allow\s+get,\s*list:\s*if\s+isSignedIn\(\)\s*&&\s*\(resource\.data\.customerUid\s*==\s*request\.auth\.uid\s*\|\|\s*isStaff\(\)\)/.test(
      onlineOrdersBlock
    ),
    true
  );
});

test('US-7 | TC-024 [BUG-003 / AUD-003]: coupons rules block client minting and enforce one-way redemption', () => {
  const couponsBlock = rulesText.match(/match\s+\/coupons\/\{couponId\}[\s\S]*?\n\s{8}\}/)?.[0] || '';
  assert.equal(/allow\s+create:\s*if\s+isAdmin\(\);/.test(couponsBlock), true);
  assert.equal(/request\.resource\.data\.type\s*==\s*"loyalty"/.test(couponsBlock), false);
  assert.equal(/request\.resource\.data\.active\s*==\s*false\s*&&\s*request\.resource\.data\.used\s*==\s*true/.test(couponsBlock), true);
});

test('US-7 | TC-025 [BUG-004 & BUG-005]: firestore.rules defines banners rules and matches ADMIN_EMAILS in adminwebsite.js', () => {
  assert.equal(/match\s+\/banners\/\{bannerId\}[\s\S]*?allow\s+read:\s*if\s+true;[\s\S]*?allow\s+write:\s*if\s+isAdmin\(\);/.test(rulesText), true);

  const jsAdminList = [...(adminJs.match(/ADMIN_EMAILS\s*=\s*\[([\s\S]*?)\]/)?.[1].matchAll(/"([^"]+)"/g) || [])].map(
    (m) => m[1]
  );
  const rulesAdminList = [...(rulesText.match(/function\s+isAdmin\(\)[\s\S]*?\{([\s\S]*?)\n\s{8}\}/)?.[1].matchAll(/"([^"]+@[^"]+)"/g) || [])].map(
    (m) => m[1]
  );
  assert.deepEqual(rulesAdminList.sort(), jsAdminList.sort());
});

test('US-7 | TC-033 [AUD-004]: usernameDirectory blocks collection listing to prevent staff enumeration', () => {
  const dirBlock = rulesText.match(/match\s+\/usernameDirectory\/\{usernameLower\}[\s\S]*?\n\s{8}\}/)?.[0] || '';
  assert.equal(/allow\s+get:\s*if\s+true;/.test(dirBlock), true);
  assert.equal(/allow\s+list:\s*if\s+false;/.test(dirBlock), true);
  assert.equal(/allow\s+read:\s*if\s+true;/.test(dirBlock), false);
});

test('US-7 | TC-034 [AUD-002 / AUD-003]: onlineOrders validates PENDING, delivery minimum, and math; orderTracking is non-PII get-only', () => {
  const onlineOrdersBlock = rulesText.match(/match\s+\/onlineOrders\/\{orderId\}[\s\S]*?\n\s{8}\}/)?.[0] || '';
  assert.equal(onlineOrdersBlock.includes("request.resource.data.status == 'PENDING'"), true);
  assert.equal(onlineOrdersBlock.includes("request.resource.data.subtotal >= 500"), true);
  assert.equal(onlineOrdersBlock.includes("request.resource.data.total == request.resource.data.subtotal - request.resource.data.discountAmount"), true);

  const trackingBlock = rulesText.match(/match\s+\/orderTracking\/\{orderId\}[\s\S]*?\n\s{8}\}/)?.[0] || '';
  assert.equal(/allow\s+get:\s*if\s+true;/.test(trackingBlock), true);
  assert.equal(/allow\s+list:\s*if\s+false;/.test(trackingBlock), true);
  assert.equal(trackingBlock.includes("['orderId', 'status', 'orderType', 'total', 'createdAt']"), true);
});

// =====================================================================
// 5. XSS & Event Handler Safety (US-7 / US-4 / US-9)
// =====================================================================

test('US-4 | TC-015 [BUG-010]: Inline onclick calls removed and window.showToast exported', () => {
  for (const src of [indexHtml, appJs]) {
    assert.equal(/\bonclick="/.test(src), false, 'Found legacy inline onclick="..." attribute');
  }
  assert.equal(/window\.showToast\s*=\s*showToast/.test(appJs), true);
});

test('US-9 | TC-031 [BUG-006 / AUD-005]: adminwebsite.js escapes all Firestore-sourced fields in loadCoupons & loadBanners', () => {
  const loadCouponsFn = extractFunctionSource(adminJs, 'loadCoupons');
  assert.equal(loadCouponsFn.includes('escapeHTML(docSnap.id)'), true);
  assert.equal(loadCouponsFn.includes('escapeHTML(data.code || docSnap.id)'), true);
  assert.equal(loadCouponsFn.includes('escapeHTML(data.type || "promo")'), true);

  const loadBannersFn = extractFunctionSource(adminJs, 'loadBanners');
  assert.equal(loadBannersFn.includes('escapeHTML(docSnap.id)'), true);
  assert.equal(loadBannersFn.includes('escapeHTML(data.title || "Banner")'), true);
  assert.equal(loadBannersFn.includes('escapeHTML(data.type || "promo")'), true);
});

test('US-7 | TC-021b [BUG-006]: appwebsite.js uses data-* event delegation instead of inline onclick ID interpolation', () => {
  assert.equal(/onclick="(?:addToCart|changeCartQty|removeFromCart|repeatOrder|navigator\.clipboard\.writeText)\('\$\{/.test(appJs), false);
  assert.equal(appJs.includes('event.target.closest("[data-action]")'), true);
});

// =====================================================================
// 6. Client-Side Functional, Security & Accessibility Invariants
// =====================================================================

test('US-2 / US-3 | TC-009 [BUG-013]: initMenu, repeatOrder, and placeOrder synchronize cart badge, localStorage, and card controls', () => {
  const initMenuFn = extractFunctionSource(appJs, 'initMenu');
  assert.equal(initMenuFn.includes('updateCartCount('), true);

  const repeatOrderFn = extractFunctionSource(appJs, 'repeatOrder');
  assert.equal(repeatOrderFn.includes('saveCart('), true);
  assert.equal(repeatOrderFn.includes('renderCardControls('), true);
  assert.equal(repeatOrderFn.includes('closePastOrdersModal('), true);

  const placeOrderFn = extractFunctionSource(appJs, 'placeOrder');
  assert.equal(placeOrderFn.includes('renderCardControls('), true);
  assert.equal(placeOrderFn.includes('currentOrderType === "DELIVERY"'), true);
});

test('US-4 | TC-016 [BUG-011]: #myCouponsBtn has a single click binding', () => {
  const directBindings = appJs.match(/\$\("myCouponsBtn"\)\?\.addEventListener\(\s*"click"\s*,\s*loadMyCoupons\s*\)/g) || [];
  const delegatedBindings = appJs.match(/closest\(\s*"#myCouponsBtn"\s*\)\)\s*loadMyCoupons\(\)/g) || [];
  assert.equal(directBindings.length, 1);
  assert.equal(delegatedBindings.length, 0);
});

test('US-5 | TC-018 [BUG-012]: trackOrderModal supports Escape/backdrop/Enter and pastOrdersModal unsubscribes listener on all closes', () => {
  assert.equal(/\$\("trackOrderModal"\)\s*\]\.forEach/.test(appJs), true);
  const escIdx = appJs.indexOf('// ===== Escape closes modal =====');
  const escSection = appJs.slice(escIdx, escIdx + 1200);
  assert.equal(escSection.includes('closeTrackOrderModal()'), true);
  assert.equal(escSection.includes('closePastOrdersModal()'), true);
  assert.equal(/\$\("orderIdInput"\)\?\.addEventListener\(\s*"keydown"/.test(appJs), true);
});

test('US-1 | TC-004 [BUG-009 / AUD-009]: Banner slides render safe clickable links and avoid defunct via.placeholder.com', () => {
  const renderBannerFn = extractFunctionSource(appJs, 'renderBannerCarousel');
  assert.equal(renderBannerFn.includes('via.placeholder.com'), false);
  assert.equal(renderBannerFn.includes('getSafeUrl('), true);
  assert.equal(renderBannerFn.includes('<a href='), true);

  const { getSafeUrl } = loadAppLogic();
  assert.equal(getSafeUrl('https://hungrybirds.pk/promo'), 'https://hungrybirds.pk/promo');
  assert.equal(getSafeUrl('/menu'), '/menu');
  assert.equal(getSafeUrl('javascript:alert(1)'), '');
  assert.equal(getSafeUrl('data:text/html,<script>alert(1)</script>'), '');
});

test('US-6 | TC-020 [BUG-015 & BUG-016 / AUD-017]: Modals start hidden with dialog ARIA and sit above mobile CTA bar', () => {
  for (const modalId of ['authModal', 'cartModal', 'pastOrdersModal', 'myCouponsModal', 'trackOrderModal']) {
    const tag = indexHtml.match(new RegExp(`<div\\s+id="${modalId}"[\\s\\S]*?>`))?.[0] || '';
    const classes = (tag.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/);
    assert.equal(classes.includes('hidden'), true, `#${modalId} missing hidden`);
    assert.equal(tag.includes('role="dialog"'), true, `#${modalId} missing role="dialog"`);
    assert.equal(tag.includes('aria-modal="true"'), true, `#${modalId} missing aria-modal="true"`);
  }

  const modalZ = Number(indexHtml.match(/id="cartModal"[\s\S]{0,200}z-\[(\d+)\]/)?.[1] || 0);
  const mobileBarClass = indexHtml.match(/class="fixed bottom-20 right-3 z-([^"]+)"/)?.[1] || '';
  const mobileBarZ = mobileBarClass.startsWith('[')
    ? Number(mobileBarClass.replace(/\D/g, ''))
    : Number(mobileBarClass.split(/\s+/)[0]);
  assert.equal(mobileBarZ < modalZ, true, `Mobile CTA z-${mobileBarZ} must be below modal z-[${modalZ}]`);

  assert.equal(/<iframe[\s\S]*?title="[^"]+"/.test(indexHtml), true);
  assert.equal(/<iframe[\s\S]*?title="[^"]+"/.test(mapHtml), true);
});

test('US-5 | TC-019b [BUG-018]: getStatusLabel("COMPLETED") distinguishes Takeaway from Delivery', () => {
  const ctx = loadAppLogic();
  assert.equal(ctx.getStatusLabel('COMPLETED', 'DELIVERY'), 'Delivered');
  assert.equal(ctx.getStatusLabel('COMPLETED', 'TAKEAWAY'), 'Ready for Pickup');
});

test('US-4 | TC-017 [BUG-020]: renderMyCoupons shows 10 / 10 orders and "Coupon earned!" at multiples of 10', () => {
  const mockContent = { innerHTML: '' };
  const ctx = loadAppLogic({ elements: { myCouponsContent: mockContent } });
  ctx.renderMyCoupons(10, [], []);
  assert.equal(mockContent.innerHTML.includes('10 / 10 orders'), true);
  assert.equal(mockContent.innerHTML.includes('Coupon earned!'), true);
  assert.equal(mockContent.innerHTML.includes('10 more to go'), false);

  ctx.renderMyCoupons(3, [], []);
  assert.equal(mockContent.innerHTML.includes('3 / 10 orders'), true);
  assert.equal(mockContent.innerHTML.includes('7 more to go'), true);
});

test('US-9 | TC-032 [BUG-019]: Admin coupon expiry parses YYYY-MM-DD as local end-of-day (23:59:59.999)', () => {
  assert.equal(/expiresAt:\s*parseLocalEndOfDay\(expiryRaw\)/.test(adminJs), true);
  const { parseLocalEndOfDay } = loadAdminHelpers();
  const d = parseLocalEndOfDay('2026-11-25');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10);
  assert.equal(d.getDate(), 25);
  assert.equal(d.getHours(), 23);
  assert.equal(d.getMinutes(), 59);
  assert.equal(d.getSeconds(), 59);
});

// =====================================================================
// 7. Additional Audit Hardening Verification Tests
// =====================================================================

test('US-8 | TC-035 [AUD-006 / AUD-016 / AUD-018]: Required config/rules/function files exist, output.css removed, node_modules untracked', () => {
  for (const f of ['storage.rules', 'firestore.indexes.json', 'firebase.json', 'functions/index.js', '.gitignore', '.env.example', 'firebase-config.js']) {
    assert.equal(fs.existsSync(path.join(ROOT, f)), true, `Missing ${f}`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'output.css')), false, 'Dead output.css still exists');
  const trackedNodeModules = execFileSync('git', ['-C', ROOT, 'ls-files', 'node_modules'], { encoding: 'utf8' }).trim();
  assert.equal(trackedNodeModules, '', 'node_modules should not be tracked in git');
});

test('US-7 | TC-036 [AUD-008]: vercel.json sets HTTP security headers and CDN stylesheets carry SRI', () => {
  const headerRules = vercelJson.headers?.[0]?.headers || [];
  const headerNames = new Set(headerRules.map((h) => h.key));
  for (const required of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.equal(headerNames.has(required), true, `Missing header ${required} in vercel.json`);
  }
  for (const html of [indexHtml, adminHtml]) {
    assert.equal(/font-awesome[\s\S]{0,200}integrity="sha384-/.test(html), true, 'Font Awesome link missing SRI integrity');
    assert.equal(/font-awesome[\s\S]{0,200}crossorigin="anonymous"/.test(html), true, 'Font Awesome link missing crossorigin');
  }
});

test('US-9 | TC-037 [AUD-009]: Banner uploads enforce size/count/type limits, safe link scheme, and Storage cleanup on delete', () => {
  assert.equal(adminJs.includes('MAX_BANNER_FILES = 5'), true);
  assert.equal(adminJs.includes('MAX_BANNER_BYTES = 5 * 1024 * 1024'), true);
  assert.equal(adminJs.includes('deleteObject(ref(storage, url))'), true);
  assert.equal(storageRulesText.includes('request.resource.size < 5 * 1024 * 1024'), true);

  const { isValidBannerLink } = loadAdminHelpers();
  assert.equal(isValidBannerLink(''), true);
  assert.equal(isValidBannerLink('https://hungrybirds.pk'), true);
  assert.equal(isValidBannerLink('/menu'), true);
  assert.equal(isValidBannerLink('javascript:alert(1)'), false);
});

test('US-7 | TC-038 [AUD-011 / BUG-014]: Sign-out clears caches, coupons, tables, and live Firestore listeners', () => {
  assert.equal(/else\s*\{[\s\S]*?removeCoupon\(\);[\s\S]*?pastOrdersListener\(\);[\s\S]*?activeOrderListener\(\);/.test(appJs), true);
  assert.equal(/if\s*\(!user\)\s*\{[\s\S]*?cleanupNewOrderListener\(\);[\s\S]*?clearAdminTables\(\);/.test(adminJs), true);
});

test('US-3 / US-8 | TC-039 [AUD-014 / AUD-015 / AUD-022]: JS modules parse cleanly, Cloud Functions secure loyalty & tracking, and Takeaway drops address', () => {
  execFileSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      '-e',
      "import('node:vm').then(async({SourceTextModule,Script})=>{const fs=await import('node:fs');for(const f of ['firebase-config.js','appwebsite.js','adminwebsite.js','ai-assistant.js']){new SourceTextModule(fs.readFileSync(f,'utf8'));}for(const s of ['sw-register.js','sw.js','api/chat.js','api/_lib/gemini-assistant.js']){new Script(fs.readFileSync(s,'utf8'));}})",
    ],
    { cwd: ROOT, stdio: 'pipe' }
  );

  assert.equal(functionsJs.includes('crypto.randomBytes'), true);
  assert.equal(functionsJs.includes('exports.onOrderCreated'), true);
  assert.equal(functionsJs.includes('exports.onOrderUpdated'), true);
  assert.equal(functionsJs.includes('exports.createVerifiedOrder'), true);
  assert.equal(appJs.includes('Attempting to create order with data'), false);

  const { getFriendlyAuthError } = loadAppLogic();
  assert.equal(getFriendlyAuthError({ code: 'auth/wrong-password' }), 'Invalid email or password.');
  assert.equal(getFriendlyAuthError({ message: 'Firebase: internal secret stack' }), 'Authentication failed. Please try again.');
});

test('US-7 | TC-040: firestore.rules preserves all 16 POS collections, uppercase RBAC roles, and setting_ownerPinHash guard', () => {
  for (const helper of ['isStaffActive()', 'isManagerOrOwner()', 'isCashierOrAbove()']) {
    assert.equal(rulesText.includes(helper), true, `Missing POS helper ${helper}`);
  }
  for (const role of ['OWNER', 'MANAGER', 'CASHIER', 'WAITER']) {
    assert.equal(rulesText.includes(`'${role}'`), true, `Missing POS role ${role}`);
  }
  const posCollections = [
    'suppliers',
    'stockIn',
    'supplierPayments',
    'supplierLedger',
    'expenses',
    'deliveries',
    'staff',
    'attendance',
    'leaves',
    'salaryPayments',
    'advancePayments',
    'auditLogs',
    'heldOrders',
    'tableOrders',
    'recipes',
    'customers',
  ];
  for (const col of posCollections) {
    assert.equal(new RegExp(`match\\s+\\/${col}\\/\\{`).test(rulesText), true, `Missing POS collection rule /${col}`);
  }
  assert.equal(rulesText.includes("orderId == 'setting_ownerPinHash' ? isAdmin() : isStaff()"), true);
});

test('US-8 | TC-041: sw-register.js heals legacy pre-v7 caches before module boot, sw.js v7 skips cross-origin & /api/ requests, and vercel.json uses literal no-cache routes', () => {
  const swRegisterJs = readRepoFile('sw-register.js');
  assert.equal(swRegisterJs.includes('hungrybirds-cache-v7'), true);
  assert.equal(swRegisterJs.includes('caches.delete'), true);
  assert.equal(swRegisterJs.includes('reg.unregister()'), true);
  assert.equal(swRegisterJs.includes('updateViaCache: "none"'), true);

  const swRegIdx = indexHtml.indexOf('src="sw-register.js"');
  const appModIdx = indexHtml.indexOf('src="appwebsite.js"');
  assert.equal(swRegIdx !== -1 && swRegIdx < appModIdx, true, 'sw-register.js must load before appwebsite.js in index.html');

  assert.equal(swJs.includes("CACHE_NAME = 'hungrybirds-cache-v7'"), true);
  assert.equal(swJs.includes('url.origin !== self.location.origin'), true);
  assert.equal(swJs.includes("url.pathname.startsWith('/api/')"), true);
  assert.equal(swJs.includes("cache: 'no-cache'"), true);

  const headerSources = (vercelJson.headers || []).map((h) => h.source);
  assert.equal(headerSources.some((s) => s.includes('(sw|sw-register)')), false, 'vercel.json should use literal SW route paths rather than regex alternation');
  for (const literalPath of ['/api/chat', '/ai-assistant.js', '/sw.js', '/sw-register.js', '/appwebsite.js', '/adminwebsite.js', '/index.html', '/']) {
    const rule = (vercelJson.headers || []).find((h) => h.source === literalPath);
    assert.ok(rule, `Missing explicit Cache-Control header rule for ${literalPath} in vercel.json`);
    assert.equal(
      rule.headers.some((h) => h.key === 'Cache-Control' && /no-cache|no-store/.test(h.value)),
      true,
      `Missing no-cache/no-store Cache-Control value on ${literalPath}`
    );
  }
});

test('US-1 / US-8 | TC-042: Firestore uses auto-detected long-polling + IndexedDB cache and falls back to HTTPS REST on cold-cache WatchStream timeouts', () => {
  assert.equal(appJs.includes('experimentalAutoDetectLongPolling: true'), true);
  assert.equal(appJs.includes('persistentLocalCache'), true);
  assert.equal(adminJs.includes('experimentalAutoDetectLongPolling: true'), true);
  assert.equal(appJs.includes('menuSnapshot.empty && Boolean(menuSnapshot.metadata && menuSnapshot.metadata.fromCache)'), true);
  assert.equal(appJs.includes('fetchCollectionViaRest("menu"'), true);

  const { parseFirestoreRestDoc } = loadAppLogic();
  const parsed = parseFirestoreRestDoc({
    name: 'projects/hungry-birds-3e16f/databases/(default)/documents/menu/item_zinger',
    fields: {
      name: { stringValue: 'Zinger Burger' },
      price: { integerValue: '450' },
      rating: { doubleValue: 4.8 },
      active: { booleanValue: true },
      notes: { nullValue: null },
      tags: { arrayValue: { values: [{ stringValue: 'spicy' }, { stringValue: 'popular' }] } },
      meta: { mapValue: { fields: { kcal: { integerValue: '620' } } } },
      recipeRef: { referenceValue: 'projects/hungry-birds-3e16f/databases/(default)/documents/recipes/rec_42' },
    },
  });

  assert.equal(parsed.id, 'item_zinger');
  assert.equal(parsed.data.name, 'Zinger Burger');
  assert.equal(parsed.data.price, 450);
  assert.equal(parsed.data.rating, 4.8);
  assert.equal(parsed.data.active, true);
  assert.equal(parsed.data.notes, null);
  assert.deepEqual(Array.from(parsed.data.tags), ['spicy', 'popular']);
  assert.equal(parsed.data.meta.kcal, 620);
  assert.equal(parsed.data.recipeRef.id, 'rec_42');
});

test('US-5 | TC-043: Customer website Firestore queries avoid undeployed composite indexes and sort order timestamps synchronously client-side', () => {
  assert.equal(appJs.includes('orderBy('), false, 'appwebsite.js should sort customer query results client-side without orderBy()');
  assert.equal(/async\s+function\s+getOrderTimestampMs/.test(appJs), false, 'getOrderTimestampMs must be synchronous so numeric subtraction in Array.sort works');
  const customerUidFilterMatches = appJs.match(/collection\(db,\s*["']onlineOrders["']\),\s*where\(["']customerUid["'],\s*["']==["'],\s*(?:currentUser\.)?uid\)/g) || [];
  assert.equal(customerUidFilterMatches.length, 3, 'Expected all 3 customer onlineOrders queries (past orders, auto-track, coupons) to filter by customerUid without orderBy/limit');

  const { getOrderTimestampMs } = loadAppLogic();
  assert.equal(typeof getOrderTimestampMs({ seconds: 1700000000 }), 'number');
  assert.equal(getOrderTimestampMs({ toMillis: () => 1700000000000 }), 1700000000000);
  assert.equal(getOrderTimestampMs({ seconds: 1700000000 }), 1700000000000);
  assert.equal(getOrderTimestampMs('2026-11-25T10:00:00.000Z'), Date.parse('2026-11-25T10:00:00.000Z'));
  assert.equal(getOrderTimestampMs(null), 0);
  assert.equal(getOrderTimestampMs('not-a-date'), 0);
});

// =====================================================================
// 8. Gemini AI Customer Assistant Tests (US-AI-1 .. US-AI-7)
// =====================================================================

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    writeHead(code, hdrs = {}) {
      this.statusCode = code;
      Object.assign(this.headers, hdrs);
    },
    end(str) {
      this.body = str ? JSON.parse(str) : null;
    },
  };
  return res;
}

test('US-AI-5 / US-AI-7 | TC-044: /api/chat validates method, origin, payload size/schema, strips PII/images, and returns 503 fallback when key missing', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createChatHandler } = require('../api/chat.js');
  const { validateAndSanitizeInput } = require('../api/_lib/gemini-assistant.js');

  const envExample = readRepoFile('.env.example');
  assert.equal(envExample.includes('GEMINI_API_KEY='), true);
  assert.equal(envExample.includes('GEMINI_MODEL='), true);
  const apiChatHeader = (vercelJson.headers || []).find((h) => h.source === '/api/chat');
  assert.equal(apiChatHeader?.headers?.some((h) => h.key === 'Cache-Control' && h.value === 'no-store'), true);

  // Method check (405)
  const handlerNoKey = createChatHandler({ env: {} });
  const getRes = createMockRes();
  await handlerNoKey({ method: 'GET', headers: { host: 'hungrybirds.pk' } }, getRes);
  assert.equal(getRes.statusCode, 405);
  assert.equal(getRes.headers['Cache-Control'], 'no-store');

  // Cross-origin check (403)
  const corsRes = createMockRes();
  await handlerNoKey(
    {
      method: 'POST',
      headers: { host: 'hungrybirds.pk', origin: 'https://evil.example' },
      body: { message: 'hello', menu: [{ id: '1', name: 'Zinger', price: 450 }] },
    },
    corsRes
  );
  assert.equal(corsRes.statusCode, 403);

  // Invalid body check (400)
  const badRes = createMockRes();
  await handlerNoKey(
    {
      method: 'POST',
      headers: { host: 'hungrybirds.pk', origin: 'https://hungrybirds.pk' },
      body: { message: '   ', menu: [] },
    },
    badRes
  );
  assert.equal(badRes.statusCode, 400);
  assert.equal(badRes.body.fallback, false);

  // Missing API key -> 503 with fallback: true
  const noKeyRes = createMockRes();
  await handlerNoKey(
    {
      method: 'POST',
      headers: { host: 'hungrybirds.pk', origin: 'https://hungrybirds.pk' },
      body: {
        message: 'Meal under 1000',
        menu: [{ id: 'item_1', name: 'Zinger', price: 450, category: 'Burgers', img: 'data:image/jpeg;base64,ABC' }],
      },
    },
    noKeyRes
  );
  assert.equal(noKeyRes.statusCode, 503);
  assert.equal(noKeyRes.body.error, 'AI_NOT_CONFIGURED');
  assert.equal(noKeyRes.body.fallback, true);

  // PII and base64 image stripping
  const sanitized = validateAndSanitizeInput({
    message: 'Suggest food',
    email: 'secret@example.com',
    phone: '03001234567',
    address: 'House 5',
    customerUid: 'uid_secret',
    orderId: 'ord_99',
    menu: [
      { id: 'm1', name: 'Zinger', price: 450, category: 'Fast Food', img: 'data:image/jpeg;base64,SECRET' },
      { id: 'm2', name: 'data:image/png;base64,XYZ', price: 100, category: 'Bad' },
    ],
    cart: { items: [{ id: 'm1', name: 'Zinger', price: 450, qty: 1 }], subtotal: 450, phone: '03001234567' },
    orderType: 'DELIVERY',
  });
  assert.equal(sanitized.ok, true);
  const serialized = JSON.stringify(sanitized.value);
  for (const forbidden of ['secret@example.com', '03001234567', 'House 5', 'uid_secret', 'ord_99', 'data:image']) {
    assert.equal(serialized.includes(forbidden), false, `Sanitized payload leaked ${forbidden}`);
  }
  assert.equal(sanitized.value.menu.length, 1);
});

test('US-AI-5 / US-AI-6 | TC-045: /api/chat calls Gemini with x-goog-api-key header, filters hallucinated IDs, handles 404 model failover, and enforces rate limits', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createChatHandler } = require('../api/chat.js');
  const { createRateLimiter } = require('../api/_lib/gemini-assistant.js');

  const fetchCalls = [];
  const fakeFetch = async (url, init) => {
    fetchCalls.push({ url, init });
    if (fetchCalls.length === 1) {
      return { ok: false, status: 404, async json() { return {}; } };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      reply: 'Try our Zinger Burger!',
                      recommendedItemIds: ['item_1', 'hallucinated_id', 'item_1'],
                      actions: ['OPEN_CART', 'INVALID_ACTION'],
                    }),
                  },
                ],
              },
            },
          ],
        };
      },
    };
  };

  const limiter = createRateLimiter({ minuteLimit: 2, hourLimit: 10 });
  const handler = createChatHandler({
    fetchImpl: fakeFetch,
    env: { GEMINI_API_KEY: 'test-secret-key', GEMINI_MODEL: 'custom-flash-model' },
    rateLimiter: limiter,
  });

  const okRes = createMockRes();
  await handler(
    {
      method: 'POST',
      headers: { host: 'localhost:4173', origin: 'http://127.0.0.1:4173', 'x-forwarded-for': '203.0.113.10' },
      body: {
        message: 'Best burger?',
        menu: [{ id: 'item_1', name: 'Zinger Burger', price: 450, category: 'Burgers' }],
      },
    },
    okRes
  );

  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.source, 'gemini');
  assert.equal(okRes.body.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(okRes.body.recommendedItemIds, ['item_1']);
  assert.deepEqual(okRes.body.actions, ['OPEN_CART']);
  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].url.includes('custom-flash-model'), true);
  assert.equal(fetchCalls[0].url.includes('test-secret-key'), false, 'API key must NOT appear in URL');
  assert.equal(fetchCalls[0].init.headers['x-goog-api-key'], 'test-secret-key');

  // Second request within minuteLimit=2 succeeds; third is rate limited (429 + fallback: true)
  const okRes2 = createMockRes();
  await handler(
    {
      method: 'POST',
      headers: { host: 'hungrybirds.pk', 'x-forwarded-for': '203.0.113.10' },
      body: { message: 'Second ask', menu: [{ id: 'item_1', name: 'Zinger Burger', price: 450 }] },
    },
    okRes2
  );
  assert.equal(okRes2.statusCode, 200);

  const limitedRes = createMockRes();
  await handler(
    {
      method: 'POST',
      headers: { host: 'hungrybirds.pk', 'x-forwarded-for': '203.0.113.10' },
      body: { message: 'Third ask', menu: [{ id: 'item_1', name: 'Zinger Burger', price: 450 }] },
    },
    limitedRes
  );
  assert.equal(limitedRes.statusCode, 429);
  assert.equal(limitedRes.body.fallback, true);
  assert.ok(Number(limitedRes.headers['Retry-After']) >= 1);
});

function loadAiLogic() {
  const aiSource = readRepoFile('ai-assistant.js').replace(/\bexport\s+(?=(?:async\s+)?function\b|const\b)/g, '');
  const context = { Date, Math, Number, String, Boolean, Array, Object, Map, Set, RegExp, JSON };
  vm.createContext(context);
  vm.runInContext(aiSource, context);
  return context;
}

test('US-AI-2 / US-AI-4 / US-AI-6 | TC-046: Zero-quota local FAQ router answers deterministic FAQs in <100ms without calling /api/chat and escalates unknown policies to WhatsApp', () => {
  const { tryLocalFaqAnswer, escapeAiHtml } = loadAiLogic();

  const track = tryLocalFaqAnswer('Track my order please', { cart: [], orderType: 'DELIVERY' });
  assert.equal(track?.source, 'local');
  assert.deepEqual(Array.from(track?.actions || []), ['TRACK_ORDER']);

  const deliv = tryLocalFaqAnswer('Delivery info?', {
    cart: [{ id: '1', name: 'Fries', price: 300, qty: 1 }],
    orderType: 'DELIVERY',
  });
  assert.equal(deliv?.source, 'local');
  assert.equal(deliv?.reply.includes('500'), true);
  assert.equal(deliv?.reply.includes('200 away'), true);

  const hours = tryLocalFaqAnswer('What are your opening hours and halal allergens?', {});
  assert.equal(hours?.source, 'local');
  assert.deepEqual(Array.from(hours?.actions || []), ['WHATSAPP']);
  assert.equal(hours?.reply.includes('0325-7867774'), true);

  const loyalty = tryLocalFaqAnswer('How does the 10 orders loyalty coupon work?', {});
  assert.equal(loyalty?.source, 'local');
  assert.equal(loyalty?.reply.includes('10%'), true);

  assert.equal(tryLocalFaqAnswer('bhai 1000 mein 2 burgers suggest karo', {}), null);
  assert.equal(tryLocalFaqAnswer('Best burgers?', {}), null);
  assert.equal(escapeAiHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('US-AI-2 / US-AI-6 / US-AI-7 | TC-047: Client AI sanitizer drops all PII/images and local fallback matches real items by budget/keyword in English & Roman Urdu', () => {
  const { buildSanitizedAiPayload, buildLocalMenuFallback } = loadAiLogic();

  const sampleMenu = [
    { id: 'm1', name: 'Zinger Burger', price: 450, categoryId: 'c1', img: 'data:image/jpeg;base64,HUGEBLOB' },
    { id: 'm2', name: 'Chicken Karrahi Half', price: 1100, categoryId: 'c2', img: 'data:image/jpeg;base64,ANOTHER' },
    { id: 'm3', name: 'Pepsi 500ml', price: 150, categoryId: 'c3', img: '' },
  ];
  const sampleCategories = [
    { id: 'c1', name: 'Fast Food' },
    { id: 'c2', name: 'Karrahi' },
    { id: 'c3', name: 'Cold Drinks' },
  ];

  const payload = buildSanitizedAiPayload({
    message: 'Suggest burgers under 1000',
    history: [{ role: 'user', text: 'hi' }],
    menuItems: sampleMenu,
    categories: sampleCategories,
    cart: [{ id: 'm1', name: 'Zinger Burger', price: 450, qty: 1, customerUid: 'secret_uid', phone: '03001112233' }],
    orderType: 'DELIVERY',
  });

  const json = JSON.stringify(payload);
  assert.equal(json.includes('data:image'), false);
  assert.equal(json.includes('secret_uid'), false);
  assert.equal(json.includes('03001112233'), false);
  assert.equal(payload.menu[0].category, 'Fast Food');
  assert.equal(payload.cart.subtotal, 450);

  const budgetReply = buildLocalMenuFallback('1000 mein burger aur drink batao', sampleMenu, sampleCategories, [], 'DELIVERY');
  assert.equal(budgetReply.source, 'fallback');
  assert.equal(budgetReply.recommendedItemIds.includes('m1'), true);
  assert.equal(budgetReply.recommendedItemIds.includes('m2'), false, 'Rs. 1100 item should not exceed Rs. 1000 budget pick');

  const tinyBudget = buildLocalMenuFallback('Meal under Rs 100', sampleMenu, sampleCategories, [], 'DELIVERY');
  assert.deepEqual(Array.from(tinyBudget.recommendedItemIds), ['m3']);
  assert.equal(tinyBudget.reply.includes('150'), true);
});

test('US-AI-1 | TC-048: AI chat launcher sits bottom-left clear of right CTA/cart and drawer meets WCAG dialog ARIA + starter chips', () => {
  const aiJs = readRepoFile('ai-assistant.js');

  const fabTag = indexHtml.match(/<button[\s\S]*?id="aiChatFab"[\s\S]*?>/)?.[0] || '';
  assert.ok(fabTag, 'Missing #aiChatFab in index.html');
  assert.equal(fabTag.includes('bottom-20'), true);
  assert.equal(fabTag.includes('left-3'), true);
  assert.equal(fabTag.includes('md:bottom-6'), true);
  assert.equal(fabTag.includes('md:left-6'), true);
  assert.equal(fabTag.includes('aria-controls="aiChatDrawer"'), true);
  assert.equal(fabTag.includes('aria-haspopup="dialog"'), true);

  const drawerTag = indexHtml.match(/<div\s+id="aiChatDrawer"[\s\S]*?>/)?.[0] || '';
  assert.ok(drawerTag, 'Missing #aiChatDrawer in index.html');
  assert.equal(drawerTag.includes('hidden'), true);
  assert.equal(drawerTag.includes('role="dialog"'), true);
  assert.equal(drawerTag.includes('aria-modal="true"'), true);
  assert.equal(drawerTag.includes('aria-labelledby="aiChatTitle"'), true);
  assert.equal(drawerTag.includes('z-[60]'), true);

  const chipPrompts = [...indexHtml.matchAll(/data-ai-prompt="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(chipPrompts.length, 4, 'Expected 4 starter prompt chips');

  assert.equal(/id="aiChatInput"[\s\S]{0,120}maxlength="500"/.test(indexHtml), true);
  assert.equal(aiJs.includes('onclick='), false, 'ai-assistant.js must use data-* delegation instead of inline onclick');
  assert.equal(aiJs.includes('escapeAiHtml('), true);
});

test('US-AI-3 / US-AI-5 | TC-049: appwebsite.js wires initAiAssistant cleanly with live getters/actions and zero secrets anywhere', () => {
  assert.equal(/import\s*\{\s*initAiAssistant\s*\}\s*from\s*["']\.\/ai-assistant\.js["']/.test(appJs), true);
  assert.equal(/initAiAssistant\s*\(\s*\{[\s\S]*getMenuItems[\s\S]*addToCart[\s\S]*openTrackOrder:\s*openTrackOrderFlow/.test(appJs), true);

  const aiJs = readRepoFile('ai-assistant.js');
  for (const fileText of [appJs, aiJs, indexHtml]) {
    assert.equal(fileText.includes('GEMINI_API_KEY'), false, 'Client code must never reference GEMINI_API_KEY');
    assert.equal(/AIza[0-9A-Za-z\-_]{30,}/.test(fileText), false, 'No API key literal allowed in client/static files except firebase-config');
  }
});
