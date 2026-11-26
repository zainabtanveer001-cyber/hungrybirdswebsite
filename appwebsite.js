// ===== Back End & Firebase Initialization =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    collection,
    addDoc,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    increment,
    query,
    where,
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { initAiAssistant } from "./ai-assistant.js";

if (typeof window !== "undefined") {
    window.__HB_APP_BOOTED__ = true;
}

function createFirestoreClient(firebaseApp) {
    try {
        return initializeFirestore(firebaseApp, {
            experimentalAutoDetectLongPolling: true,
            localCache: persistentLocalCache({
                tabManager: persistentMultipleTabManager()
            })
        });
    } catch {
        return initializeFirestore(firebaseApp, {
            experimentalAutoDetectLongPolling: true
        });
    }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = createFirestoreClient(app);

// ===== State =====
let currentUser = null;
let cart = [];
let isLoginMode = true;
let currentOrderType = "DELIVERY";
let toastTimer = null;
let appliedCoupon = null;
let pastOrdersCache = [];
let pastOrdersListener = null;
let activeOrderListener = null;
let isPlacingOrder = false;
let lastOrderPlacedAt = 0;
let lastConfirmedOrderId = "";

const MENU_ITEMS_PER_CATEGORY = 4;

let categories = [{ id: "ALL", name: "All" }];
let menuItems = [];
let aiKnowledge = null;
let activeCategoryId = "ALL";
let menuSearchQuery = "";
let activeDetailItemId = null;
const expandedCategoryIds = new Set();

const modalCloseTimers = new WeakMap();
const modalPreviousFocus = new WeakMap();

const FALLBACK_SVG_IMAGE =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23FAF7F2'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial,sans-serif' font-size='18' font-weight='bold' fill='%23C62822'%3EHungry Birds%3C/text%3E%3C/svg%3E";

// ===== Cart Persistence (localStorage) =====
function loadCart() {
    try {
        const savedCart = localStorage.getItem("hungryBirdsCart");
        if (!savedCart) return;
        const parsed = JSON.parse(savedCart);
        if (!Array.isArray(parsed)) return;

        cart = parsed
            .filter(item =>
                item &&
                typeof item.id === "string" &&
                item.id.length > 0 &&
                Number.isFinite(Number(item.price)) &&
                Number(item.price) >= 0 &&
                Number.isInteger(Number(item.qty)) &&
                Number(item.qty) > 0
            )
            .map(item => ({
                ...item,
                price: Number(item.price),
                qty: Number(item.qty)
            }));
    } catch (e) {
        console.warn("Failed to load cart from localStorage:", e);
        cart = [];
    }
}
loadCart();

function saveCart() {
    try {
        localStorage.setItem("hungryBirdsCart", JSON.stringify(cart));
    } catch (e) {
        console.warn("Failed to save cart to localStorage:", e);
    }
}

function clearCart() {
    cart = [];
    try {
        localStorage.removeItem("hungryBirdsCart");
    } catch (e) {
        console.warn("Failed to clear cart from localStorage:", e);
    }
}

// ===== Small UI Helpers =====
const $ = (id) => document.getElementById(id);

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function getSafeUrl(url) {
    const trimmed = String(url ?? "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
        return trimmed;
    }
    return "";
}

function getFriendlyAuthError(error) {
    const code = error?.code || "";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) {
        return "Invalid email or password.";
    }
    if (code === "auth/email-already-in-use") {
        return "An account with this email already exists.";
    }
    if (code === "auth/weak-password") {
        return "Password must be at least 6 characters.";
    }
    if (code === "auth/invalid-email") {
        return "Please enter a valid email address.";
    }
    if (code === "auth/too-many-requests") {
        return "Too many attempts. Please wait a moment and try again.";
    }
    if (code === "auth/network-request-failed") {
        return "Network error. Please check your connection.";
    }
    return "Authentication failed. Please try again.";
}

function showToast(message, icon = "fa-check") {
    const toast = $("toast");

    if (!toast) return;

    $("toastMessage").textContent = message;
    $("toastIcon").innerHTML = `<i class="fa-solid ${escapeHTML(icon)}"></i>`;

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2200);
}
window.showToast = showToast;

function openModal(modal) {
    if (!modal) return;

    const pendingTimer = modalCloseTimers.get(modal);
    if (pendingTimer) {
        clearTimeout(pendingTimer);
        modalCloseTimers.delete(modal);
    }

    if (!modal.classList.contains("is-open") && document.activeElement instanceof HTMLElement) {
        modalPreviousFocus.set(modal, document.activeElement);
    }

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            modal.classList.add("is-open");
            const visibleInput = Array.from(
                modal.querySelectorAll('input:not([type="hidden"])')
            ).find(el => !el.disabled && !el.closest(".hidden"));
            const fallbackControl = Array.from(
                modal.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])')
            ).find(el =>
                !el.closest(".hidden") &&
                !/close/i.test(el.id || "") &&
                !/^close\b/i.test(el.getAttribute("aria-label") || "")
            );
            const focusTarget = visibleInput || fallbackControl || modal;
            if (focusTarget === modal && !modal.hasAttribute("tabindex")) {
                modal.setAttribute("tabindex", "-1");
            }
            focusTarget?.focus?.();
        });
    });

    document.body.classList.add("overflow-hidden");
}

function closeModal(modal) {
    if (!modal) return;

    const existingTimer = modalCloseTimers.get(modal);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    const timer = setTimeout(() => {
        modal.classList.add("hidden");
        modalCloseTimers.delete(modal);
    }, 280);
    modalCloseTimers.set(modal, timer);

    if (!document.querySelector(".modal-backdrop.is-open")) {
        document.body.classList.remove("overflow-hidden");
    }

    const prevFocus = modalPreviousFocus.get(modal);
    if (prevFocus && typeof prevFocus.focus === "function" && prevFocus.isConnected) {
        prevFocus.focus();
    }
    modalPreviousFocus.delete(modal);
}

function animateCartButton() {
    const btn = $("cartBtn");

    if (!btn) return;

    btn.classList.remove("cart-bump");
    void btn.offsetWidth;
    btn.classList.add("cart-bump");
}

function pricePulse(element) {
    if (!element) return;

    element.classList.remove("price-pop");
    void element.offsetWidth;
    element.classList.add("price-pop");
}

// ===== Loading Skeleton =====
function renderMenuSkeleton(count = MENU_ITEMS_PER_CATEGORY) {
    const grid = $("menuGrid");

    if (!grid) return;

    const cardSkeleton = `
        <div class="bg-white rounded-2xl sm:rounded-3xl overflow-hidden border border-gray-100 shadow-sm">
            <div class="skeleton h-32 sm:h-48"></div>

            <div class="p-3 sm:p-5 space-y-2.5 sm:space-y-3">
                <div class="skeleton h-4 sm:h-5 rounded w-3/4"></div>

                <div class="flex justify-between items-center pt-1 sm:pt-2">
                    <div class="skeleton h-5 sm:h-6 rounded w-16 sm:w-24"></div>
                    <div class="skeleton h-8 sm:h-10 rounded-lg sm:rounded-xl w-16 sm:w-24"></div>
                </div>
            </div>
        </div>
    `;

    const cardsHTML = Array.from({ length: count }, () => cardSkeleton).join("");

    grid.innerHTML = Array.from({ length: 2 }, () => `
        <section class="space-y-4">
            <div class="flex items-center gap-3">
                <div class="skeleton h-6 sm:h-7 rounded-lg w-36"></div>
                <div class="skeleton h-5 rounded-full w-16"></div>
            </div>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 lg:gap-6">
                ${cardsHTML}
            </div>
        </section>
    `).join("");
}

// ===== Firestore Menu =====
function firstDefined(data, keys, fallback = "") {
    return keys.reduce(
        (value, key) => value ?? data[key],
        undefined
    ) ?? fallback;
}

function hasExplicitFalse(data, keys) {
    return keys.some(key => data[key] === false);
}

function getCategoryId(data) {
    const category = firstDefined(
        data,
        ["categoryId", "categoryID", "categoryRef", "category"],
        "uncategorized"
    );

    if (typeof category === "object" && category !== null) {
        return category.id || category.value || "uncategorized";
    }

    return String(category);
}

function fromFirestoreRestValue(val) {
    if (!val || typeof val !== "object") return undefined;
    if ("nullValue" in val) return null;
    if ("booleanValue" in val) return Boolean(val.booleanValue);
    if ("integerValue" in val) return Number(val.integerValue);
    if ("doubleValue" in val) return Number(val.doubleValue);
    if ("stringValue" in val) return String(val.stringValue);
    if ("timestampValue" in val) return String(val.timestampValue);
    if ("bytesValue" in val) return String(val.bytesValue);
    if ("referenceValue" in val) {
        const refPath = String(val.referenceValue);
        return {
            id: refPath.split("/").pop() || "",
            path: refPath
        };
    }
    if ("geoPointValue" in val) return val.geoPointValue;
    if ("arrayValue" in val) {
        const items = (val.arrayValue && val.arrayValue.values) || [];
        return items.map((entry) => fromFirestoreRestValue(entry));
    }
    if ("mapValue" in val) {
        const out = {};
        const fields = (val.mapValue && val.mapValue.fields) || {};
        for (const [k, v] of Object.entries(fields)) {
            out[k] = fromFirestoreRestValue(v);
        }
        return out;
    }
    return undefined;
}

function parseFirestoreRestDoc(restDoc) {
    if (!restDoc || typeof restDoc.name !== "string") return null;
    const id = restDoc.name.split("/").pop() || "";
    if (!id) return null;
    const data = {};
    const fields = restDoc.fields || {};
    for (const [key, rawVal] of Object.entries(fields)) {
        data[key] = fromFirestoreRestValue(rawVal);
    }
    return { id, data };
}

