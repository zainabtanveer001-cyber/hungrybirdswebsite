// ===== Hungry Birds Gemini AI Assistant (Client UI, Zero-Quota FAQs & Fallback) =====

const WHATSAPP_URL = "https://wa.me/923257867774";
const DELIVERY_MINIMUM_RS = 500;
const SEND_COOLDOWN_MS = 3000;
const MAX_HISTORY_SENT = 6;
const MAX_MESSAGE_LEN = 500;

export function escapeAiHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function getCategoryLookup(categories = []) {
    const map = new Map();
    for (const cat of categories || []) {
        if (cat && cat.id) {
            map.set(String(cat.id), String(cat.name || cat.id));
        }
    }
    return map;
}

export function sanitizeAiKnowledge(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const clip = (val, max) => (typeof val === "string" ? val.trim().slice(0, max) : "");
    const openingHours = clip(raw.openingHours, 240);
    const deliveryInfo = clip(raw.deliveryInfo, 400);
    const foodNotes = clip(raw.foodNotes, 500);
    const dealsAndUpsells = clip(raw.dealsAndUpsells, 500);
    const customInstructions = clip(raw.customInstructions, 1000);
    const faqs = Array.isArray(raw.faqs)
        ? raw.faqs
            .slice(0, 15)
            .map((faq) => ({
                question: clip(faq?.question, 160),
                answer: clip(faq?.answer, 350)
            }))
            .filter((faq) => faq.question && faq.answer)
        : [];

    if (!openingHours && !deliveryInfo && !foodNotes && !dealsAndUpsells && !customInstructions && !faqs.length) {
        return null;
    }

    return { openingHours, deliveryInfo, foodNotes, dealsAndUpsells, customInstructions, faqs };
}

export function buildSanitizedAiPayload({
    message,
    history = [],
    menuItems = [],
    categories = [],
    cart = [],
    orderType = "DELIVERY",
    knowledge = null
} = {}) {
    const catLookup = getCategoryLookup(categories);

    const sanitizedMenu = (Array.isArray(menuItems) ? menuItems : [])
        .slice(0, 150)
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const id = String(item.id ?? item.menuItemId ?? "").trim().slice(0, 80);
            const name = String(item.name ?? "").trim().slice(0, 120);
            const price = Number(item.price);
            const catId = String(item.categoryId ?? item.category ?? "Menu");
            const category = String(catLookup.get(catId) || catId).trim().slice(0, 60) || "Menu";
            if (!id || !name || !Number.isFinite(price) || price < 0) return null;
            return { id, name, price, category };
        })
        .filter(Boolean);

    const sanitizedCartItems = (Array.isArray(cart) ? cart : [])
        .slice(0, 50)
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const id = String(item.id ?? item.menuItemId ?? "").trim().slice(0, 80);
            const name = String(item.name ?? "").trim().slice(0, 120);
            const price = Number(item.price);
            const qty = Math.floor(Number(item.qty));
            if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) {
                return null;
            }
            return { id, name, price, qty };
        })
        .filter(Boolean);

    const subtotal = sanitizedCartItems.reduce((sum, item) => sum + item.price * item.qty, 0);

    const sanitizedHistory = (Array.isArray(history) ? history : [])
        .filter((entry) => entry && (entry.role === "user" || entry.role === "model" || entry.role === "assistant"))
        .slice(-MAX_HISTORY_SENT)
        .map((entry) => ({
            role: entry.role === "user" ? "user" : "model",
            text: String(entry.text ?? "").trim().slice(0, MAX_MESSAGE_LEN)
        }))
        .filter((entry) => entry.text.length > 0);

    const cleanKnowledge = sanitizeAiKnowledge(knowledge);
    const payload = {
        message: String(message ?? "").trim().slice(0, MAX_MESSAGE_LEN),
        history: sanitizedHistory,
        menu: sanitizedMenu,
        cart: {
            items: sanitizedCartItems,
            subtotal
        },
        orderType: orderType === "TAKEAWAY" ? "TAKEAWAY" : "DELIVERY"
    };
    if (cleanKnowledge) {
        payload.knowledge = cleanKnowledge;
    }
    return payload;
}