async function fetchCollectionViaRest(collectionName, pageSize = 300) {
    const docs = [];
    let pageToken = "";
    const baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(firebaseConfig.projectId)}/databases/(default)/documents/${encodeURIComponent(collectionName)}`;

    do {
        const params = new URLSearchParams({
            pageSize: String(pageSize),
            key: firebaseConfig.apiKey
        });
        if (pageToken) params.set("pageToken", pageToken);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 25000);
        let response;
        try {
            response = await fetch(`${baseUrl}?${params.toString()}`, {
                method: "GET",
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const err = new Error(`Firestore REST ${collectionName} failed (${response.status})`);
            err.code = (response.status === 401 || response.status === 403)
                ? "permission-denied"
                : "unavailable";
            throw err;
        }

        const payload = await response.json();
        for (const rawDoc of payload.documents || []) {
            const parsed = parseFirestoreRestDoc(rawDoc);
            if (parsed) docs.push(parsed);
        }
        pageToken = payload.nextPageToken || "";
    } while (pageToken);

    return docs;
}

async function loadMenuFromFirestore() {
    let categoryRecords = null;
    let menuRecords = null;

    try {
        const [categorySnapshot, menuSnapshot] = await Promise.all([
            getDocs(collection(db, "categories")),
            getDocs(collection(db, "menu"))
        ]);

        const isColdCacheTimeout =
            menuSnapshot.empty && Boolean(menuSnapshot.metadata && menuSnapshot.metadata.fromCache);

        if (!isColdCacheTimeout) {
            categoryRecords = categorySnapshot.docs.map(docSnap => ({
                id: docSnap.id,
                data: docSnap.data()
            }));
            menuRecords = menuSnapshot.docs.map(docSnap => ({
                id: docSnap.id,
                data: docSnap.data()
            }));
        }
    } catch (sdkError) {
        if (sdkError && sdkError.code === "permission-denied") {
            throw sdkError;
        }
        console.warn("Firestore SDK menu fetch degraded, trying HTTPS REST fallback:", sdkError);
    }

    if (!menuRecords) {
        const [restCategories, restMenu] = await Promise.all([
            fetchCollectionViaRest("categories", 100),
            fetchCollectionViaRest("menu", 300)
        ]);
        categoryRecords = restCategories;
        menuRecords = restMenu;
    }

    const dbCategories = categoryRecords
        .map(record => ({
            id: record.id,
            name: firstDefined(record.data, ["name", "title", "label"])
        }))
        .filter(category => category.name);

    const rawDocsById = new Map(
        menuRecords.map(record => [record.id, record.data])
    );

    const dbMenuItems = menuRecords
        .map(record => {
            const data = record.data;
            const itemName = firstDefined(
                data,
                ["name", "displayName", "title", "itemName"]
            );
            const price = Number(firstDefined(
                data,
                ["price", "sellingPrice", "salePrice", "customerPrice"],
                NaN
            ));
            const recipeId = firstDefined(
                data,
                ["recipeId", "recipeID", "recipeRef"],
                null
            );

            return {
                id: record.id,
                menuItemId: record.id,
                recipeId: typeof recipeId === "object" && recipeId !== null
                    ? recipeId.id || null
                    : recipeId,
                name: itemName,
                description: firstDefined(
                    data,
                    ["description", "desc", "details", "subtitle"],
                    ""
                ),
                price,
                categoryId: getCategoryId(data),
                img: firstDefined(
                    data,
                    ["imageUrl", "img", "image", "photoURL"],
                    ""
                )
            };
        })
        .filter(item => item.name && Number.isFinite(item.price))
        .filter(item => !hasExplicitFalse(
            rawDocsById.get(item.id),
            ["active", "isActive", "available", "isAvailable", "published", "isPublished"]
        ));

    if (!dbMenuItems.length) {
        throw new Error("The POS menu collection is empty or has no valid published items.");
    }

    const categoryMap = new Map(
        dbCategories.map(category => [category.id, category])
    );

    dbMenuItems.forEach(item => {
        if (!categoryMap.has(item.categoryId) && item.categoryId !== "uncategorized") {
            categoryMap.set(item.categoryId, {
                id: item.categoryId,
                name: item.categoryId
            });
        }
    });

    categories = [
        { id: "ALL", name: "All" },
        ...categoryMap.values()
    ];
    menuItems = dbMenuItems;

    // Reconcile persisted cart pricing/names with live menu catalog
    if (cart.length) {
        const menuById = new Map(menuItems.map(item => [item.id, item]));
        cart = cart
            .filter(cartItem => menuById.has(cartItem.id))
            .map(cartItem => {
                const liveItem = menuById.get(cartItem.id);
                return {
                    ...liveItem,
                    menuItemId: liveItem.menuItemId,
                    qty: cartItem.qty
                };
            });
        saveCart();
    }
}

// ===== Categories =====
function renderCategories(activeId = "ALL") {
    const container = $("categoryContainer");

    if (!container) return;

    container.innerHTML = "";

    categories.forEach(cat => {
        const btn = document.createElement("button");
        const active = cat.id === activeId;

        btn.type = "button";
        btn.className = `
            category-btn
            whitespace-nowrap
            px-4
            sm:px-5
            py-2.5
            min-h-[42px]
            rounded-full
            font-bold
            text-sm
            ${active
                ? "active bg-brand-red text-white shadow-glow border border-brand-red"
                : "bg-white border border-brand-sand text-brand-espresso hover:border-brand-red/30 hover:bg-brand-redSoft/60"
            }
        `;

        btn.textContent = cat.name;
        btn.setAttribute("aria-pressed", String(active));

        btn.onclick = () => {
            filterMenu(cat, btn);
        };

        container.appendChild(btn);
    });
}

function filterMenu(category, btnElement) {
    document
        .querySelectorAll("#categoryContainer button")
        .forEach(btn => {
            btn.classList.remove(
                "active",
                "bg-brand-red",
                "text-white",
                "shadow-glow",
                "border-brand-red"
            );

            btn.classList.add(
                "bg-white",
                "border-brand-sand",
                "text-brand-espresso"
            );

            btn.setAttribute(
                "aria-pressed",
                "false"
            );
        });

    btnElement.classList.remove(
        "bg-white",
        "border-brand-sand",
        "text-brand-espresso"
    );

    btnElement.classList.add(
        "active",
        "bg-brand-red",
        "text-white",
        "shadow-glow",
        "border-brand-red"
    );

    btnElement.setAttribute(
        "aria-pressed",
        "true"
    );

    activeCategoryId = (category && category.id) ? String(category.id) : "ALL";
    expandedCategoryIds.clear();

    renderMenu(menuItems, activeCategoryId);
}

// ===== Menu Rendering =====
function cardControlsHTML(id) {
    const safeId = escapeHTML(id);
    const cartItem = cart.find(
        item => item.id === id
    );

    if (cartItem) {
        return `
            <div class="flex items-center gap-0.5 sm:gap-1.5 bg-brand-espresso rounded-lg sm:rounded-xl px-1 py-1 sm:px-2 sm:py-1.5 shadow-sm">

                <button
                    type="button"
                    data-action="qty"
                    data-id="${safeId}"
                    data-delta="-1"
                    class="w-6 h-6 sm:w-7 sm:h-7 rounded-md sm:rounded-lg text-xs sm:text-sm text-white hover:bg-white/15 hover:text-brand-gold font-bold transition-colors pressable"
                    aria-label="Decrease quantity"
                >
                    −
                </button>

                <span class="text-white font-bold w-4 sm:w-5 text-xs sm:text-sm text-center tabular-nums">
                    ${cartItem.qty}
                </span>

                <button
                    type="button"
                    data-action="qty"
                    data-id="${safeId}"
                    data-delta="1"
                    class="w-6 h-6 sm:w-7 sm:h-7 rounded-md sm:rounded-lg text-xs sm:text-sm text-white hover:bg-white/15 hover:text-brand-gold font-bold transition-colors pressable"
                    aria-label="Increase quantity"
                >
                    +
                </button>

            </div>
        `;
    }

    return `
        <button
            type="button"
            data-action="add"
            data-id="${safeId}"
            class="bg-brand-espresso text-white px-2.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold rounded-lg sm:rounded-xl hover:bg-brand-red transition-colors shadow-sm pressable whitespace-nowrap"
        >
            <i class="fa-solid fa-plus mr-1" aria-hidden="true"></i>
            Add
        </button>
    `;
}

function renderCardControls(id) {
    const box = document.getElementById(
        `qtyBox-${id}`
    );

    if (box) {
        box.innerHTML = cardControlsHTML(id);
    }

    if (activeDetailItemId === id) {
        const detailControls = $("itemDetailControls");
        if (detailControls) {
            detailControls.innerHTML = cardControlsHTML(id);
        }
    }
}

function filterMenuItemsByQuery(items = [], queryText = "", categoryList = []) {
    const safeItems = Array.isArray(items) ? items : [];
    const normalized = String(queryText ?? "").trim().toLowerCase();
    if (!normalized) return safeItems;

    const tokens = normalized.split(/\s+/).filter(Boolean);
    const catNames = new Map(
        (Array.isArray(categoryList) ? categoryList : [])
            .filter(cat => cat && cat.id && cat.id !== "ALL")
            .map(cat => [String(cat.id), String(cat.name || cat.id).toLowerCase()])
    );

    return safeItems.filter(item => {
        if (!item) return false;
        const nameLower = String(item.name || "").toLowerCase();
        const catId = String(item.categoryId || "");
        const catName = catNames.get(catId) || catId.toLowerCase();
        const haystack = `${nameLower} ${catName}`;
        return tokens.every(token => haystack.includes(token));
    });
}

function buildCategoryMenuSections(
    items = [],
    categoryList = [],
    selectedCategoryId = "ALL",
    expandedIds = new Set(),
    initialLimit = 4
) {
    const safeItems = Array.isArray(items) ? items : [];
    const safeCategories = Array.isArray(categoryList)
        ? categoryList.filter(cat => cat && cat.id && cat.id !== "ALL")
        : [];
    const expandedSet = expandedIds instanceof Set ? expandedIds : new Set(expandedIds || []);
    const limit = Math.max(1, Number(initialLimit) || 4);

    const grouped = new Map();
    safeItems.forEach(item => {
        if (!item) return;
        const catId = item.categoryId ? String(item.categoryId) : "uncategorized";
        if (!grouped.has(catId)) {
            grouped.set(catId, []);
        }
        grouped.get(catId).push(item);
    });

    const categoryNameMap = new Map(
        safeCategories.map(cat => [String(cat.id), String(cat.name || cat.id)])
    );

    const orderedEntries = [];
    if (!selectedCategoryId || selectedCategoryId === "ALL") {
        const seen = new Set();
        safeCategories.forEach(cat => {
            const catId = String(cat.id);
            const catItems = grouped.get(catId);
            if (catItems && catItems.length) {
                orderedEntries.push({
                    categoryId: catId,
                    categoryName: String(cat.name || catId),
                    items: catItems
                });
                seen.add(catId);
            }
        });

        grouped.forEach((catItems, catId) => {
            if (seen.has(catId) || !catItems.length) return;
            const fallbackName = catId === "uncategorized"
                ? "Other Items"
                : (categoryNameMap.get(catId) || catId);
            orderedEntries.push({
                categoryId: catId,
                categoryName: fallbackName,
                items: catItems
            });
        });
    } else {
        const targetId = String(selectedCategoryId);
        const catItems = grouped.get(targetId) || [];
        if (catItems.length) {
            const targetName = targetId === "uncategorized"
                ? "Other Items"
                : (categoryNameMap.get(targetId) || targetId);
            orderedEntries.push({
                categoryId: targetId,
                categoryName: targetName,
                items: catItems
            });
        }
    }

    return orderedEntries.map(entry => {
        const isExpanded = expandedSet.has(entry.categoryId);
        const totalCount = entry.items.length;
        const hasMore = totalCount > limit;
        const visibleItems = isExpanded ? entry.items : entry.items.slice(0, limit);
        const hiddenCount = Math.max(0, totalCount - limit);

        return {
            categoryId: entry.categoryId,
            categoryName: entry.categoryName,
            totalCount,
            isExpanded,
            hasMore,
            visibleItems,
            hiddenCount
        };
    });
}

function createMenuCard(item, index) {
    const card = document.createElement("article");

    card.className = `
        menu-card
        reveal
        bg-white
        rounded-2xl
        sm:rounded-[2rem]
        shadow-soft
        overflow-hidden
        border
        border-brand-sand/80
        transition-all
        duration-300
        ease-out
    `;

    card.style.transitionDelay =
        `${Math.min(index * 24, 180)}ms`;

    const safeId = escapeHTML(item.id);
    const safeName = escapeHTML(item.name);
    const imgSrc = item.img || FALLBACK_SVG_IMAGE;

    card.innerHTML = `
        <button
            type="button"
            data-action="open-item-detail"
            data-id="${safeId}"
            class="block w-full text-left overflow-hidden bg-brand-cream focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-red/20"
            aria-label="View details for ${safeName}"
        >
            <img
                src="${escapeHTML(imgSrc)}"
                alt="${safeName}"
                loading="lazy"
                decoding="async"
                class="w-full h-32 sm:h-48 lg:h-52 object-cover"
            >
        </button>
        <div class="px-3 pt-3 pb-3.5 sm:px-5 sm:pt-4 sm:pb-5">
            <button
                type="button"
                data-action="open-item-detail"
                data-id="${safeId}"
                class="block w-full text-left focus:outline-none focus-visible:text-brand-red"
            >
                <h3 class="text-[13px] sm:text-[15px] font-bold text-brand-espresso leading-snug tracking-tight min-h-[2.25rem] sm:min-h-[2.4rem] line-clamp-2 hover:text-brand-red transition-colors">
                    ${safeName}
                </h3>
            </button>
            <div class="flex flex-wrap justify-between items-center gap-1.5 mt-3 sm:mt-4">
                <span class="text-[13px] sm:text-lg font-extrabold text-brand-espresso tracking-tight whitespace-nowrap tabular-nums">
                    Rs. ${Number(item.price).toLocaleString()}
                </span>
                <div id="qtyBox-${safeId}">
                    ${cardControlsHTML(item.id)}
                </div>
            </div>
        </div>
    `;

    const image = card.querySelector("img");

    image.addEventListener(
        "error",
        () => {
            image.src = FALLBACK_SVG_IMAGE;
        },
        { once: true }
    );

    requestAnimationFrame(() => {
        card.classList.add("is-visible");
    });

    return card;
}

function renderMenu(items = menuItems, selectedCategoryId = activeCategoryId) {
    const grid = $("menuGrid");

    if (!grid) return;

    grid.innerHTML = "";

    const trimmedQuery = menuSearchQuery.trim();
    const isSearching = trimmedQuery.length > 0;
    const matchedItems = isSearching
        ? filterMenuItemsByQuery(items, trimmedQuery, categories)
        : items;

    const sections = buildCategoryMenuSections(
        matchedItems,
        categories,
        isSearching ? "ALL" : selectedCategoryId,
        expandedCategoryIds,
        isSearching ? 1000 : MENU_ITEMS_PER_CATEGORY
    );

    if (isSearching) {
        const searchBar = document.createElement("div");
        searchBar.className = "flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white border border-brand-sand px-4 py-3 shadow-soft";
        searchBar.innerHTML = `
            <div class="text-sm font-semibold text-brand-espresso">
                <i class="fa-solid fa-magnifying-glass text-brand-red mr-2" aria-hidden="true"></i>
                Showing <span class="font-extrabold tabular-nums">${matchedItems.length}</span> ${matchedItems.length === 1 ? "dish" : "dishes"} for
                <span class="font-bold text-brand-red">"${escapeHTML(trimmedQuery)}"</span>
            </div>
            <button
                type="button"
                data-action="clear-menu-search"
                class="px-3.5 py-1.5 rounded-full bg-brand-redSoft text-brand-redDark text-xs font-bold hover:bg-brand-red hover:text-white transition-colors pressable"
            >
                Clear search
            </button>
        `;
        grid.appendChild(searchBar);
    }

    if (!sections.length) {
        const emptyWrap = document.createElement("div");
        emptyWrap.className = "py-20 text-center reveal is-visible";
        emptyWrap.innerHTML = `
            <div class="w-16 h-16 rounded-2xl bg-brand-redSoft text-brand-red grid place-items-center mx-auto mb-4">
                <i class="fa-solid ${isSearching ? "fa-magnifying-glass" : "fa-utensils"} text-xl" aria-hidden="true"></i>
            </div>

            <h3 class="font-display font-bold text-xl text-brand-espresso">
                ${isSearching ? "No matching dishes found" : "No items in this category"}
            </h3>

            <p class="text-brand-muted mt-1">
                ${isSearching ? "Try another dish name or clear your search filter." : "Try another category."}
            </p>

            ${isSearching ? `
                <button
                    type="button"
                    data-action="clear-menu-search"
                    class="mt-4 px-5 py-2.5 rounded-full bg-brand-red text-white text-sm font-bold hover:bg-brand-redDark transition-colors pressable"
                >
                    Show All Dishes
                </button>
            ` : ""}
        `;
        grid.appendChild(emptyWrap);

        return;
    }

    sections.forEach(section => {
        const sectionEl = document.createElement("section");
        sectionEl.className = "menu-category-section space-y-4 sm:space-y-5";
        sectionEl.dataset.categorySection = section.categoryId;

        const headerEl = document.createElement("div");
        headerEl.className = "flex items-center justify-between gap-3 border-b border-brand-sand pb-2.5";

        const headingWrap = document.createElement("div");
        headingWrap.className = "flex items-center gap-2.5 min-w-0";

        const headingEl = document.createElement("h2");
        headingEl.className = "font-display text-lg sm:text-2xl font-extrabold text-brand-espresso tracking-tight truncate";
        headingEl.textContent = section.categoryName;

        const countBadge = document.createElement("span");
        countBadge.className = "px-2.5 py-0.5 rounded-full bg-brand-redSoft text-brand-redDark text-xs font-bold whitespace-nowrap shrink-0 tabular-nums";
        countBadge.textContent = `${section.totalCount} ${section.totalCount === 1 ? "item" : "items"}`;

        headingWrap.appendChild(headingEl);
        headingWrap.appendChild(countBadge);
        headerEl.appendChild(headingWrap);
        sectionEl.appendChild(headerEl);

        const cardsGrid = document.createElement("div");
        cardsGrid.className = "grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 lg:gap-6";

        section.visibleItems.forEach((item, index) => {
            cardsGrid.appendChild(createMenuCard(item, index));
        });

        sectionEl.appendChild(cardsGrid);

        if (section.hasMore) {
            const toggleWrap = document.createElement("div");
            toggleWrap.className = "pt-2 flex justify-center";

            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.dataset.action = "toggle-category-expand";
            toggleBtn.dataset.categoryId = section.categoryId;
            toggleBtn.setAttribute("aria-expanded", String(section.isExpanded));
            toggleBtn.className = `
                inline-flex items-center gap-2
                min-h-[44px]
                px-5 py-2.5
                rounded-full
                text-xs sm:text-sm
                font-bold
                border
                transition-all
                duration-200
                pressable
                ${section.isExpanded
                    ? "bg-brand-espresso text-white border-brand-espresso hover:bg-brand-red hover:border-brand-red shadow-sm"
                    : "bg-brand-redSoft text-brand-redDark border-brand-red/20 hover:bg-brand-red hover:text-white hover:border-brand-red shadow-sm"
                }
            `;

            const labelText = section.isExpanded
                ? "Show less"
                : `Show more (${section.hiddenCount} more)`;
            const iconClass = section.isExpanded
                ? "fa-chevron-up"
                : "fa-chevron-down";

            toggleBtn.innerHTML = `
                <span>${escapeHTML(labelText)}</span>
                <i class="fa-solid ${iconClass} text-[11px]" aria-hidden="true"></i>
            `;

            toggleWrap.appendChild(toggleBtn);
            sectionEl.appendChild(toggleWrap);
        }

        grid.appendChild(sectionEl);
    });
}

// ===== Cart =====
function updateCartCount() {
    const counter = $("cartCount");
    const bottomNavCounter = $("bottomNavCartCount");

    if (!counter && !bottomNavCounter) return;

    const count = cart.reduce(
        (sum, item) => sum + item.qty,
        0
    );

    if (counter) counter.textContent = count;
    if (bottomNavCounter) bottomNavCounter.textContent = count;

    if (count > 0) {
        counter?.classList.add("animate-bounce");
        bottomNavCounter?.classList.add("animate-bounce");

        setTimeout(() => {
            counter?.classList.remove(
                "animate-bounce"
            );

            bottomNavCounter?.classList.remove(
                "animate-bounce"
            );
        }, 450);
    }
}

function getCartSubtotal() {
    return cart.reduce(
        (sum, item) =>
            sum + (item.price * item.qty),
        0
    );
}

function getDiscountAmount() {
    if (!appliedCoupon) return 0;

    return Math.round(
        getCartSubtotal() * (appliedCoupon.discountPercent / 100)
    );
}

function getCartTotal() {
    return getCartSubtotal() - getDiscountAmount();
}

// ===== Coupons =====
function isCouponExpired(couponData) {
    if (!couponData.expiresAt) return false;

    const expiry = couponData.expiresAt.toDate
        ? couponData.expiresAt.toDate()
        : new Date(couponData.expiresAt);

    return expiry.getTime() < Date.now();
}

function setCouponMessage(message, isError = true) {
    const el = $("couponMessage");

    if (!el) return;

    el.textContent = message;
    el.classList.remove("hidden", "text-red-500", "text-green-600");
    el.classList.add(isError ? "text-red-500" : "text-green-600");
}

async function applyCoupon() {
    const input = $("couponCodeInput");

    if (!input) return;

    const code = input.value.trim().toUpperCase();

    if (!code) {
        setCouponMessage("Please enter a coupon code.");
        return;
    }

    if (!currentUser) {
        setCouponMessage("Please sign in before applying a coupon.");
        return;
    }

    try {
        const couponSnap = await getDoc(doc(db, "coupons", code));

        if (!couponSnap.exists()) {
            setCouponMessage("Invalid coupon code.");
            return;
        }

        const couponData = couponSnap.data();

        if (!couponData.active) {
            setCouponMessage("This coupon is no longer active.");
            return;
        }

        if (couponData.singleUse && couponData.used) {
            setCouponMessage("This coupon has already been used.");
            return;
        }

        if (
            !couponData.singleUse &&
            couponData.maxUses &&
            (couponData.usedCount || 0) >= couponData.maxUses
        ) {
            setCouponMessage("This coupon has reached its usage limit.");
            return;
        }

        if (couponData.assignedTo && couponData.assignedTo !== currentUser.uid) {
            setCouponMessage("This coupon is not valid for your account.");
            return;
        }

        if (isCouponExpired(couponData)) {
            setCouponMessage("This coupon has expired.");
            return;
        }

        appliedCoupon = { code, ...couponData };

        input.disabled = true;
        $("applyCouponBtn").textContent = "Remove";
        $("applyCouponBtn").onclick = removeCoupon;

        setCouponMessage(
            `Coupon applied: ${couponData.discountPercent}% off`,
            false
        );

        renderCartModal();
        renderFloatingCart();

    } catch (error) {
        console.error("Coupon validation error:", error);
        setCouponMessage("Could not validate coupon. Try again.");
    }
}

function removeCoupon() {
    appliedCoupon = null;

    const input = $("couponCodeInput");

    if (input) {
        input.disabled = false;
        input.value = "";
    }

    const applyBtn = $("applyCouponBtn");

    if (applyBtn) {
        applyBtn.textContent = "Apply";
        applyBtn.onclick = applyCoupon;
    }

    const messageEl = $("couponMessage");

    if (messageEl) {
        messageEl.classList.add("hidden");
    }

    renderCartModal();
    renderFloatingCart();
}

// Add to cart
function addToCart(id) {
    const item = menuItems.find(
        item => item.id === id
    );

    if (!item) return;

    const existing = cart.find(
        cartItem => cartItem.id === id
    );

    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({
            ...item,
            menuItemId: item.menuItemId,
            qty: 1
        });
    }

    updateCartCount();
    renderCardControls(id);
    renderFloatingCart();
    animateCartButton();
    saveCart();

    showToast(
        `${item.name} added to cart`,
        "fa-check"
    );
}
window.addToCart = addToCart;

// Remove from cart
function removeFromCart(id) {
    const removed = cart.find(
        item => item.id === id
    );

    cart = cart.filter(
        item => item.id !== id
    );

    renderCartModal();
    updateCartCount();
    renderCardControls(id);
    renderFloatingCart();
    saveCart();

    if (removed) {
        showToast(
            `${removed.name} removed`,
            "fa-trash"
        );
    }
}
window.removeFromCart = removeFromCart;

// Change quantity
function changeCartQty(id, delta) {
    const item = cart.find(
        cartItem => cartItem.id === id
    );

    if (!item) return;

    item.qty += delta;

    if (item.qty <= 0) {
        cart = cart.filter(
            cartItem => cartItem.id !== id
        );
    }

    renderCartModal();
    updateCartCount();
    renderCardControls(id);
    renderFloatingCart();
    animateCartButton();
    saveCart();
}
window.changeCartQty = changeCartQty;

// ===== Floating Cart =====
function renderFloatingCart() {
    const panel = $("floatingCart");
    const mobileBar = $("mobileCartBar");

    const count = cart.reduce(
        (sum, item) => sum + item.qty,
        0
    );
    const totalLabel = `Rs. ${getCartTotal().toLocaleString()}`;

    if (mobileBar) {
        if (cart.length === 0) {
            mobileBar.classList.add("hidden");
        } else {
            mobileBar.classList.remove("hidden");
            const mCount = $("mobileCartBarCount");
            const mTotal = $("mobileCartBarTotal");
            if (mCount) mCount.textContent = count;
            if (mTotal) mTotal.textContent = totalLabel;
        }
    }

    if (!panel) return;

    if (cart.length === 0) {
        panel.classList.remove("is-visible");
        return;
    }

    panel.classList.add("is-visible");

    if ($("floatingCartCount")) {
        $("floatingCartCount").textContent = count;
    }

    if ($("floatingCartTotal")) {
        $("floatingCartTotal").textContent = totalLabel;
    }

    const legacyItemsContainer = $("floatingCartItems");
    if (legacyItemsContainer) {
        legacyItemsContainer.innerHTML =
            cart.map(item => {
                const safeId = escapeHTML(item.id);
                return `
                <div class="flex justify-between items-center text-sm rounded-2xl px-2 py-2 hover:bg-brand-cream transition-colors">

                    <div class="truncate pr-2">

                        <div class="font-bold text-brand-espresso truncate">
                            ${escapeHTML(item.name)}
                        </div>

                        <div class="text-brand-muted">
                            Rs. ${Number(item.price).toLocaleString()} × ${item.qty}
                        </div>

                    </div>

                    <div class="flex items-center gap-1 shrink-0">

                        <button
                            type="button"
                            data-action="qty"
                            data-id="${safeId}"
                            data-delta="-1"
                            aria-label="Decrease quantity of ${escapeHTML(item.name)}"
                            class="w-7 h-7 rounded-lg bg-brand-sand/70 hover:bg-brand-sand font-bold text-xs transition-colors pressable"
                        >
                            −
                        </button>

                        <span class="font-bold w-4 text-center text-xs tabular-nums">
                            ${item.qty}
                        </span>

                        <button
                            type="button"
                            data-action="qty"
                            data-id="${safeId}"
                            data-delta="1"
                            aria-label="Increase quantity of ${escapeHTML(item.name)}"
                            class="w-7 h-7 rounded-lg bg-brand-sand/70 hover:bg-brand-sand font-bold text-xs transition-colors pressable"
                        >
                            +
                        </button>

                    </div>

                </div>
            `;
            }).join("");
    }

    pricePulse(
        $("floatingCartTotal")
    );
}

// ===== Full Cart Modal =====
function renderCartModal() {
    const list = $("cartItemsList");
    const totalDisplay =
        $("cartTotalDisplay");

    if (!list || !totalDisplay) return;

    if (cart.length === 0) {

        list.innerHTML = `
            <div class="text-center text-gray-500 py-12">

                <div class="w-16 h-16 rounded-2xl bg-gray-100 text-gray-500 grid place-items-center mx-auto mb-4">
                    <i class="fa-solid fa-cart-shopping text-xl"></i>
                </div>

                <p class="font-semibold">
                    Your cart is empty.
                </p>

                <p class="text-sm mt-1">
                    Add something delicious from the menu.
                </p>

            </div>
        `;

    } else {

        list.innerHTML = cart.map(item => {
            const safeId = escapeHTML(item.id);
            const safeName = escapeHTML(item.name);
            return `
            <div class="flex justify-between items-center border border-gray-100 rounded-2xl p-3 hover:shadow-sm transition-all">

                <div class="min-w-0 pr-3">

                    <div class="font-bold text-gray-800 truncate">
                        ${safeName}
                    </div>

                    <div class="text-sm text-gray-500 mt-0.5">
                        Rs. ${Number(item.price).toLocaleString()}
                    </div>

                </div>

                <div class="flex items-center gap-1.5 shrink-0">

                    <button
                        type="button"
                        data-action="qty"
                        data-id="${safeId}"
                        data-delta="-1"
                        aria-label="Decrease quantity of ${safeName}"
                        class="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 font-bold transition-colors pressable"
                    >
                        −
                    </button>

                    <span class="font-black w-5 text-center">
                        ${item.qty}
                    </span>

                    <button
                        type="button"
                        data-action="qty"
                        data-id="${safeId}"
                        data-delta="1"
                        aria-label="Increase quantity of ${safeName}"
                        class="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 font-bold transition-colors pressable"
                    >
                        +
                    </button>

                    <button
                        type="button"
                        data-action="remove"
                        data-id="${safeId}"
                        class="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors pressable"
                        aria-label="Remove ${safeName}"
                    >
                        <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
                    </button>

                </div>

            </div>
        `;
        }).join("");
    }

    totalDisplay.textContent =
        `Rs. ${getCartTotal().toLocaleString()}`;

    const discountRow = $("cartDiscountRow");
    const discountDisplay = $("cartDiscountDisplay");

    if (discountRow && discountDisplay) {
        const discount = getDiscountAmount();

        discountRow.classList.toggle("hidden", discount <= 0);
        discountDisplay.textContent = `-Rs. ${discount.toLocaleString()}`;
    }

    pricePulse(totalDisplay);
}

// ===== Past Orders =====
function closePastOrdersModal() {
    if (pastOrdersListener) {
        pastOrdersListener();
        pastOrdersListener = null;
    }
    closeModal($("pastOrdersModal"));
}

function getOrderTimestampMs(timestamp) {
    if (!timestamp) return 0;
    if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
    if (typeof timestamp.seconds === "number") return timestamp.seconds * 1000;
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : 0;
}

function loadPastOrders() {
    if (!currentUser) {
        openModal($("authModal"));

        showToast(
            "Please sign in to view past orders.",
            "fa-user"
        );

        return;
    }

    const list = $("pastOrdersList");

    if (!list) return;

    list.innerHTML = `
        <div class="text-center text-gray-500 py-12">
            <i class="fa-solid fa-spinner fa-spin text-xl"></i>
        </div>
    `;

    openModal($("pastOrdersModal"));

    try {
        if (pastOrdersListener) {
            pastOrdersListener();
            pastOrdersListener = null;
        }

        pastOrdersListener = onSnapshot(
            query(
                collection(db, "onlineOrders"),
                where("customerUid", "==", currentUser.uid)
            ),
            (snapshot) => {
                pastOrdersCache = snapshot.docs
                    .map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    }))
                    .sort((a, b) => getOrderTimestampMs(b.createdAt) - getOrderTimestampMs(a.createdAt))
                    .slice(0, 20);

                renderPastOrders();
            },
            (error) => {
                console.error("Failed to load past orders:", error);

                list.innerHTML = `
                    <div class="text-center text-gray-500 py-12">
                        <p class="font-semibold text-gray-600">Couldn't load your past orders.</p>
                        <p class="text-sm mt-1">${error.code === "permission-denied"
                            ? "Permission denied. Please contact support."
                            : "Please try again later."}</p>
                    </div>
                `;
            }
        );

    } catch (error) {
        console.error("Failed to load past orders:", error);

        list.innerHTML = `
            <div class="text-center text-gray-500 py-12">
                <p class="font-semibold text-gray-600">Couldn't load your past orders.</p>
                <p class="text-sm mt-1">${error.code === "permission-denied"
                    ? "Permission denied. Please contact support."
                    : "Please try again later."}</p>
            </div>
        `;
    }
}

function renderPastOrders() {
    const list = $("pastOrdersList");

    if (!list) return;

    if (!pastOrdersCache.length) {
        list.innerHTML = `
            <div class="text-center text-gray-500 py-12">
                <p class="font-semibold">No past orders yet.</p>
            </div>
        `;

        return;
    }

    list.innerHTML = pastOrdersCache.map(order => {
        const date = order.createdAt?.toDate
            ? order.createdAt.toDate().toLocaleString()
            : "";

        const itemsSummary = (order.items || [])
            .map(item => `${item.name} × ${item.qty}`)
            .join(", ");

        const status = String(order.status || "PENDING");
        const orderType = String(order.orderType || "DELIVERY");
        const isActive = !["COMPLETED", "REJECTED"].includes(status);

        return `
            <div class="border border-gray-100 rounded-2xl p-4 hover:shadow-md transition-shadow">
                <div class="flex justify-between items-start gap-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="status-badge status-${escapeHTML(status.toLowerCase())}">
                                <i class="fa-solid ${escapeHTML(getStatusIcon(status))} mr-1" aria-hidden="true"></i>
                                ${escapeHTML(getStatusLabel(status, orderType))}
                            </span>
                            ${isActive ? '<span class="text-xs text-brand-red font-semibold animate-pulse">● Live</span>' : ""}
                        </div>
                        <div class="text-xs text-brand-muted mb-1">${escapeHTML(date)}</div>
                        <div class="text-sm text-brand-espresso mt-1">${escapeHTML(itemsSummary)}</div>
                        ${order.estimatedReadyTime && isActive ? `
                            <div class="text-xs text-blue-600 mt-2 flex items-center gap-1">
                                <i class="fa-solid fa-clock" aria-hidden="true"></i>
                                <span>Ready by ${escapeHTML(formatEstimatedTime(order.estimatedReadyTime))}</span>
                            </div>
                        ` : ""}
                    </div>
                    <div class="text-right shrink-0">
                        <div class="font-black text-brand-espresso tabular-nums">Rs. ${Number(order.total || 0).toLocaleString()}</div>
                        ${!isActive ? `
                            <button
                                type="button"
                                data-action="repeat-order"
                                data-id="${escapeHTML(order.id)}"
                                class="mt-2 text-xs bg-brand-espresso text-white px-3 py-1.5 rounded-full hover:bg-brand-red transition-colors pressable"
                            >
                                Repeat Order
                            </button>
                        ` : ""}
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

function repeatOrder(orderId) {
    const order = pastOrdersCache.find(o => o.id === orderId);

    if (!order) return;

    let addedCount = 0;

    (order.items || []).forEach(orderItem => {
        const menuItem = menuItems.find(
            item => item.id === (orderItem.menuItemId || orderItem.id)
        );

        if (!menuItem) return;

        const existing = cart.find(item => item.id === menuItem.id);

        if (existing) {
            existing.qty += orderItem.qty;
        } else {
            cart.push({ ...menuItem, qty: orderItem.qty });
        }

        renderCardControls(menuItem.id);
        addedCount += 1;
    });

    if (addedCount < (order.items || []).length) {
        showToast(
            "Some items are no longer available and were skipped.",
            "fa-circle-exclamation"
        );
    } else {
        showToast("Items added to cart", "fa-cart-shopping");
    }

    saveCart();
    updateCartCount();
    renderFloatingCart();
    renderCartModal();

    closePastOrdersModal();
    openModal($("cartModal"));
}
window.repeatOrder = repeatOrder;

// ===== Order Tracking =====

// Track order by ID (uses non-PII /orderTracking projection for guests; /onlineOrders when signed in)
async function trackOrderByID(orderId) {
    const trimmed = String(orderId ?? "").trim();
    if (!trimmed || trimmed.includes("/")) {
        showToast("Please enter a valid order ID", "fa-circle-exclamation");
        return;
    }

    const trackingContent = $("trackingContent");
    const trackingError = $("trackingError");

    if (!trackingContent || !trackingError) return;

    trackingContent.innerHTML = `
        <div class="text-center py-12">
            <i class="fa-solid fa-spinner fa-spin text-3xl text-brand-red"></i>
            <p class="mt-3 text-brand-muted">Loading order...</p>
        </div>
    `;
    trackingError.classList.add("hidden");

    const preferredCollection = currentUser ? "onlineOrders" : "orderTracking";

    try {
        let collectionName = preferredCollection;
        let orderDoc = await getDoc(doc(db, collectionName, trimmed));

        if (!orderDoc.exists() && collectionName === "onlineOrders") {
            collectionName = "orderTracking";
            orderDoc = await getDoc(doc(db, collectionName, trimmed));
        }

        if (!orderDoc.exists()) {
            trackingContent.innerHTML = "";
            trackingError.textContent = "Order not found. Please check your order ID.";
            trackingError.classList.remove("hidden");
            return;
        }

        const orderData = { id: orderDoc.id, ...orderDoc.data() };
        setupOrderTrackingListener(trimmed, orderData, collectionName);

    } catch (error) {
        if (preferredCollection === "onlineOrders" && error.code === "permission-denied") {
            try {
                const fallbackDoc = await getDoc(doc(db, "orderTracking", trimmed));
                if (fallbackDoc.exists()) {
                    setupOrderTrackingListener(
                        trimmed,
                        { id: fallbackDoc.id, ...fallbackDoc.data() },
                        "orderTracking"
                    );
                    return;
                }
                trackingContent.innerHTML = "";
                trackingError.textContent = "Order not found. Please check your order ID.";
                trackingError.classList.remove("hidden");
                return;
            } catch (fallbackErr) {
                console.error("Error tracking fallback order:", fallbackErr);
            }
        }

        console.error("Error tracking order:", error);
        trackingContent.innerHTML = "";
        trackingError.textContent = "Could not load order. Please try again.";
        trackingError.classList.remove("hidden");
    }
}
window.trackOrderByID = trackOrderByID;