function getCartSubtotalValue(cart = []) {
    return (Array.isArray(cart) ? cart : []).reduce(
        (sum, item) => sum + (Number(item?.price) || 0) * (Number(item?.qty) || 0),
        0
    );
}

function looksLikeFoodRecommendationRequest(text) {
    return /\b(suggest|recommend|meal|menu|budget|under|within|mein|tak|rs\.?|pkr|burger|zinger|karrahi|karahi|sajji|bbq|tikka|drink|pepsi|eat|khana|khao|hungry|best|cheap|sasta|combo|deal|for\s+\d+|logon)\b/i.test(text);
}

function summarizeMenuCategories(categories = [], menuItems = []) {
    const names = [];
    for (const cat of categories || []) {
        const id = String(cat?.id || "");
        const name = String(cat?.name || "").trim();
        if (name && id !== "ALL" && !names.includes(name)) {
            names.push(name);
        }
    }
    if (!names.length && Array.isArray(menuItems)) {
        for (const item of menuItems) {
            const cat = String(item?.categoryId || item?.category || "").trim();
            if (cat && cat !== "uncategorized" && !names.includes(cat)) {
                names.push(cat);
            }
        }
    }
    return names;
}

function findMatchingCustomFaq(lowerMsg, faqs = []) {
    if (!Array.isArray(faqs) || !faqs.length) return null;
    const msgWords = new Set(lowerMsg.split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
    let best = null;
    let bestScore = 0;

    for (const faq of faqs) {
        const qLower = String(faq?.question || "").toLowerCase().trim();
        if (!qLower) continue;
        if (lowerMsg.includes(qLower) || qLower.includes(lowerMsg)) {
            return faq;
        }
        const qWords = qLower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
        const overlap = qWords.filter((w) => msgWords.has(w)).length;
        if (overlap >= 2 && overlap > bestScore) {
            bestScore = overlap;
            best = faq;
        }
    }
    return best;
}

export function tryLocalFaqAnswer(
    rawMessage,
    { cart = [], orderType = "DELIVERY", categories = [], menuItems = [], knowledge = null } = {}
) {
    const text = String(rawMessage ?? "").trim();
    if (!text) return null;

    const lower = text.toLowerCase();
    const safeKnowledge = sanitizeAiKnowledge(knowledge);

    if (safeKnowledge?.faqs?.length) {
        const customFaq = findMatchingCustomFaq(lower, safeKnowledge.faqs);
        if (customFaq) {
            return {
                reply: customFaq.answer,
                recommendedItemIds: [],
                actions: [],
                source: "local"
            };
        }
    }
    const isFoodQuery = looksLikeFoodRecommendationRequest(lower);
    const wordCount = lower.split(/\s+/).filter(Boolean).length;
    const categoryNames = summarizeMenuCategories(categories, menuItems);
    const categoryListText = categoryNames.length ? categoryNames.join(", ") : "Burgers, Karrahi, BBQ & Cold Drinks";

    if (
        wordCount <= 4 &&
        /\b(hi|hello|hey|salam|assalam|aoa|slm|hola)\b/i.test(lower) &&
        !isFoodQuery
    ) {
        return {
            reply: `Assalam-o-Alaikum! Welcome to Hungry Birds. Ask me about ${categoryListText}, share your budget (e.g. "under Rs. 1,000"), or ask to track an order!`,
            recommendedItemIds: [],
            actions: [],
            source: "local"
        };
    }

    if (
        /\b(what do you have|show menu|full menu|menu list|all categories|categories|kya kya hai|kya milta|dishes available)\b/i.test(lower) &&
        !extractBudgetAmount(text)
    ) {
        const validPrices = (Array.isArray(menuItems) ? menuItems : [])
            .map((i) => Number(i?.price))
            .filter((p) => Number.isFinite(p) && p > 0);
        const minPriceText = validPrices.length
            ? ` starting from Rs. ${Math.min(...validPrices).toLocaleString()}`
            : "";
        return {
            reply: `Our live menu covers ${categoryListText}${minPriceText}. Tell me which category or budget you prefer (e.g., "Best burgers" or "1500 mein 2 logon ka dinner") and I'll pick dishes you can add in one tap!`,
            recommendedItemIds: [],
            actions: [],
            source: "local"
        };
    }

    if (
        /\b(track|order status|where is my order|mera order|order kahan)\b/i.test(lower) &&
        !/\b(menu|burger|karrahi|sajji|suggest|recommend|budget)\b/i.test(lower)
    ) {
        return {
            reply: "You can check your live order progress in one tap below. Signed-in customers see active orders automatically, or you can enter your Order ID.",
            recommendedItemIds: [],
            actions: ["TRACK_ORDER"],
            source: "local"
        };
    }

    if (/\b(open cart|show cart|view cart|my cart|checkout)\b/i.test(lower) && !isFoodQuery) {
        const subtotal = getCartSubtotalValue(cart);
        const count = (Array.isArray(cart) ? cart : []).reduce((s, i) => s + (Number(i?.qty) || 0), 0);
        const minGap = orderType === "DELIVERY" && subtotal < DELIVERY_MINIMUM_RS
            ? ` Delivery requires Rs. ${DELIVERY_MINIMUM_RS} minimum (add Rs. ${DELIVERY_MINIMUM_RS - subtotal} more, or switch to Takeaway).`
            : "";
        return {
            reply: count > 0
                ? `Your cart currently has ${count} item(s) totaling Rs. ${subtotal.toLocaleString()}.${minGap}`
                : "Your cart is empty right now. Ask me for meal ideas or browse the menu to add items!",
            recommendedItemIds: [],
            actions: ["OPEN_CART"],
            source: "local"
        };
    }

    if (
        /\b(timing|timings|open|opening|closing|hours)\b/i.test(lower) &&
        !(/\b(open cart|open track)\b/i.test(lower)) &&
        safeKnowledge?.openingHours
    ) {
        return {
            reply: safeKnowledge.openingHours,
            recommendedItemIds: [],
            actions: [],
            source: "local"
        };
    }

    if (
        /\b(delivery fee|delivery charge|delivery charges|delivery area|delivery areas|eta|how long)\b/i.test(lower) &&
        safeKnowledge?.deliveryInfo
    ) {
        return {
            reply: `${safeKnowledge.deliveryInfo} (Delivery minimum is Rs. ${DELIVERY_MINIMUM_RS}; Takeaway has no minimum.)`,
            recommendedItemIds: [],
            actions: ["OPEN_CART"],
            source: "local"
        };
    }

    if (
        /\b(halal|allergen|allergy|ingredient|spicy|spice|bestseller|best seller|famous|popular)\b/i.test(lower) &&
        !(/\b(under|budget|mein|tak|rs\.?)\b/i.test(lower)) &&
        safeKnowledge?.foodNotes
    ) {
        return {
            reply: safeKnowledge.foodNotes,
            recommendedItemIds: [],
            actions: [],
            source: "local"
        };
    }

    if (
        /\b(deal|deals|special|specials|offer|offers|combo)\b/i.test(lower) &&
        !(/\b(under|budget|mein|tak|rs\.?)\b/i.test(lower)) &&
        safeKnowledge?.dealsAndUpsells
    ) {
        return {
            reply: safeKnowledge.dealsAndUpsells,
            recommendedItemIds: [],
            actions: [],
            source: "local"
        };
    }

    if (
        /\b(timing|timings|open|opening|closing|hours|halal|allergen|allergy|ingredient|peanut|gluten|delivery fee|delivery charge|delivery charges|complaint|refund|late)\b/i.test(lower) &&
        !(/\b(open cart|open track)\b/i.test(lower))
    ) {
        return {
            reply: "I don't have exact live branch hours, neighborhood delivery charges, or ingredient/allergen sheets here. Please message our team on WhatsApp or call 0325-7867774 for an exact confirmation.",
            recommendedItemIds: [],
            actions: ["WHATSAPP"],
            source: "local"
        };
    }

    if (/\b(phone|number|contact|whatsapp|call|address|location|directions|kidhar|kahan hai)\b/i.test(lower) && !isFoodQuery) {
        return {
            reply: "You can reach Hungry Birds by Call or WhatsApp at 0325-7867774, or open Directions from the page footer/Google Maps card.",
            recommendedItemIds: [],
            actions: ["WHATSAPP"],
            source: "local"
        };
    }

    if (/\b(loyalty|coupon|promo|discount|10th order|10 orders|reward)\b/i.test(lower) && !isFoodQuery) {
        return {
            reply: "Signed-in customers earn a 10% off loyalty coupon on every 10 completed online orders (viewable under My Coupons). You can apply promo or loyalty codes inside Checkout.",
            recommendedItemIds: [],
            actions: ["OPEN_CART"],
            source: "local"
        };
    }

    if (
        /\b(delivery minimum|minimum order|min order|delivery info|takeaway|pickup)\b/i.test(lower) &&
        !(/\b(under|suggest|recommend|meal|menu|burger|karrahi|sajji)\b/i.test(lower))
    ) {
        const subtotal = getCartSubtotalValue(cart);
        const gapNote =
            orderType === "DELIVERY" && subtotal > 0 && subtotal < DELIVERY_MINIMUM_RS
                ? ` Your current cart is Rs. ${subtotal.toLocaleString()} (Rs. ${DELIVERY_MINIMUM_RS - subtotal} away from the delivery minimum).`
                : "";
        return {
            reply: `Minimum order for Delivery is Rs. ${DELIVERY_MINIMUM_RS}, and delivery charges vary by location (confirmed by our team). Takeaway has no minimum order.${gapNote}`,
            recommendedItemIds: [],
            actions: ["OPEN_CART", "WHATSAPP"],
            source: "local"
        };
    }

    return null;
}

function extractBudgetAmount(text) {
    const patterns = [
        /(?:under|below|within|budget|max|upto|up\s+to|rs\.?|pkr)\s*[:\-]?\s*(\d{2,5}(?:,\d{3})*)/i,
        /(\d{2,5}(?:,\d{3})*)\s*(?:mein|me|main|tak|rs|rupay|rupees|pkr)\b/i
    ];
    for (const pattern of patterns) {
        const match = String(text).replace(/,/g, "").match(pattern);
        if (match && match[1]) {
            const amount = Number(match[1]);
            if (Number.isFinite(amount) && amount >= 50) return amount;
        }
    }
    return null;
}

const KEYWORD_SYNONYMS = {
    karahi: ["karrahi", "karahi"],
    karrahi: ["karrahi", "karahi"],
    burger: ["burger", "zinger", "shroom"],
    zinger: ["zinger", "burger"],
    drink: ["drink", "pepsi", "7up", "dew", "coke", "sprite", "cold"],
    cold: ["drink", "pepsi", "7up", "dew", "cold"],
    bbq: ["bbq", "tikka", "kabab", "boti", "malai"],
    sajji: ["sajji", "rice", "chicken"],
    cheap: ["cheap", "sasta", "budget", "affordable", "low"]
};

export function buildLocalMenuFallback(
    rawMessage,
    menuItems = [],
    categories = [],
    cart = [],
    orderType = "DELIVERY"
) {
    const text = String(rawMessage ?? "").trim();
    const lower = text.toLowerCase();
    const catLookup = getCategoryLookup(categories);

    const catalog = (Array.isArray(menuItems) ? menuItems : [])
        .map((item) => ({
            id: String(item?.id ?? item?.menuItemId ?? "").trim(),
            name: String(item?.name ?? "").trim(),
            price: Number(item?.price),
            categoryName: String(catLookup.get(String(item?.categoryId ?? "")) || item?.categoryId || "Menu")
        }))
        .filter((item) => item.id && item.name && Number.isFinite(item.price) && item.price >= 0);

    if (!catalog.length) {
        return {
            reply: "Our menu is still loading right now. Tap Retry on the menu grid or reach us on WhatsApp (0325-7867774).",
            recommendedItemIds: [],
            actions: ["WHATSAPP"],
            source: "fallback"
        };
    }

    const budget = extractBudgetAmount(text);
    const isPriceLookup = /\b(price of|how much|cost of|kitne ka|kitne ki|rate of|price)\b/i.test(lower);
    const isGroupMeal = /\b(family|friends|sharing|group|dinner|lunch|people|logon|log)\b/i.test(lower);
    const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const expandedTokens = new Set(words);
    for (const w of words) {
        for (const syn of KEYWORD_SYNONYMS[w] || []) {
            expandedTokens.add(syn);
        }
    }

    const scored = catalog.map((item) => {
        const haystack = `${item.name} ${item.categoryName}`.toLowerCase();
        let matchScore = 0;
        for (const tok of expandedTokens) {
            if (haystack.includes(tok)) matchScore += 3;
        }
        let score = matchScore;
        if (isGroupMeal && (item.price >= 600 || /\b(karrahi|karahi|sajji|full|half|family|platter)\b/i.test(haystack))) {
            score += 3;
        }
        if (/cold drink/i.test(item.categoryName) && !/\b(drink|pepsi|7up|dew|coke|cold|beverage)\b/i.test(lower)) {
            score -= 1;
        }
        if (budget !== null) {
            if (item.price <= budget) score += 2;
            else score -= 5;
        }
        return { item, score, matchScore };
    });

    const maxMatchScore = scored.reduce((max, entry) => Math.max(max, entry.matchScore), 0);

    if (budget === null && maxMatchScore === 0 && !isGroupMeal) {
        const categoryNames = summarizeMenuCategories(categories, menuItems);
        const categoryText = categoryNames.length ? categoryNames.join(", ") : "Fast Food, Karrahi, BBQ & Cold Drinks";
        return {
            reply: `I can help you browse ${categoryText}, plan combos by budget (e.g., "Meal under Rs. 1,000"), check Delivery minimums (Rs. 500), or open Order Tracking. What are you craving today?`,
            recommendedItemIds: [],
            actions: ["WHATSAPP"],
            source: "fallback"
        };
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return isGroupMeal ? b.item.price - a.item.price : a.item.price - b.item.price;
    });

    let picks = [];
    if (isPriceLookup && maxMatchScore > 0) {
        picks = scored.filter((entry) => entry.matchScore > 0).slice(0, 3).map((entry) => entry.item);
    } else if (budget !== null) {
        const withinBudget = scored.filter((entry) => entry.item.price <= budget);
        let running = 0;
        for (const entry of withinBudget) {
            if (picks.length >= 3) break;
            if (running + entry.item.price <= budget) {
                picks.push(entry.item);
                running += entry.item.price;
            }
        }
        if (!picks.length && withinBudget.length) {
            picks.push(withinBudget[0].item);
        }
    }

    if (!picks.length) {
        picks = scored.slice(0, 3).map((entry) => entry.item);
    }

    const subtotal = getCartSubtotalValue(cart);
    const pickTotal = picks.reduce((sum, p) => sum + p.price, 0);
    const pickSummary = picks.map((p) => `${p.name} (Rs. ${p.price.toLocaleString()})`).join(", ");

    let reply;
    if (budget !== null && picks.every((p) => p.price > budget)) {
        const cheapest = [...catalog].sort((a, b) => a.price - b.price)[0];
        picks = [cheapest];
        reply = `Our most affordable option right now is ${cheapest.name} at Rs. ${cheapest.price.toLocaleString()}.`;
    } else if (isPriceLookup && maxMatchScore > 0) {
        reply = `Current menu pricing: ${pickSummary}. You can add directly below!`;
    } else if (budget !== null) {
        reply = `Within Rs. ${budget.toLocaleString()}, here are great picks totaling Rs. ${pickTotal.toLocaleString()}: ${pickSummary}.`;
    } else if (isGroupMeal) {
        reply = `Great sharing options for dining together (totaling Rs. ${pickTotal.toLocaleString()}): ${pickSummary}.`;
    } else {
        reply = `Here are matching Hungry Birds picks you can add right away: ${pickSummary}.`;
    }

    if (orderType === "DELIVERY" && subtotal + pickTotal < DELIVERY_MINIMUM_RS) {
        reply += ` Note: Delivery requires at least Rs. ${DELIVERY_MINIMUM_RS} (Takeaway has no minimum).`;
    }

    const actions = [];
    if (subtotal > 0) actions.push("OPEN_CART");
    if (/\b(track|status|order)\b/i.test(lower)) actions.push("TRACK_ORDER");

    return {
        reply,
        recommendedItemIds: picks.map((p) => p.id),
        actions,
        source: "fallback"
    };
}