function setupOrderTrackingListener(orderId, initialData, collectionName = "orderTracking") {
    if (activeOrderListener) {
        activeOrderListener();
        activeOrderListener = null;
    }

    renderOrderTimeline(initialData);

    activeOrderListener = onSnapshot(
        doc(db, collectionName, orderId),
        (docSnapshot) => {
            if (docSnapshot.exists()) {
                const orderData = { id: docSnapshot.id, ...docSnapshot.data() };
                renderOrderTimeline(orderData);
            }
        },
        (error) => {
            console.error("Order tracking listener error:", error);
        }
    );
}

// Render order timeline UI
function renderOrderTimeline(order) {
    const trackingContent = $("trackingContent");
    if (!trackingContent) return;

    const orderType = order.orderType || "DELIVERY";
    const currentStatus = order.status || "PENDING";
    const progress = getProgressPercentage(currentStatus, orderType);

    const allSteps = {
        DELIVERY: [
            { status: "PENDING", label: "Order Placed", icon: "fa-clock" },
            { status: "ACCEPTED", label: "Order Confirmed", icon: "fa-check-circle" },
            { status: "PREPARING", label: "Being Prepared", icon: "fa-fire" },
            { status: "OUT_FOR_DELIVERY", label: "Out for Delivery", icon: "fa-motorcycle" },
            { status: "COMPLETED", label: "Delivered", icon: "fa-circle-check" }
        ],
        TAKEAWAY: [
            { status: "PENDING", label: "Order Placed", icon: "fa-clock" },
            { status: "ACCEPTED", label: "Order Confirmed", icon: "fa-check-circle" },
            { status: "PREPARING", label: "Being Prepared", icon: "fa-fire" },
            { status: "COMPLETED", label: "Ready for Pickup", icon: "fa-circle-check" }
        ]
    };

    const steps = allSteps[orderType] || allSteps.DELIVERY;
    const currentStepIndex = steps.findIndex(s => s.status === currentStatus);

    if (currentStatus === "REJECTED") {
        trackingContent.innerHTML = `
            <div class="text-center py-8 px-6">
                <div class="w-16 h-16 rounded-full bg-red-50 text-red-500 grid place-items-center mx-auto mb-4">
                    <i class="fa-solid fa-times-circle text-2xl"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-900 mb-2">Order Cancelled</h3>
                <p class="text-gray-600">This order has been cancelled.</p>
                ${order.rejectionReason ? `<p class="text-sm text-gray-500 mt-2">Reason: ${escapeHTML(order.rejectionReason)}</p>` : ""}
            </div>
        `;
        return;
    }

    const stepsHTML = steps.map((step, index) => {
        const isCompleted = index <= currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const timestamp =
            order[`${step.status.toLowerCase()}At`] ||
            (step.status === "OUT_FOR_DELIVERY" ? order.outForDeliveryAt : undefined);

        return `
            <div class="timeline-step ${isCompleted ? "completed" : ""} ${isCurrent ? "current" : ""}">
                <div class="timeline-icon ${isCompleted ? "bg-brand-red text-white" : "bg-brand-sand text-brand-muted"}">
                    <i class="fa-solid ${escapeHTML(step.icon)}" aria-hidden="true"></i>
                </div>
                <div class="flex items-start justify-between">
                    <div>
                        <div class="font-bold text-brand-espresso">${escapeHTML(step.label)}</div>
                        ${timestamp ? `<div class="text-xs text-brand-muted mt-1">${escapeHTML(formatEstimatedTime(timestamp))}</div>` : ""}
                    </div>
                    ${isCurrent ? '<span class="status-pulse"></span>' : ""}
                </div>
            </div>
        `;
    }).join("");

    trackingContent.innerHTML = `
        <div class="p-6">
            <!-- Progress Bar -->
            <div class="mb-8">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-sm font-semibold text-brand-espresso">Order Progress</span>
                    <span class="text-sm font-bold text-brand-red tabular-nums">${Math.round(progress)}%</span>
                </div>
                <div class="h-2 bg-brand-sand rounded-full overflow-hidden">
                    <div class="h-full bg-gradient-to-r from-brand-red to-brand-gold transition-all duration-500" style="width: ${progress}%"></div>
                </div>
            </div>

            <!-- Current Status -->
            <div class="mb-6 p-4 rounded-2xl bg-brand-redSoft border border-brand-red/15">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-brand-red text-white grid place-items-center">
                        <i class="fa-solid ${escapeHTML(getStatusIcon(currentStatus))}" aria-hidden="true"></i>
                    </div>
                    <div>
                        <div class="text-xs text-brand-redDark font-semibold">Current Status</div>
                        <div class="text-lg font-black text-brand-espresso">${escapeHTML(getStatusLabel(currentStatus, orderType))}</div>
                    </div>
                </div>
            </div>

            ${order.estimatedReadyTime ? `
                <div class="mb-6 p-4 rounded-2xl bg-blue-50 border border-blue-100">
                    <div class="flex items-center gap-2 text-sm">
                        <i class="fa-solid fa-clock text-blue-600" aria-hidden="true"></i>
                        <span class="text-gray-700">Estimated ready by</span>
                        <span class="font-bold text-blue-600">${escapeHTML(formatEstimatedTime(order.estimatedReadyTime))}</span>
                    </div>
                </div>
            ` : ""}

            <!-- Timeline Steps -->
            <div class="timeline">
                ${stepsHTML}
            </div>

            <!-- Order Details -->
            <div class="mt-6 pt-6 border-t border-gray-200">
                <div class="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Order Details</div>
                <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                        <span class="text-gray-600">Order ID</span>
                        <span class="font-mono text-gray-900">${escapeHTML(order.orderId || order.id)}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">Type</span>
                        <span class="font-semibold text-gray-900">${escapeHTML(orderType)}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">Total</span>
                        <span class="font-bold text-gray-900">Rs. ${Number(order.total || 0).toLocaleString()}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Clean up listener when modal closes
function closeTrackOrderModal() {
    if (activeOrderListener) {
        activeOrderListener();
        activeOrderListener = null;
    }
    closeModal($("trackOrderModal"));
    if ($("orderIdInput")) $("orderIdInput").value = "";
    if ($("trackingContent")) {
        $("trackingContent").innerHTML = `
            <div class="text-center py-12 text-gray-500">
                <i class="fa-solid fa-magnifying-glass text-3xl mb-3"></i>
                <p class="font-semibold">Enter your order ID to track</p>
            </div>
        `;
    }
    $("trackingError")?.classList.add("hidden");
    $("trackOrderIdSection")?.classList.remove("hidden");
}
window.closeTrackOrderModal = closeTrackOrderModal;

// ===== Order Type =====
function setOrderType(type) {
    currentOrderType = type === "TAKEAWAY" ? "TAKEAWAY" : "DELIVERY";

    const deliveryBtn =
        $("orderTypeDelivery");

    const takeawayBtn =
        $("orderTypeTakeaway");

    const addressInput =
        $("checkoutAddress");

    const heroDeliveryBtn = $("heroOrderTypeDelivery");
    const heroTakeawayBtn = $("heroOrderTypeTakeaway");
    const heroNote = $("heroOrderModeNote");

    const heroActive =
        "flex-1 sm:flex-initial px-4 py-2.5 min-h-[42px] rounded-xl text-xs sm:text-sm font-bold bg-brand-red text-white shadow-sm transition-colors";
    const heroInactive =
        "flex-1 sm:flex-initial px-4 py-2.5 min-h-[42px] rounded-xl text-xs sm:text-sm font-bold text-brand-espresso hover:text-brand-red transition-colors";

    if (heroDeliveryBtn && heroTakeawayBtn) {
        const isDelivery = currentOrderType === "DELIVERY";
        heroDeliveryBtn.className = isDelivery ? heroActive : heroInactive;
        heroTakeawayBtn.className = isDelivery ? heroInactive : heroActive;
        heroDeliveryBtn.setAttribute("aria-pressed", String(isDelivery));
        heroTakeawayBtn.setAttribute("aria-pressed", String(!isDelivery));
    }

    if (heroNote) {
        heroNote.textContent = currentOrderType === "DELIVERY"
            ? "Delivery · Minimum Rs. 500 · Typical ETA 25–35 min"
            : "Takeaway · No minimum order · Ready in 15–20 min";
    }

    if (!deliveryBtn ||
        !takeawayBtn ||
        !addressInput) return;

    const active =
        "flex-1 py-2.5 rounded-xl text-sm font-semibold bg-brand-red text-white shadow-sm transition-all";

    const inactive =
        "flex-1 py-2.5 rounded-xl text-sm font-semibold text-brand-muted transition-all";

    if (currentOrderType === "DELIVERY") {

        deliveryBtn.className = active;
        takeawayBtn.className = inactive;

        addressInput.classList.remove("hidden");
        addressInput.required = true;

        $("deliveryInfoNote")?.classList.remove("hidden");

    } else {

        takeawayBtn.className = active;
        deliveryBtn.className = inactive;

        addressInput.classList.add("hidden");
        addressInput.required = false;

        $("deliveryInfoNote")?.classList.add("hidden");
    }
}

// ===== POS Order Integration =====
const pushOrderToPOS = async (orderData) => {
    try {
        const docRef = await addDoc(
            collection(db, "onlineOrders"),
            {
                ...orderData,
                status: "PENDING",
                source: "website",
                createdAt: serverTimestamp()
            }
        );

        // Best-effort non-PII projection for guest tracking if Cloud Functions are not yet deployed
        try {
            await setDoc(doc(db, "orderTracking", docRef.id), {
                orderId: docRef.id,
                status: "PENDING",
                orderType: orderData.orderType,
                total: orderData.total,
                createdAt: serverTimestamp()
            });
        } catch (trackingErr) {
            console.warn("Order tracking projection fallback skipped:", trackingErr?.code || trackingErr);
        }

        return docRef.id;

    } catch (error) {
        console.error("POS Integration Error:", error?.code || error);

        showToast(
            "Could not place order. Try again.",
            "fa-circle-exclamation"
        );

        return null;
    }
};

// ===== Place Order =====
async function placeOrder() {
    if (isPlacingOrder) {
        return;
    }

    if (lastOrderPlacedAt > 0 && Date.now() - lastOrderPlacedAt < 5000) {
        showToast(
            "Order already submitted. Please wait a moment before ordering again.",
            "fa-clock"
        );
        return;
    }

    if (cart.length === 0) {
        showToast(
            "Your cart is empty.",
            "fa-cart-shopping"
        );
        return;
    }

    if (!currentUser) {

        closeModal($("cartModal"));
        openModal($("authModal"));

        showToast(
            "Please sign in to place your order.",
            "fa-user"
        );

        return;
    }

    const name =
        $("checkoutName").value.trim()
        || currentUser.email.split("@")[0];

    const phone =
        $("checkoutPhone").value.trim();

    const address =
        currentOrderType === "DELIVERY"
            ? $("checkoutAddress").value.trim()
            : "";

    const digitsCount = phone.replace(/\D/g, "").length;
    if (!phone || !/^\+?[\d\s\-()]{7,20}$/.test(phone) || digitsCount < 7) {

        $("checkoutPhone").focus();

        showToast(
            "Please enter a valid phone number.",
            "fa-phone"
        );

        return;
    }

    if (
        currentOrderType === "DELIVERY" &&
        !address
    ) {

        $("checkoutAddress").focus();

        showToast(
            "Please enter your delivery address.",
            "fa-location-dot"
        );

        return;
    }

    if (currentOrderType === "DELIVERY" && getCartSubtotal() < 500) {
        showToast(
            "Minimum order for delivery is Rs. 500.",
            "fa-circle-exclamation"
        );
        return;
    }

    const placeBtn =
        $("placeOrderBtn");

    isPlacingOrder = true;
    placeBtn.disabled = true;
    placeBtn.classList.add("loading");

    const notes = ($("checkoutNotes")?.value || "").trim().slice(0, 250);

    const orderData = {
        items: cart.map(item => ({
            id: item.id,
            menuItemId:
                item.menuItemId || item.id,
            name: item.name,
            price: item.price,
            qty: item.qty
        })),

        subtotal: getCartSubtotal(),

        discountAmount: getDiscountAmount(),

        couponCode: appliedCoupon?.code ?? null,

        total: getCartTotal(),

        orderType:
            currentOrderType,

        ...(notes ? { notes } : {}),

        customer: {
            name,
            phone,
            address
        },

        customerUid:
            currentUser.uid
    };

    let createdOrderId = null;
    try {
        createdOrderId = await pushOrderToPOS(orderData);
        if (createdOrderId) {
            lastOrderPlacedAt = Date.now();
            await consumeCouponAndTrackLoyalty();
        }
    } finally {
        placeBtn.classList.remove("loading");
        if (!createdOrderId) {
            isPlacingOrder = false;
            placeBtn.disabled = false;
        }
    }

    if (!createdOrderId) {
        return;
    }

    lastConfirmedOrderId = createdOrderId;
    try {
        localStorage.setItem("hungryBirdsLastOrderId", createdOrderId);
    } catch {}

    const confirmedTotal = orderData.total;
    const confirmedMode = currentOrderType === "TAKEAWAY" ? "Takeaway" : "Delivery";

    placeBtn.classList.add("success");

    setTimeout(() => {

        placeBtn.classList.remove("success");
        placeBtn.disabled = false;
        isPlacingOrder = false;

        clearCart();
        removeCoupon();

        updateCartCount();
        renderFloatingCart();
        renderCartModal();
        menuItems.forEach(item => renderCardControls(item.id));

        closeModal(
            $("cartModal")
        );

        showToast(
            `Order placed! ID: ${createdOrderId}`,
            "fa-circle-check"
        );

        $("checkoutPhone").value = "";
        $("checkoutAddress").value = "";
        if ($("checkoutNotes")) $("checkoutNotes").value = "";

        if ($("confirmedOrderId")) $("confirmedOrderId").textContent = createdOrderId;
        if ($("confirmedOrderSummary")) {
            $("confirmedOrderSummary").textContent =
                `${confirmedMode} · Total Rs. ${Number(confirmedTotal).toLocaleString()}. Save or copy your Order ID below to track live updates.`;
        }
        openModal($("orderConfirmationModal"));

    }, 1400);
}

// Marks used coupon consumed and increments customer order counter.
// Loyalty coupon issuance is handled server-side via Cloud Functions (onOrderCreated).
async function consumeCouponAndTrackLoyalty() {
    try {
        if (appliedCoupon) {
            const couponRef = doc(db, "coupons", appliedCoupon.code);

            if (appliedCoupon.singleUse) {
                await updateDoc(couponRef, { active: false, used: true });
            } else {
                await updateDoc(couponRef, { usedCount: increment(1) });
            }
        }

        const userRef = doc(db, "users", currentUser.uid);

        await setDoc(
            userRef,
            {
                email: currentUser.email,
                orderCount: increment(1),
                updatedAt: serverTimestamp()
            },
            { merge: true }
        );

    } catch (error) {
        console.error("Loyalty/coupon tracking error:", error);
        showToast(
            "Order placed, though loyalty/coupon sync had a temporary issue.",
            "fa-circle-exclamation"
        );
    }
}

// ===== Authentication State =====
onAuthStateChanged(
    auth,
    (user) => {

        const loginBtn =
            $("loginBtn");

        const userProfile =
            $("userProfile");

        if (!loginBtn ||
            !userProfile) return;

        if (user) {

            currentUser = user;

            loginBtn.classList.add(
                "hidden"
            );

            userProfile.classList.remove(
                "hidden"
            );

            userProfile.classList.add(
                "flex"
            );

            $("userNameDisplay").textContent =
                user.email.split("@")[0];

        } else {

            currentUser = null;
            pastOrdersCache = [];
            removeCoupon();

            if (pastOrdersListener) {
                pastOrdersListener();
                pastOrdersListener = null;
            }
            if (activeOrderListener) {
                activeOrderListener();
                activeOrderListener = null;
            }

            if ($("pastOrdersList")) $("pastOrdersList").innerHTML = "";
            if ($("myCouponsContent")) $("myCouponsContent").innerHTML = "";

            if ($("pastOrdersModal")?.classList.contains("is-open")) {
                closePastOrdersModal();
            }
            if ($("myCouponsModal")?.classList.contains("is-open")) {
                closeModal($("myCouponsModal"));
            }

            loginBtn.classList.remove(
                "hidden"
            );

            userProfile.classList.add(
                "hidden"
            );

            userProfile.classList.remove(
                "flex"
            );
        }
    }
);

// ===== Event Wiring =====
$("brandBtn")?.addEventListener(
    "click",
    () => {

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }
);

$("browseMenuBtn")?.addEventListener(
    "click",
    () => {

        $("menuSection")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
);

function openCartFlow() {
    renderCartModal();
    openModal($("cartModal"));
}

function openTrackOrderFlow() {
    openModal($("trackOrderModal"));
    if (currentUser) {
        autoTrackActiveOrder();
    } else {
        const input = $("orderIdInput");
        if (input && !input.value) {
            try {
                const savedId = lastConfirmedOrderId || localStorage.getItem("hungryBirdsLastOrderId") || "";
                if (savedId) input.value = savedId;
            } catch {}
        }
    }
}

$("openLegalModalBtn")?.addEventListener("click", () => openModal($("legalModal")));
$("closeLegalModalBtn")?.addEventListener("click", () => closeModal($("legalModal")));
$("closeOrderConfirmModalBtn")?.addEventListener("click", () => closeModal($("orderConfirmationModal")));

$("cartBtn")?.addEventListener("click", openCartFlow);

// Track Order button & modal controls
$("trackOrderBtn")?.addEventListener("click", openTrackOrderFlow);

$("closeTrackOrderModalBtn")?.addEventListener("click", closeTrackOrderModal);
$("trackOrderSubmitBtn")?.addEventListener("click", () => {
    trackOrderByID($("orderIdInput")?.value);
});
$("orderIdInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        trackOrderByID(event.target.value);
    }
});

function toggleCategoryExpand(categoryId) {
    if (!categoryId) return;

    const wasExpanded = expandedCategoryIds.has(categoryId);
    if (wasExpanded) {
        expandedCategoryIds.delete(categoryId);
    } else {
        expandedCategoryIds.add(categoryId);
    }

    renderMenu(menuItems, activeCategoryId);

    if (wasExpanded) {
        const sectionEl = Array.from(
            document.querySelectorAll(".menu-category-section")
        ).find(el => el.dataset.categorySection === categoryId);

        if (sectionEl && sectionEl.getBoundingClientRect().top < 140) {
            sectionEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }

    const updatedBtn = Array.from(
        document.querySelectorAll('[data-action="toggle-category-expand"]')
    ).find(el => el.dataset.categoryId === categoryId);
    updatedBtn?.focus?.({ preventScroll: true });
}

function openItemDetailModal(id) {
    const item = menuItems.find(m => m.id === id);
    const modal = $("itemDetailModal");
    if (!item || !modal) return;

    activeDetailItemId = item.id;
    const categoryName =
        categories.find(c => c.id === item.categoryId)?.name || "Menu Item";

    const imgEl = $("itemDetailImage");
    if (imgEl) {
        imgEl.src = item.img || FALLBACK_SVG_IMAGE;
        imgEl.alt = item.name;
        imgEl.addEventListener("error", () => {
            imgEl.src = FALLBACK_SVG_IMAGE;
        }, { once: true });
    }
    if ($("itemDetailCategory")) $("itemDetailCategory").textContent = categoryName;
    if ($("itemDetailTitle")) $("itemDetailTitle").textContent = item.name;
    if ($("itemDetailDescription")) {
        const desc = typeof item.description === "string" ? item.description.trim() : "";
        $("itemDetailDescription").textContent = desc || "Prepared fresh to order · Delivery & Takeaway available";
    }
    if ($("itemDetailPrice")) $("itemDetailPrice").textContent = `Rs. ${Number(item.price).toLocaleString()}`;
    if ($("itemDetailControls")) $("itemDetailControls").innerHTML = cardControlsHTML(item.id);

    openModal(modal);
}

function closeItemDetailModal() {
    activeDetailItemId = null;
    closeModal($("itemDetailModal"));
}

function clearMenuSearch() {
    menuSearchQuery = "";
    const input = $("menuSearchInput");
    if (input) input.value = "";
    $("menuSearchClearBtn")?.classList.add("hidden");
    renderMenu(menuItems, activeCategoryId);
}

$("menuSearchInput")?.addEventListener("input", (event) => {
    menuSearchQuery = event.target.value || "";
    $("menuSearchClearBtn")?.classList.toggle("hidden", menuSearchQuery.trim().length === 0);
    renderMenu(menuItems, activeCategoryId);
});

$("menuSearchClearBtn")?.addEventListener("click", () => {
    clearMenuSearch();
    $("menuSearchInput")?.focus();
});

$("closeItemDetailModalBtn")?.addEventListener("click", closeItemDetailModal);

// Delegated click handlers for dynamically rendered cards, carts, past orders, and coupons
document.addEventListener("click", (event) => {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;

    const { action, id, delta, code, slide, categoryId, orderType } = actionEl.dataset;

    if (action === "add" && id) {
        addToCart(id);
    } else if (action === "qty" && id) {
        changeCartQty(id, Number(delta));
    } else if (action === "remove" && id) {
        removeFromCart(id);
    } else if (action === "open-item-detail" && id) {
        openItemDetailModal(id);
    } else if (action === "copy-confirmed-order") {
        const orderIdToCopy = lastConfirmedOrderId || $("confirmedOrderId")?.textContent?.trim() || "";
        if (orderIdToCopy && orderIdToCopy !== "-") {
            navigator.clipboard?.writeText(orderIdToCopy)
                .then(() => showToast("Order ID copied!", "fa-copy"))
                .catch(() => showToast("Select and copy the Order ID above.", "fa-circle-exclamation"));
        }
    } else if (action === "track-confirmed-order") {
        const targetOrderId = lastConfirmedOrderId || $("confirmedOrderId")?.textContent?.trim() || "";
        closeModal($("orderConfirmationModal"));
        openModal($("trackOrderModal"));
        if (targetOrderId && targetOrderId !== "-") {
            if ($("orderIdInput")) $("orderIdInput").value = targetOrderId;
            trackOrderByID(targetOrderId);
        } else if (currentUser) {
            autoTrackActiveOrder();
        }
    } else if (action === "clear-menu-search") {
        clearMenuSearch();
    } else if (action === "set-order-type" && orderType) {
        setOrderType(orderType);
    } else if (action === "open-ai-chat") {
        $("aiChatFab")?.click();
    } else if (action === "toggle-category-expand" && categoryId) {
        toggleCategoryExpand(categoryId);
    } else if (action === "repeat-order" && id) {
        repeatOrder(id);
    } else if (action === "copy-coupon" && code) {
        navigator.clipboard?.writeText(code)
            .then(() => showToast("Coupon code copied!", "fa-copy"))
            .catch(() => showToast("Could not copy code automatically.", "fa-circle-exclamation"));
    } else if (action === "go-slide" && slide !== undefined) {
        goToBannerSlide(Number(slide));
    } else if (action === "retry-menu") {
        initMenu();
    } else if (action === "reload-page") {
        location.reload();
    }
});

function autoTrackActiveOrder() {
    const trackingContent = $("trackingContent");
    const trackingError = $("trackingError");
    const idInputSection = $("trackOrderIdSection");

    if (!trackingContent) return;

    trackingContent.innerHTML = `
        <div class="text-center py-12">
            <i class="fa-solid fa-spinner fa-spin text-3xl text-brand-red"></i>
            <p class="mt-3 text-brand-muted">Looking for your active order...</p>
        </div>
    `;
    trackingError?.classList.add("hidden");

    if (idInputSection) idInputSection.classList.add("hidden");

    if (activeOrderListener) {
        activeOrderListener();
        activeOrderListener = null;
    }

    activeOrderListener = onSnapshot(
        query(
            collection(db, "onlineOrders"),
            where("customerUid", "==", currentUser.uid)
        ),
        (snapshot) => {
            const allOrders = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => getOrderTimestampMs(b.createdAt) - getOrderTimestampMs(a.createdAt));

            const activeOrder = allOrders.find(
                o => !["COMPLETED", "REJECTED"].includes(o.status || "PENDING")
            );

            if (!activeOrder) {
                idInputSection?.classList.remove("hidden");
                trackingContent.innerHTML = `
                    <div class="text-center py-12 text-gray-500">
                        <i class="fa-solid fa-check-circle text-3xl mb-3 text-green-500"></i>
                        <p class="font-semibold text-gray-600">No active orders right now.</p>
                        <p class="text-sm mt-1">Place an order or enter an Order ID above to track it in real time.</p>
                    </div>
                `;
                return;
            }

            idInputSection?.classList.add("hidden");
            renderOrderTimeline(activeOrder);
        },
        (error) => {
            console.error("Auto-track error:", error);
            idInputSection?.classList.remove("hidden");
            trackingContent.innerHTML = `
                <div class="text-center py-10 px-6 text-gray-500">
                    <i class="fa-solid fa-magnifying-glass text-3xl mb-3 text-gray-400"></i>
                    <p class="font-semibold text-gray-700">Could not load active orders automatically.</p>
                    <p class="text-sm mt-1">You can enter your Order ID above to track it.</p>
                </div>
            `;
            if (trackingError) {
                trackingError.textContent = "Could not load your active order automatically. Please track by Order ID above.";
                trackingError.classList.remove("hidden");
            }
        }
    );
}

// ===== Mobile Bottom Nav =====
$("bottomNavHome")?.addEventListener(
    "click",
    () => {

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }
);

$("bottomNavMenu")?.addEventListener(
    "click",
    () => {

        $("menuSection")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
);

$("bottomNavCart")?.addEventListener(
    "click",
    () => {

        renderCartModal();
        openModal(
            $("cartModal")
        );
    }
);

$("closeCartModal")?.addEventListener(
    "click",
    () => {
        closeModal(
            $("cartModal")
        );
    }
);

$("floatingCheckoutBtn")?.addEventListener(
    "click",
    openCartFlow
);

$("mobileCartBar")?.addEventListener(
    "click",
    openCartFlow
);

// Delivery
$("orderTypeDelivery")?.addEventListener(
    "click",
    () => {
        setOrderType("DELIVERY");
    }
);

// Takeaway
$("orderTypeTakeaway")?.addEventListener(
    "click",
    () => {
        setOrderType("TAKEAWAY");
    }
);

// Place order
$("placeOrderBtn")?.addEventListener(
    "click",
    placeOrder
);

// Login
$("loginBtn")?.addEventListener(
    "click",
    () => {
        openModal(
            $("authModal")
        );
    }
);

// Close Auth
$("closeAuthModal")?.addEventListener(
    "click",
    () => {
        closeModal(
            $("authModal")
        );
    }
);

// Forgot password
$("forgotPasswordBtn")?.addEventListener("click", async () => {
    const email = $("authEmail")?.value.trim();
    if (!email) {
        $("authEmail")?.focus();
        showToast("Enter your email first to reset password.", "fa-envelope");
        return;
    }

    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Password reset email sent if that account exists.", "fa-envelope");
    } catch (error) {
        console.error("Password reset error:", error?.code || error);
        showToast(getFriendlyAuthError(error), "fa-circle-exclamation");
    }
});

// Toggle login/register
$("toggleAuthMode")?.addEventListener(
    "click",
    (event) => {

        event.preventDefault();

        isLoginMode =
            !isLoginMode;

        $("authTitle").textContent =
            isLoginMode
                ? "Welcome Back"
                : "Create Account";

        $("authSubmitBtn").textContent =
            isLoginMode
                ? "Sign In"
                : "Register";

        $("authToggleText").textContent =
            isLoginMode
                ? "New customer?"
                : "Already have an account?";

        $("toggleAuthMode").textContent =
            isLoginMode
                ? "Create an account"
                : "Sign in instead";

        $("authPassword")?.setAttribute(
            "autocomplete",
            isLoginMode ? "current-password" : "new-password"
        );
    }
);

// Auth form
$("authForm")?.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();

        const email =
            $("authEmail").value.trim();

        const password =
            $("authPassword").value;

        if (!isLoginMode && password.length < 6) {
            showToast("Password must be at least 6 characters.", "fa-circle-exclamation");
            return;
        }

        const submitBtn =
            $("authSubmitBtn");

        const originalText =
            submitBtn.textContent;

        submitBtn.disabled = true;

        submitBtn.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin mr-2"></i>
            ${isLoginMode
                ? "Signing In..."
                : "Creating..."
            }
        `;

        try {

            if (isLoginMode) {

                await signInWithEmailAndPassword(
                    auth,
                    email,
                    password
                );

                showToast(
                    "Welcome back!",
                    "fa-hand-wave"
                );

            } else {

                await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password
                );

                showToast(
                    "Account created!",
                    "fa-user-check"
                );
            }

            closeModal(
                $("authModal")
            );

            $("authForm").reset();

        } catch (error) {

            console.error(
                "Authentication error:",
                error?.code || error
            );

            showToast(
                getFriendlyAuthError(error),
                "fa-circle-exclamation"
            );

        } finally {

            submitBtn.disabled =
                false;

            submitBtn.textContent =
                originalText;
        }
    }
);

// Logout
$("logoutBtn")?.addEventListener(
    "click",
    async () => {

        try {

            await signOut(auth);

            showToast(
                "Signed out successfully.",
                "fa-right-from-bracket"
            );

        } catch (error) {

            console.error(error);

            showToast(
                "Could not sign out.",
                "fa-circle-exclamation"
            );
        }
    }
);

// Past orders
$("pastOrdersBtn")?.addEventListener(
    "click",
    loadPastOrders
);

// Close past orders
$("closePastOrdersModal")?.addEventListener(
    "click",
    closePastOrdersModal
);

// ===== My Coupons =====
async function loadMyCoupons() {
    if (!currentUser) {
        openModal($("authModal"));
        return;
    }
    const content = $("myCouponsContent");
    if (!content) return;

    content.innerHTML = `
        <div class="text-center py-12 text-gray-500">
            <i class="fa-solid fa-spinner fa-spin text-2xl mb-3"></i>
            <p>Loading your coupons…</p>
        </div>
    `;
    openModal($("myCouponsModal"));

    try {
        const uid = currentUser.uid;
        const [userSnap, couponsSnap, ordersSnap] = await Promise.all([
            getDoc(doc(db, "users", uid)),
            getDocs(query(collection(db, "coupons"), where("assignedTo", "==", uid))),
            getDocs(query(
                collection(db, "onlineOrders"),
                where("customerUid", "==", uid)
            ))
        ]);

        const orderCount = userSnap.data()?.orderCount ?? 0;
        const coupons = couponsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const couponOrders = ordersSnap.docs
            .map(d => d.data())
            .filter(o => o.couponCode && o.discountAmount > 0)
            .sort((a, b) => getOrderTimestampMs(b.createdAt) - getOrderTimestampMs(a.createdAt));

        renderMyCoupons(orderCount, coupons, couponOrders);
    } catch (err) {
        console.error("loadMyCoupons error:", err);
        content.innerHTML = `<div class="text-center py-12 text-red-500"><p>Could not load coupons. Please try again.</p></div>`;
    }
}