export function initAiAssistant({
    getMenuItems,
    getCategories,
    getCart,
    getOrderType,
    getAiKnowledge,
    addToCart,
    openTrackOrder,
    openCart,
    showToast
}) {
    const fab = document.getElementById("aiChatFab");
    const drawer = document.getElementById("aiChatDrawer");
    const closeBtn = document.getElementById("closeAiChatBtn");
    const clearBtn = document.getElementById("clearAiChatBtn");
    const messagesEl = document.getElementById("aiChatMessages");
    const chipsEl = document.getElementById("aiStarterChips");
    const form = document.getElementById("aiChatForm");
    const input = document.getElementById("aiChatInput");
    const sendBtn = document.getElementById("aiChatSendBtn");
    const statusBadge = document.getElementById("aiChatStatusBadge");
    const helperText = document.getElementById("aiChatHelperText");

    if (!fab || !drawer || !messagesEl || !form || !input) return;

    const history = [];
    let isSending = false;
    let lastSentAt = 0;
    let closeTimer = null;

    function createWelcomeMessage() {
        return {
            role: "assistant",
            text: "Assalam-o-Alaikum! I'm the Hungry Birds assistant. Ask me for meal ideas by budget or craving (English ya Roman Urdu), delivery info, or order tracking.",
            recommendedItemIds: [],
            actions: [],
            source: "local"
        };
    }

    function setHelper(msg = "") {
        if (!helperText) return;
        if (!msg) {
            helperText.textContent = "";
            helperText.classList.add("hidden");
        } else {
            helperText.textContent = msg;
            helperText.classList.remove("hidden");
        }
    }

    function setStatusLabel(label) {
        if (statusBadge) {
            statusBadge.textContent = label;
        }
    }

    function renderRecommendationCards(itemIds = []) {
        const menuMap = new Map(
            (getMenuItems() || []).map((item) => [String(item.id), item])
        );
        const validItems = itemIds
            .map((id) => menuMap.get(String(id)))
            .filter(Boolean);

        if (!validItems.length) return "";

        return `
            <div class="mt-2.5 space-y-2">
                ${validItems.map((item) => `
                    <div class="flex items-center justify-between gap-2 rounded-2xl border border-brand-sand bg-white px-3 py-2 shadow-sm">
                        <div class="min-w-0">
                            <div class="truncate text-xs font-bold text-brand-espresso">${escapeAiHtml(item.name)}</div>
                            <div class="text-xs font-extrabold text-brand-red tabular-nums">Rs. ${Number(item.price || 0).toLocaleString()}</div>
                        </div>
                        <button
                            type="button"
                            data-ai-action="add-item"
                            data-id="${escapeAiHtml(item.id)}"
                            class="shrink-0 rounded-xl bg-brand-espresso px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-red transition-colors pressable"
                        >
                            + Add
                        </button>
                    </div>
                `).join("")}
            </div>
        `;
    }

    function renderActionButtons(actions = []) {
        if (!actions.length) return "";
        const buttons = actions.map((action) => {
            if (action === "TRACK_ORDER") {
                return `
                    <button
                        type="button"
                        data-ai-action="track-order"
                        class="inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100 transition-colors pressable"
                    >
                        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                        <span>Track Order</span>
                    </button>
                `;
            }
            if (action === "OPEN_CART") {
                return `
                    <button
                        type="button"
                        data-ai-action="open-cart"
                        class="inline-flex items-center gap-1.5 rounded-xl bg-brand-redSoft px-3 py-1.5 text-xs font-bold text-brand-redDark hover:bg-brand-red/15 transition-colors pressable"
                    >
                        <i class="fa-solid fa-cart-shopping" aria-hidden="true"></i>
                        <span>Open Cart</span>
                    </button>
                `;
            }
            if (action === "WHATSAPP") {
                return `
                    <a
                        href="${WHATSAPP_URL}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center gap-1.5 rounded-xl bg-green-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-600 transition-colors pressable"
                    >
                        <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
                        <span>WhatsApp 0325-7867774</span>
                    </a>
                `;
            }
            return "";
        }).join("");

        return buttons ? `<div class="mt-2.5 flex flex-wrap gap-2">${buttons}</div>` : "";
    }

    function renderMessages(showTyping = false) {
        const list = history.length ? history : [createWelcomeMessage()];
        const bubblesHtml = list.map((msg) => {
            if (msg.role === "user") {
                return `
                    <div class="flex justify-end">
                        <div class="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-espresso px-4 py-2.5 text-sm text-white shadow-sm">
                            ${escapeAiHtml(msg.text)}
                        </div>
                    </div>
                `;
            }

            const modeBadge = msg.source === "fallback"
                ? `<div class="mb-1 text-[11px] font-semibold text-brand-redDark">Menu helper (instant local mode)</div>`
                : "";

            return `
                <div class="flex justify-start">
                    <div class="max-w-[92%] rounded-2xl rounded-bl-sm border border-brand-sand bg-brand-cream px-4 py-3 text-sm text-brand-espresso shadow-sm">
                        ${modeBadge}
                        <p class="leading-relaxed whitespace-pre-line">${escapeAiHtml(msg.text)}</p>
                        ${renderRecommendationCards(msg.recommendedItemIds)}
                        ${renderActionButtons(msg.actions)}
                    </div>
                </div>
            `;
        }).join("");

        const typingHtml = showTyping
            ? `
                <div class="flex justify-start" aria-label="Assistant is typing">
                    <div class="inline-flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-brand-sand bg-brand-cream px-4 py-3">
                        <span class="ai-typing-dot"></span>
                        <span class="ai-typing-dot"></span>
                        <span class="ai-typing-dot"></span>
                    </div>
                </div>
            `
            : "";

        messagesEl.innerHTML = bubblesHtml + typingHtml;
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function openDrawer() {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        drawer.classList.remove("hidden");
        drawer.setAttribute("aria-hidden", "false");
        fab.setAttribute("aria-expanded", "true");
        document.body.classList.add("overflow-hidden");
        renderMessages(false);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                drawer.classList.add("is-open");
                input.focus();
            });
        });
    }

    function closeDrawer() {
        drawer.classList.remove("is-open");
        drawer.setAttribute("aria-hidden", "true");
        fab.setAttribute("aria-expanded", "false");
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            drawer.classList.add("hidden");
            closeTimer = null;
        }, 280);
        if (!document.querySelector(".modal-backdrop.is-open")) {
            document.body.classList.remove("overflow-hidden");
        }
        fab.focus();
    }

    function pushAssistantResult(result, statusLabel) {
        history.push({
            role: "assistant",
            text: String(result?.reply || result?.text || ""),
            recommendedItemIds: Array.isArray(result?.recommendedItemIds) ? result.recommendedItemIds : [],
            actions: Array.isArray(result?.actions) ? result.actions : [],
            source: result?.source || "local"
        });
        if (statusLabel) setStatusLabel(statusLabel);
    }

    async function handleSend(rawText) {
        const message = String(rawText ?? "").trim().slice(0, MAX_MESSAGE_LEN);
        if (!message) return;

        if (isSending) return;
        const elapsed = Date.now() - lastSentAt;
        if (lastSentAt > 0 && elapsed < SEND_COOLDOWN_MS) {
            setHelper("Please wait a second before sending another question.");
            return;
        }

        setHelper("");
        const cart = getCart() || [];
        const orderType = getOrderType() || "DELIVERY";
        const menuItems = getMenuItems() || [];
        const categories = getCategories() || [];
        const knowledge = typeof getAiKnowledge === "function" ? getAiKnowledge() : null;

        history.push({ role: "user", text: message });
        input.value = "";

        const faqHit = tryLocalFaqAnswer(message, { cart, orderType, categories, menuItems, knowledge });
        if (faqHit) {
            pushAssistantResult({ ...faqHit, source: "local" }, "Instant help");
            renderMessages(false);
            return;
        }

        if (!menuItems.length) {
            const emptyFallback = buildLocalMenuFallback(message, menuItems, categories, cart, orderType);
            pushAssistantResult(emptyFallback, "Menu helper");
            renderMessages(false);
            return;
        }

        isSending = true;
        lastSentAt = Date.now();
        if (sendBtn) sendBtn.disabled = true;
        renderMessages(true);

        try {
            const payload = buildSanitizedAiPayload({
                message,
                history: history.slice(0, -1),
                menuItems,
                categories,
                cart,
                orderType,
                knowledge
            });

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                pushAssistantResult({ ...data, source: "gemini" }, "Gemini AI");
                return;
            }

            const errData = await response.json().catch(() => null);
            console.warn("[Hungry Birds AI] /api/chat fallback:", response.status, errData?.error || "UNKNOWN");
            const fallback = buildLocalMenuFallback(message, menuItems, categories, cart, orderType);
            pushAssistantResult(fallback, "Menu helper");
        } catch (err) {
            console.warn("[Hungry Birds AI] /api/chat request failed:", err?.name || "Error");
            const fallback = buildLocalMenuFallback(message, menuItems, categories, cart, orderType);
            pushAssistantResult(fallback, "Menu helper");
        } finally {
            isSending = false;
            if (sendBtn) sendBtn.disabled = false;
            renderMessages(false);
        }
    }

    fab.addEventListener("click", openDrawer);
    closeBtn?.addEventListener("click", closeDrawer);
    clearBtn?.addEventListener("click", () => {
        history.length = 0;
        setHelper("");
        renderMessages(false);
        input.focus();
    });

    drawer.addEventListener("click", (event) => {
        if (event.target === drawer) {
            closeDrawer();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && drawer.classList.contains("is-open")) {
            closeDrawer();
        }
    });

    chipsEl?.addEventListener("click", (event) => {
        const chip = event.target.closest("[data-ai-prompt]");
        if (!chip) return;
        handleSend(chip.dataset.aiPrompt);
    });

    messagesEl.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-ai-action]");
        if (!btn) return;
        const { aiAction, id } = btn.dataset;
        if (aiAction === "add-item" && id) {
            addToCart(id);
        } else if (aiAction === "track-order") {
            closeDrawer();
            openTrackOrder();
        } else if (aiAction === "open-cart") {
            closeDrawer();
            openCart();
        }
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!input.value.trim()) {
            setHelper("Type a question or tap one of the quick suggestions above.");
            input.focus();
            return;
        }
        handleSend(input.value);
    });

    renderMessages(false);
    void showToast;
}