function renderMyCoupons(orderCount, coupons, couponOrders) {
    const content = $("myCouponsContent");
    if (!content) return;

    const cycleEarned = orderCount > 0 && orderCount % 10 === 0;
    const progress = cycleEarned ? 10 : orderCount % 10;
    const remainingOrders = 10 - progress;
    const pct = (progress / 10) * 100;

    const activeCoupons = coupons.filter(c => c.active && !c.used);
    const usedCoupons = coupons.filter(c => !c.active || c.used);
    const totalSaved = couponOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);

    const progressHTML = `
        <div class="bg-brand-redSoft border border-brand-red/15 rounded-2xl p-5">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-full bg-brand-red text-white grid place-items-center shrink-0">
                    <i class="fa-solid fa-star" aria-hidden="true"></i>
                </div>
                <div>
                    <div class="font-bold text-brand-espresso">Loyalty Reward Progress</div>
                    <div class="text-sm text-brand-muted">Every 10 orders earns a 10% off coupon</div>
                </div>
            </div>
            <div class="flex justify-between text-sm font-semibold text-brand-espresso mb-1">
                <span>${progress} / 10 orders</span>
                <span>${remainingOrders === 0 ? "Coupon earned!" : remainingOrders + " more to go"}</span>
            </div>
            <div class="h-3 bg-white rounded-full overflow-hidden border border-brand-sand">
                <div class="h-full bg-gradient-to-r from-brand-red to-brand-gold rounded-full transition-all duration-500" style="width:${pct}%"></div>
            </div>
        </div>
    `;

    const activeCouponsHTML = activeCoupons.length ? activeCoupons.map(c => {
        const safeCode = escapeHTML(c.id);
        return `
        <div class="flex items-center justify-between border border-green-100 bg-green-50 rounded-2xl px-4 py-3 gap-3">
            <div>
                <div class="font-mono font-bold text-brand-espresso text-sm">${safeCode}</div>
                <div class="text-xs text-green-700 font-semibold mt-0.5">${Number(c.discountPercent || 0)}% off — Ready to use</div>
            </div>
            <button
                type="button"
                data-action="copy-coupon"
                data-code="${safeCode}"
                class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-full hover:bg-green-700 transition-colors pressable shrink-0"
            >
                <i class="fa-solid fa-copy mr-1" aria-hidden="true"></i>Copy
            </button>
        </div>
    `;
    }).join("") : `<p class="text-sm text-brand-muted text-center py-3">No active coupons right now.</p>`;

    const historyHTML = usedCoupons.length ? usedCoupons.map(c => {
        const saved = couponOrders.find(o => o.couponCode === c.id);
        return `
        <div class="flex items-center justify-between border border-brand-sand rounded-2xl px-4 py-3 gap-3">
            <div>
                <div class="font-mono font-bold text-brand-muted text-sm line-through">${escapeHTML(c.id)}</div>
                <div class="text-xs text-brand-muted mt-0.5">${Number(c.discountPercent || 0)}% off${saved ? ` — saved Rs. ${Number(saved.discountAmount).toLocaleString()}` : ""}</div>
            </div>
            <span class="text-xs bg-brand-sand text-brand-muted px-2 py-1 rounded-full font-semibold">Used</span>
        </div>
    `;
    }).join("") : `<p class="text-sm text-brand-muted text-center py-3">No coupon history yet.</p>`;

    const totalHTML = totalSaved > 0 ? `
        <div class="flex items-center justify-between bg-brand-espresso text-white rounded-2xl px-5 py-4">
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-piggy-bank text-brand-gold" aria-hidden="true"></i>
                <span class="font-semibold">Total saved with coupons</span>
            </div>
            <span class="font-black text-brand-gold text-lg tabular-nums">Rs. ${totalSaved.toLocaleString()}</span>
        </div>
    ` : "";

    content.innerHTML = `
        ${progressHTML}
        ${totalHTML}
        <div>
            <div class="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Active Coupons</div>
            <div class="space-y-2">${activeCouponsHTML}</div>
        </div>
        <div>
            <div class="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3">Coupon History</div>
            <div class="space-y-2">${historyHTML}</div>
        </div>
    `;
}

// ===== Banner Carousel =====
// (Service Worker registration is handled early in sw-register.js)
let bannerData = [];
let currentBannerIndex = 0;
let bannerInterval = null;

async function loadBanners() {
    try {
        const snapshot = await getDocs(
            query(
                collection(db, "banners"),
                where("active", "==", true)
            )
        );

        let rawBanners;
        if (snapshot.empty && snapshot.metadata && snapshot.metadata.fromCache) {
            const restBanners = await fetchCollectionViaRest("banners", 50);
            rawBanners = restBanners
                .filter(record => record.data.active === true)
                .map(record => ({ id: record.id, ...record.data }));
        } else {
            rawBanners = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data()
            }));
        }

        bannerData = rawBanners
            .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

        renderBannerCarousel();
    } catch (error) {
        console.error("Failed to load banners:", error);
        const container = $("promoBannerContainer");
        if (container) container.classList.add("hidden");
    }
}

function renderBannerCarousel() {
    const container = $("promoBannerContainer");
    const slidesWrapper = $("bannerSlides");
    const dotsContainer = $("bannerDots");
    const prevBtn = $("bannerPrevBtn");
    const nextBtn = $("bannerNextBtn");

    if (!container || !slidesWrapper || !dotsContainer) return;

    if (bannerData.length === 0) {
        container.classList.add("hidden");
        return;
    }

    container.classList.remove("hidden");

    const allSlides = bannerData.flatMap(banner => {
        const images = banner.imageUrls || (banner.imageUrl ? [banner.imageUrl] : []);
        return images.map((imageUrl, idx) => ({
            banner,
            imageUrl,
            isPrimary: idx === 0
        }));
    });

    if (allSlides.length === 0) {
        container.classList.add("hidden");
        return;
    }

    slidesWrapper.innerHTML = allSlides.map((slide, index) => {
        const safeLink = getSafeUrl(slide.banner.link);
        const linkOpenTag = safeLink
            ? `<a href="${escapeHTML(safeLink)}" target="_blank" rel="noopener noreferrer" class="block h-full focus:outline-none">`
            : "";
        const linkCloseTag = safeLink ? `</a>` : "";

        return `
        <div
            class="flex-none w-full h-full relative bg-gradient-to-r from-brand-red via-brand-redDark to-brand-espresso"
            data-slide-index="${index}"
        >
            ${linkOpenTag}
            <div class="absolute inset-0 bg-black/10"></div>

            <div class="relative z-10 h-full flex flex-col md:flex-row items-center justify-between p-4 sm:p-6 md:p-8 gap-4">
                <!-- Content Side -->
                <div class="flex-1 text-white text-center md:text-left">
                    <h3 class="text-xl sm:text-2xl md:text-3xl font-black mb-2 sm:mb-3 leading-tight">
                        ${escapeHTML(slide.banner.title)}
                    </h3>
                    ${slide.banner.description ? `
                        <p class="text-sm sm:text-base md:text-lg text-white/90 mb-4 leading-relaxed max-w-md mx-auto md:mx-0">
                            ${escapeHTML(slide.banner.description)}
                        </p>
                    ` : ""}
                    <div class="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold uppercase tracking-wide">
                        <span class="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                        ${escapeHTML(slide.banner.type)}${safeLink ? " • Click to Learn More" : ""}
                    </div>
                </div>

                <!-- Image Display -->
                <div class="flex-shrink-0">
                    <img
                        src="${escapeHTML(slide.imageUrl || FALLBACK_SVG_IMAGE)}"
                        alt="${escapeHTML(slide.banner.title)}"
                        class="banner-slide-img w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 rounded-2xl object-cover shadow-lg ring-4 ring-white/20"
                        loading="lazy"
                    />
                </div>
            </div>
            ${linkCloseTag}
        </div>
    `;
    }).join("");

    slidesWrapper.querySelectorAll(".banner-slide-img").forEach(img => {
        img.addEventListener("error", () => {
            img.src = FALLBACK_SVG_IMAGE;
        }, { once: true });
    });

    dotsContainer.innerHTML = allSlides.map((_, index) => `
        <button
            type="button"
            data-action="go-slide"
            data-slide="${index}"
            class="w-2 h-2 rounded-full transition-all duration-200 ${index === currentBannerIndex ? "bg-white scale-125" : "bg-white/50"}"
            aria-label="Go to slide ${index + 1}"
        ></button>
    `).join("");

    const hasMultiple = allSlides.length > 1;
    dotsContainer.style.display = hasMultiple ? "flex" : "none";
    prevBtn?.classList.toggle("hidden", !hasMultiple);
    nextBtn?.classList.toggle("hidden", !hasMultiple);

    updateBannerSlidePosition();
    startBannerAutoRotation();
}

function getTotalSlideCount() {
    return bannerData.reduce((total, banner) => {
        const images = banner.imageUrls || (banner.imageUrl ? [banner.imageUrl] : []);
        return total + images.length;
    }, 0);
}

function updateBannerSlidePosition() {
    const slidesWrapper = $("bannerSlides");
    const totalSlides = getTotalSlideCount();
    if (!slidesWrapper || totalSlides === 0) return;

    const translateX = -currentBannerIndex * 100;
    slidesWrapper.style.transform = `translateX(${translateX}%)`;

    const dots = $("bannerDots")?.querySelectorAll("button");
    if (dots) {
        dots.forEach((dot, index) => {
            if (index === currentBannerIndex) {
                dot.className = "w-2 h-2 rounded-full transition-all duration-200 bg-white scale-125";
            } else {
                dot.className = "w-2 h-2 rounded-full transition-all duration-200 bg-white/50";
            }
        });
    }
}

function goToBannerSlide(index) {
    const totalSlides = getTotalSlideCount();
    if (index < 0 || index >= totalSlides) return;

    currentBannerIndex = index;
    updateBannerSlidePosition();

    startBannerAutoRotation();
}

window.goToSlide = goToBannerSlide;
window.goToBannerSlide = goToBannerSlide;

function nextBannerSlide() {
    const totalSlides = getTotalSlideCount();
    if (totalSlides === 0) return;
    currentBannerIndex = (currentBannerIndex + 1) % totalSlides;
    updateBannerSlidePosition();
}

function prevBannerSlide() {
    const totalSlides = getTotalSlideCount();
    if (totalSlides === 0) return;
    currentBannerIndex = currentBannerIndex === 0 ? totalSlides - 1 : currentBannerIndex - 1;
    updateBannerSlidePosition();
}

function startBannerAutoRotation() {
    if (bannerInterval) {
        clearInterval(bannerInterval);
        bannerInterval = null;
    }

    const totalSlides = getTotalSlideCount();
    if (totalSlides <= 1) return;

    bannerInterval = setInterval(nextBannerSlide, 5000);
}

$("bannerPrevBtn")?.addEventListener("click", () => {
    prevBannerSlide();
    startBannerAutoRotation();
});

$("bannerNextBtn")?.addEventListener("click", () => {
    nextBannerSlide();
    startBannerAutoRotation();
});

$("promoBannerContainer")?.addEventListener("mouseenter", () => {
    if (bannerInterval) {
        clearInterval(bannerInterval);
        bannerInterval = null;
    }
});

$("promoBannerContainer")?.addEventListener("mouseleave", () => {
    startBannerAutoRotation();
});

let touchStartX = 0;
let touchEndX = 0;

$("promoBannerContainer")?.addEventListener("touchstart", (e) => {
    touchStartX = e.changedTouches[0].screenX;
    if (bannerInterval) clearInterval(bannerInterval);
}, { passive: true });

$("promoBannerContainer")?.addEventListener("touchend", (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
    startBannerAutoRotation();
}, { passive: true });

function handleSwipe() {
    const swipeThreshold = 50;
    if (touchEndX < touchStartX - swipeThreshold) {
        nextBannerSlide();
    }
    if (touchEndX > touchStartX + swipeThreshold) {
        prevBannerSlide();
    }
}

document.addEventListener("DOMContentLoaded", loadBanners);

$("myCouponsBtn")?.addEventListener("click", loadMyCoupons);
$("closeMyCouponsModal")?.addEventListener("click", () => closeModal($("myCouponsModal")));

// Apply coupon
$("applyCouponBtn")?.addEventListener(
    "click",
    applyCoupon
);

// ===== Close Modals by clicking outside =====
[
    $("authModal"),
    $("cartModal"),
    $("pastOrdersModal"),
    $("myCouponsModal"),
    $("trackOrderModal"),
    $("itemDetailModal"),
    $("orderConfirmationModal"),
    $("legalModal")
].forEach(modal => {

    if (!modal) return;

    modal.addEventListener(
        "click",
        (event) => {
            if (event.target !== modal) return;

            if (modal === $("pastOrdersModal")) {
                closePastOrdersModal();
            } else if (modal === $("trackOrderModal")) {
                closeTrackOrderModal();
            } else if (modal === $("itemDetailModal")) {
                closeItemDetailModal();
            } else {
                closeModal(modal);
            }
        }
    );
});

// ===== Escape closes modal =====
document.addEventListener(
    "keydown",
    (event) => {

        if (event.key !== "Escape") {
            return;
        }

        if ($("authModal")?.classList.contains("is-open")) {
            closeModal($("authModal"));
        }

        if ($("cartModal")?.classList.contains("is-open")) {
            closeModal($("cartModal"));
        }

        if ($("pastOrdersModal")?.classList.contains("is-open")) {
            closePastOrdersModal();
        }

        if ($("myCouponsModal")?.classList.contains("is-open")) {
            closeModal($("myCouponsModal"));
        }

        if ($("trackOrderModal")?.classList.contains("is-open")) {
            closeTrackOrderModal();
        }

        if ($("itemDetailModal")?.classList.contains("is-open")) {
            closeItemDetailModal();
        }

        if ($("orderConfirmationModal")?.classList.contains("is-open")) {
            closeModal($("orderConfirmationModal"));
        }

        if ($("legalModal")?.classList.contains("is-open")) {
            closeModal($("legalModal"));
        }
    }
);

// ===== Scroll Reveal =====
const revealObserver =
    new IntersectionObserver(
        (entries) => {

            entries.forEach(entry => {

                if (
                    entry.isIntersecting
                ) {

                    entry.target.classList.add(
                        "is-visible"
                    );

                    revealObserver.unobserve(
                        entry.target
                    );
                }
            });

        },
        {
            threshold: 0.08
        }
    );

function observeReveals() {

    document
        .querySelectorAll(
            ".reveal:not(.is-visible)"
        )
        .forEach(el => {

            revealObserver.observe(el);
        });
}

// ===== Scroll Effects =====
window.addEventListener(
    "scroll",
    () => {

        const nav =
            $("mainNav");

        const progress =
            $("scrollProgress");

        if (nav) {

            if (
                window.scrollY > 14
            ) {

                nav.classList.add(
                    "shadow-md",
                    "bg-white/90"
                );

            } else {

                nav.classList.remove(
                    "shadow-md",
                    "bg-white/90"
                );
            }
        }

        if (progress) {

            const maxScroll =
                document.documentElement.scrollHeight
                - window.innerHeight;

            const ratio =
                maxScroll > 0
                    ? window.scrollY / maxScroll
                    : 0;

            progress.style.transform =
                `scaleX(${ratio})`;
        }

        const menuSection =
            $("menuSection");

        const bottomNavHome =
            $("bottomNavHome");

        const bottomNavMenu =
            $("bottomNavMenu");

        if (menuSection && bottomNavHome && bottomNavMenu) {

            const isMenuActive =
                window.scrollY
                >= menuSection.offsetTop - 120;

            bottomNavHome.classList.toggle(
                "active",
                !isMenuActive
            );

            bottomNavMenu.classList.toggle(
                "active",
                isMenuActive
            );
        }

    },
    {
        passive: true
    }
);

// ===== Initial View =====
async function initMenu() {

    setOrderType("DELIVERY");
    updateCartCount();

    renderMenuSkeleton();

    try {

        await loadMenuFromFirestore();

        updateCartCount();
        activeCategoryId = "ALL";
        expandedCategoryIds.clear();
        renderCategories("ALL");

        renderMenu(menuItems, "ALL");

        if (menuItems.length) {

            showToast(
                `${menuItems.length} menu items loaded`,
                "fa-utensils"
            );
        }

    } catch (error) {

        console.error(
            "Failed to load menu from Firestore:",
            error
        );

        const isPermissionError =
            error && error.code === "permission-denied";
        const isNetworkError =
            Boolean(error) && (
                error.code === "unavailable" ||
                error.name === "AbortError" ||
                /fetch|network|offline|timed?\s*out/i.test(String(error.message || ""))
            );

        const errorMessage = isPermissionError
            ? "The online menu is not publicly readable yet. Please contact the restaurant."
            : isNetworkError
                ? "Connection is slow or offline. Please check your internet connection and tap Retry."
                : "Please tap Retry to load the menu again.";

        $("menuGrid").innerHTML = `
            <div class="col-span-full py-20 text-center">

                <div class="w-16 h-16 rounded-2xl bg-red-50 text-red-500 grid place-items-center mx-auto mb-4">
                    <i class="fa-solid fa-wifi text-xl"></i>
                </div>

                <h3 class="font-bold text-xl text-gray-800">
                    Couldn’t load the menu
                </h3>

                <p class="text-gray-500 mt-1">
                    ${escapeHTML(errorMessage)}
                </p>

                <button
                    type="button"
                    data-action="retry-menu"
                    class="mt-5 px-5 py-2.5 rounded-xl bg-brand-espresso text-white font-bold hover:bg-brand-red transition-colors pressable"
                >
                    Retry
                </button>

            </div>
        `;
    }

    renderFloatingCart();

    observeReveals();
}

// ===== Order Tracking Utilities =====

function getStatusLabel(status, orderType = "DELIVERY") {
    if (status === "COMPLETED" && orderType === "TAKEAWAY") {
        return "Ready for Pickup";
    }
    const labels = {
        PENDING: "Order Placed",
        ACCEPTED: "Order Confirmed",
        PREPARING: "Being Prepared",
        OUT_FOR_DELIVERY: "Out for Delivery",
        COMPLETED: "Delivered",
        REJECTED: "Cancelled"
    };
    return labels[status] || status;
}

function getStatusIcon(status) {
    const icons = {
        PENDING: "fa-clock",
        ACCEPTED: "fa-check-circle",
        PREPARING: "fa-fire",
        OUT_FOR_DELIVERY: "fa-motorcycle",
        COMPLETED: "fa-circle-check",
        REJECTED: "fa-times-circle"
    };
    return icons[status] || "fa-circle";
}

function formatEstimatedTime(timestamp) {
    if (!timestamp) return "Calculating...";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function getProgressPercentage(currentStatus, orderType) {
    const deliverySteps = ["PENDING", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY", "COMPLETED"];
    const takeawaySteps = ["PENDING", "ACCEPTED", "PREPARING", "COMPLETED"];

    const steps = orderType === "DELIVERY" ? deliverySteps : takeawaySteps;
    const currentIndex = steps.indexOf(currentStatus);

    if (currentIndex === -1) return 0;
    return ((currentIndex + 1) / steps.length) * 100;
}

async function loadAiKnowledge() {
    try {
        const snap = await getDoc(doc(db, "aiConfig", "knowledge"));
        if (snap.exists()) {
            aiKnowledge = snap.data() || null;
        }
    } catch {
        // Ignore permission-denied or offline errors; built-in assistant defaults remain active
    }
}

// Start AI assistant & website menu
initAiAssistant({
    getMenuItems: () => menuItems,
    getCategories: () => categories,
    getCart: () => cart,
    getOrderType: () => currentOrderType,
    getAiKnowledge: () => aiKnowledge,
    addToCart,
    openTrackOrder: openTrackOrderFlow,
    openCart: openCartFlow,
    showToast
});

loadAiKnowledge();
initMenu();
