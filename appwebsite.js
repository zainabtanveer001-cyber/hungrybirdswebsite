// ===== Back End & Firebase Initialization =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore,
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
    orderBy,
    limit,
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Same Firebase project as the POS
const firebaseConfig = {
    apiKey: "AIzaSyAIibLNTusvBFOEcExpdb1tYQh_1rv2q7k",
    authDomain: "hungry-birds-3e16f.firebaseapp.com",
    projectId: "hungry-birds-3e16f",
    storageBucket: "hungry-birds-3e16f.firebasestorage.app",
    messagingSenderId: "339589167106",
    appId: "1:339589167106:web:4828ef951176e3e41e4f1b",
    measurementId: "G-ZVJYRZ18H1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

let categories = [{ id: "ALL", name: "All" }];
let menuItems = [];

// ===== Cart Persistence (localStorage) =====
function loadCart() {
    try {
        const savedCart = localStorage.getItem("hungryBirdsCart");
        if (savedCart) {
            cart = JSON.parse(savedCart);
        }
    } catch (e) {
        console.warn("Failed to load cart from localStorage:", e);
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
    localStorage.removeItem("hungryBirdsCart");
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

function showToast(message, icon = "fa-check") {
    const toast = $("toast");

    if (!toast) return;

    $("toastMessage").textContent = message;
    $("toastIcon").innerHTML = `<i class="fa-solid ${icon}"></i>`;

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 1800);
}

function openModal(modal) {
    if (!modal) return;

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            modal.classList.add("is-open");
        });
    });

    document.body.classList.add("overflow-hidden");
}

function closeModal(modal) {
    if (!modal) return;

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    setTimeout(() => {
        modal.classList.add("hidden");
    }, 280);

    document.body.classList.remove("overflow-hidden");
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
function renderMenuSkeleton(count = 8) {
    const grid = $("menuGrid");

    if (!grid) return;

    grid.innerHTML = Array.from({ length: count }, () => `
        <div class="bg-white rounded-3xl overflow-hidden border border-gray-100 shadow-sm">
            <div class="skeleton h-48"></div>

            <div class="p-5 space-y-3">
                <div class="skeleton h-3 rounded w-1/4"></div>
                <div class="skeleton h-5 rounded w-3/4"></div>

                <div class="flex justify-between items-center pt-2">
                    <div class="skeleton h-6 rounded w-24"></div>
                    <div class="skeleton h-10 rounded-xl w-24"></div>
                </div>
            </div>
        </div>
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

async function loadMenuFromFirestore() {
    const [categorySnapshot, menuSnapshot] = await Promise.all([
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "menu"))
    ]);

    const dbCategories = categorySnapshot.docs
        .map(doc => ({
            id: doc.id,
            name: firstDefined(doc.data(), ["name", "title", "label"])
        }))
        .filter(category => category.name);

    const dbMenuItems = menuSnapshot.docs
        .map(doc => {
            const data = doc.data();
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
                id: doc.id,
                menuItemId: doc.id,
                recipeId: typeof recipeId === "object" && recipeId !== null
                    ? recipeId.id || null
                    : recipeId,
                name: itemName,
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
            menuSnapshot.docs.find(doc => doc.id === item.id).data(),
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
}

// ===== Categories =====
function renderCategories(activeId = "ALL") {
    const container = $("categoryContainer");

    if (!container) return;

    container.innerHTML = "";

    categories.forEach(cat => {
        const btn = document.createElement("button");
        const active = cat.id === activeId;

        btn.className = `
            category-btn
            whitespace-nowrap
            px-5
            py-2.5
            rounded-full
            font-bold
            text-sm
            ${active
                ? "active bg-orange-500 text-white"
                : "bg-gray-100/90 text-gray-600 hover:bg-gray-200"
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
                "bg-orange-500",
                "text-white"
            );

            btn.classList.add(
                "bg-gray-100/90",
                "text-gray-600"
            );

            btn.setAttribute(
                "aria-pressed",
                "false"
            );
        });

    btnElement.classList.remove(
        "bg-gray-100/90",
        "text-gray-600"
    );

    btnElement.classList.add(
        "active",
        "bg-orange-500",
        "text-white"
    );

    btnElement.setAttribute(
        "aria-pressed",
        "true"
    );

    const filtered =
        category.id === "ALL"
            ? menuItems
            : menuItems.filter(
                item => item.categoryId === category.id
            );

    renderMenu(filtered);
}

// ===== Menu Rendering =====
function cardControlsHTML(id) {
    const cartItem = cart.find(
        item => item.id === id
    );

    if (cartItem) {
        return `
            <div class="flex items-center gap-1.5 bg-gray-900 rounded-xl px-2 py-1.5 shadow-lg">

                <button
                    onclick="changeCartQty('${id}', -1)"
                    class="w-7 h-7 rounded-lg text-white hover:bg-white/10 hover:text-orange-400 font-bold transition-colors pressable"
                    aria-label="Decrease quantity"
                >
                    −
                </button>

                <span class="text-white font-bold w-5 text-center">
                    ${cartItem.qty}
                </span>

                <button
                    onclick="changeCartQty('${id}', 1)"
                    class="w-7 h-7 rounded-lg text-white hover:bg-white/10 hover:text-orange-400 font-bold transition-colors pressable"
                    aria-label="Increase quantity"
                >
                    +
                </button>

            </div>
        `;
    }

    return `
        <button
            onclick="addToCart('${id}')"
            class="bg-gray-900 text-white px-4 py-2.5 rounded-xl hover:bg-orange-500 transition-all shadow-sm hover:shadow-lg pressable"
        >
            <i class="fa-solid fa-plus mr-1"></i>
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
}

function renderMenu(items) {
    const grid = $("menuGrid");

    if (!grid) return;

    grid.innerHTML = "";

    if (!items.length) {
        grid.innerHTML = `
            <div class="col-span-full py-20 text-center reveal is-visible">

                <div class="w-16 h-16 rounded-2xl bg-orange-50 text-orange-500 grid place-items-center mx-auto mb-4">
                    <i class="fa-solid fa-utensils text-xl"></i>
                </div>

                <h3 class="font-bold text-xl text-gray-800">
                    No items in this category
                </h3>

                <p class="text-gray-500 mt-1">
                    Try another category.
                </p>

            </div>
        `;

        return;
    }

    items.forEach((item, index) => {
        const card = document.createElement("article");

        card.className = `
            menu-card
            reveal
            bg-white
            rounded-[2rem]
            shadow-[0_4px_30px_-12px_rgba(15,23,42,0.1)]
            overflow-hidden
            border
            border-gray-100/60
            hover:-translate-y-1
            hover:shadow-[0_12px_40px_-12px_rgba(15,23,42,0.15)]
            transition-all
            duration-300
            ease-out
        `;

        card.style.transitionDelay =
            `${Math.min(index * 28, 220)}ms`;

        const categoryName =
            categories.find(
                c => c.id === item.categoryId
            )?.name || "";

        card.innerHTML = `
            <div class="relative overflow-hidden bg-gray-50">
                <img
                    src="${escapeHTML(item.img)}"
                    alt="${escapeHTML(item.name)}"
                    loading="lazy"
                    decoding="async"
                    class="w-full h-52 object-cover"
                >
                ${categoryName ? `
                    <div class="absolute left-4 top-4 px-3 py-1 rounded-full bg-white/80 backdrop-blur-sm text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
                        ${escapeHTML(categoryName)}
                    </div>
                ` : ""}
            </div>
            <div class="px-5 pt-4 pb-5">
                <h3 class="text-[15px] font-semibold text-gray-800 leading-snug tracking-tight min-h-[2.4rem]">
                    ${escapeHTML(item.name)}
                </h3>
                <div class="flex justify-between items-center mt-4">
                    <span class="text-lg font-semibold text-gray-900 tracking-tight">
                        Rs. ${Number(item.price).toLocaleString()}
                    </span>
                    <div id="qtyBox-${item.id}">
                        ${cardControlsHTML(item.id)}
                    </div>
                </div>
            </div>
        `;

        const image = card.querySelector("img");

        image.addEventListener(
            "error",
            () => {
                image.src =
                    `https://placehold.co/800x600?text=${encodeURIComponent(item.name)}`;
            },
            { once: true }
        );

        grid.appendChild(card);

        requestAnimationFrame(() => {
            card.classList.add("is-visible");
        });
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
window.addToCart = (id) => {
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
};

// Remove from cart
window.removeFromCart = (id) => {
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
};

// Change quantity
window.changeCartQty = (id, delta) => {
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
};

// ===== Floating Cart =====
function renderFloatingCart() {
    const panel = $("floatingCart");

    if (!panel) return;

    if (cart.length === 0) {
        panel.classList.remove("is-visible");
        return;
    }

    panel.classList.add("is-visible");

    const count = cart.reduce(
        (sum, item) => sum + item.qty,
        0
    );

    $("floatingCartCount").textContent =
        count;

    $("floatingCartTotal").textContent =
        `Rs. ${getCartTotal().toLocaleString()}`;

    $("floatingCartItems").innerHTML =
        cart.map(item => `
            <div class="flex justify-between items-center text-sm rounded-2xl px-2 py-2 hover:bg-gray-50 transition-colors">

                <div class="truncate pr-2">

                    <div class="font-bold text-gray-800 truncate">
                        ${escapeHTML(item.name)}
                    </div>

                    <div class="text-gray-500">
                        Rs. ${Number(item.price).toLocaleString()} × ${item.qty}
                    </div>

                </div>

                <div class="flex items-center gap-1 shrink-0">

                    <button
                        onclick="changeCartQty('${item.id}', -1)"
                        class="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 font-bold text-xs transition-colors pressable"
                    >
                        −
                    </button>

                    <span class="font-bold w-4 text-center text-xs">
                        ${item.qty}
                    </span>

                    <button
                        onclick="changeCartQty('${item.id}', 1)"
                        class="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 font-bold text-xs transition-colors pressable"
                    >
                        +
                    </button>

                </div>

            </div>
        `).join("");

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
            <div class="text-center text-gray-400 py-12">

                <div class="w-16 h-16 rounded-2xl bg-gray-100 text-gray-400 grid place-items-center mx-auto mb-4">
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

        list.innerHTML = cart.map(item => `
            <div class="flex justify-between items-center border border-gray-100 rounded-2xl p-3 hover:shadow-sm transition-all">

                <div class="min-w-0 pr-3">

                    <div class="font-bold text-gray-800 truncate">
                        ${escapeHTML(item.name)}
                    </div>

                    <div class="text-sm text-gray-500 mt-0.5">
                        Rs. ${Number(item.price).toLocaleString()}
                    </div>

                </div>

                <div class="flex items-center gap-1.5 shrink-0">

                    <button
                        onclick="changeCartQty('${item.id}', -1)"
                        class="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 font-bold transition-colors pressable"
                    >
                        −
                    </button>

                    <span class="font-black w-5 text-center">
                        ${item.qty}
                    </span>

                    <button
                        onclick="changeCartQty('${item.id}', 1)"
                        class="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 font-bold transition-colors pressable"
                    >
                        +
                    </button>

                    <button
                        onclick="removeFromCart('${item.id}')"
                        class="w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors pressable"
                        aria-label="Remove item"
                    >
                        <i class="fa-solid fa-trash text-xs"></i>
                    </button>

                </div>

            </div>
        `).join("");
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

async function loadPastOrders() {
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
        <div class="text-center text-gray-400 py-12">
            <i class="fa-solid fa-spinner fa-spin text-xl"></i>
        </div>
    `;

    openModal($("pastOrdersModal"));

    try {
        // Clean up existing listener
        if (pastOrdersListener) {
            pastOrdersListener();
            pastOrdersListener = null;
        }

        // Set up real-time listener for user's orders (limit to 20 most recent)
        pastOrdersListener = onSnapshot(
            query(
                collection(db, "onlineOrders"),
                where("customerUid", "==", currentUser.uid),
                orderBy("createdAt", "desc"),
                limit(20)
            ),
            (snapshot) => {
                pastOrdersCache = snapshot.docs
                    .map(docSnap => ({
                        id: docSnap.id,
                        ...docSnap.data()
                    }));

                renderPastOrders();
            },
            (error) => {
                console.error("Failed to load past orders:", error);

                list.innerHTML = `
                    <div class="text-center text-gray-400 py-12">
                        <p class="font-semibold text-gray-600">Couldn't load your past orders.</p>
                        <p class="text-sm mt-1">${error.code === 'permission-denied'
                            ? 'Permission denied. Please contact support.'
                            : 'Please try again later.'}</p>
                    </div>
                `;
            }
        );

    } catch (error) {
        console.error("Failed to load past orders:", error);

        list.innerHTML = `
            <div class="text-center text-gray-400 py-12">
                <p class="font-semibold text-gray-600">Couldn't load your past orders.</p>
                <p class="text-sm mt-1">${error.code === 'permission-denied'
                    ? 'Permission denied. Please contact support.'
                    : 'Please try again later.'}</p>
            </div>
        `;
    }
}

function renderPastOrders() {
    const list = $("pastOrdersList");

    if (!list) return;

    if (!pastOrdersCache.length) {
        list.innerHTML = `
            <div class="text-center text-gray-400 py-12">
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

        const status = order.status || "PENDING";
        const isActive = !["COMPLETED", "REJECTED"].includes(status);

        return `
            <div class="border border-gray-100 rounded-2xl p-4 hover:shadow-md transition-shadow">
                <div class="flex justify-between items-start gap-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="status-badge status-${status.toLowerCase()}">
                                <i class="fa-solid ${getStatusIcon(status)} mr-1"></i>
                                ${getStatusLabel(status)}
                            </span>
                            ${isActive ? '<span class="text-xs text-orange-500 font-semibold animate-pulse">● Live</span>' : ''}
                        </div>
                        <div class="text-xs text-gray-400 mb-1">${escapeHTML(date)}</div>
                        <div class="text-sm text-gray-700 mt-1">${escapeHTML(itemsSummary)}</div>
                        ${order.estimatedReadyTime && isActive ? `
                            <div class="text-xs text-blue-600 mt-2 flex items-center gap-1">
                                <i class="fa-solid fa-clock"></i>
                                <span>Ready by ${formatEstimatedTime(order.estimatedReadyTime)}</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="text-right shrink-0">
                        <div class="font-black text-gray-900">Rs. ${Number(order.total || 0).toLocaleString()}</div>
                        ${!isActive ? `
                            <button
                                onclick="repeatOrder('${order.id}')"
                                class="mt-2 text-xs bg-gray-900 text-white px-3 py-1.5 rounded-full hover:bg-orange-500 transition-colors pressable"
                            >
                                Repeat Order
                            </button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

window.repeatOrder = (orderId) => {
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

    updateCartCount();
    renderFloatingCart();
    renderCartModal();

    closeModal($("pastOrdersModal"));
    openModal($("cartModal"));
};

// ===== Order Tracking =====

// Track order by ID (for guest access)
window.trackOrderByID = async function(orderId) {
    if (!orderId || !orderId.trim()) {
        showToast("Please enter an order ID", "fa-circle-exclamation");
        return;
    }

    const trackingContent = $("trackingContent");
    const trackingError = $("trackingError");

    if (!trackingContent || !trackingError) return;

    // Show loading state
    trackingContent.innerHTML = `
        <div class="text-center py-12">
            <i class="fa-solid fa-spinner fa-spin text-3xl text-orange-500"></i>
            <p class="mt-3 text-gray-600">Loading order...</p>
        </div>
    `;
    trackingError.classList.add("hidden");

    try {
        const orderDoc = await getDoc(doc(db, "onlineOrders", orderId.trim()));

        if (!orderDoc.exists()) {
            trackingContent.innerHTML = "";
            trackingError.textContent = "Order not found. Please check your order ID.";
            trackingError.classList.remove("hidden");
            return;
        }

        const orderData = { id: orderDoc.id, ...orderDoc.data() };

        // Set up real-time listener
        setupOrderTrackingListener(orderId.trim(), orderData);

    } catch (error) {
        console.error("Error tracking order:", error);
        trackingContent.innerHTML = "";
        trackingError.textContent = "Could not load order. Please try again.";
        trackingError.classList.remove("hidden");
    }
};

// Set up real-time Firestore listener
function setupOrderTrackingListener(orderId, initialData) {
    // Clean up existing listener
    if (activeOrderListener) {
        activeOrderListener();
        activeOrderListener = null;
    }

    // Render initial data
    renderOrderTimeline(initialData);

    // Set up real-time listener
    activeOrderListener = onSnapshot(
        doc(db, "onlineOrders", orderId),
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

    // Define status steps based on order type.
    // Delivery: PENDING → ACCEPTED → PREPARING → OUT_FOR_DELIVERY → COMPLETED
    // Takeaway: PENDING → ACCEPTED → PREPARING → COMPLETED
    // (READY step removed — POS does not write that status)
    const allSteps = {
        'DELIVERY': [
            { status: 'PENDING',          label: 'Order Placed',     icon: 'fa-clock' },
            { status: 'ACCEPTED',         label: 'Order Confirmed',  icon: 'fa-check-circle' },
            { status: 'PREPARING',        label: 'Being Prepared',   icon: 'fa-fire' },
            { status: 'OUT_FOR_DELIVERY', label: 'Out for Delivery', icon: 'fa-motorcycle' },
            { status: 'COMPLETED',        label: 'Delivered',        icon: 'fa-circle-check' }
        ],
        'TAKEAWAY': [
            { status: 'PENDING',   label: 'Order Placed',      icon: 'fa-clock' },
            { status: 'ACCEPTED',  label: 'Order Confirmed',   icon: 'fa-check-circle' },
            { status: 'PREPARING', label: 'Being Prepared',    icon: 'fa-fire' },
            { status: 'COMPLETED', label: 'Ready for Pickup',  icon: 'fa-circle-check' }
        ]
    };

    const steps = allSteps[orderType] || allSteps['DELIVERY'];
    const currentStepIndex = steps.findIndex(s => s.status === currentStatus);

    // Handle rejected orders
    if (currentStatus === 'REJECTED') {
        trackingContent.innerHTML = `
            <div class="text-center py-8">
                <div class="w-16 h-16 rounded-full bg-red-50 text-red-500 grid place-items-center mx-auto mb-4">
                    <i class="fa-solid fa-times-circle text-2xl"></i>
                </div>
                <h3 class="text-xl font-bold text-gray-900 mb-2">Order Cancelled</h3>
                <p class="text-gray-600">This order has been cancelled.</p>
                ${order.rejectionReason ? `<p class="text-sm text-gray-500 mt-2">Reason: ${escapeHTML(order.rejectionReason)}</p>` : ''}
            </div>
        `;
        return;
    }

    // Build timeline HTML
    const stepsHTML = steps.map((step, index) => {
        const isCompleted = index <= currentStepIndex;
        const isCurrent = index === currentStepIndex;
        const timestamp = order[`${step.status.toLowerCase()}At`];

        return `
            <div class="timeline-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}">
                <div class="timeline-icon ${isCompleted ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-400'}">
                    <i class="fa-solid ${step.icon}"></i>
                </div>
                <div class="flex items-start justify-between">
                    <div>
                        <div class="font-bold text-gray-900">${step.label}</div>
                        ${timestamp ? `<div class="text-xs text-gray-500 mt-1">${formatEstimatedTime(timestamp)}</div>` : ''}
                    </div>
                    ${isCurrent ? '<span class="status-pulse"></span>' : ''}
                </div>
            </div>
        `;
    }).join('');

    trackingContent.innerHTML = `
        <div class="p-6">
            <!-- Progress Bar -->
            <div class="mb-8">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-sm font-semibold text-gray-700">Order Progress</span>
                    <span class="text-sm font-bold text-orange-500">${Math.round(progress)}%</span>
                </div>
                <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div class="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500" style="width: ${progress}%"></div>
                </div>
            </div>

            <!-- Current Status -->
            <div class="mb-6 p-4 rounded-2xl bg-orange-50 border border-orange-100">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-orange-500 text-white grid place-items-center">
                        <i class="fa-solid ${getStatusIcon(currentStatus)}"></i>
                    </div>
                    <div>
                        <div class="text-xs text-orange-600 font-semibold">Current Status</div>
                        <div class="text-lg font-black text-gray-900">${getStatusLabel(currentStatus)}</div>
                    </div>
                </div>
            </div>

            ${order.estimatedReadyTime ? `
                <div class="mb-6 p-4 rounded-2xl bg-blue-50 border border-blue-100">
                    <div class="flex items-center gap-2 text-sm">
                        <i class="fa-solid fa-clock text-blue-600"></i>
                        <span class="text-gray-700">Estimated ready by</span>
                        <span class="font-bold text-blue-600">${formatEstimatedTime(order.estimatedReadyTime)}</span>
                    </div>
                </div>
            ` : ''}

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
                        <span class="font-mono text-gray-900">${escapeHTML(order.id)}</span>
                    </div>
                    <div class="flex justify-between">
                        <span class="text-gray-600">Type</span>
                        <span class="font-semibold text-gray-900">${orderType}</span>
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
    $("orderIdInput").value = "";
    $("trackingContent").innerHTML = `
        <div class="text-center py-12 text-gray-400">
            <i class="fa-solid fa-magnifying-glass text-3xl mb-3"></i>
            <p class="font-semibold">Enter your order ID to track</p>
        </div>
    `;
    $("trackingError").classList.add("hidden");
    // Restore the ID input section for guests / next open
    $("trackOrderIdSection")?.classList.remove("hidden");
}

window.closeTrackOrderModal = closeTrackOrderModal;

// ===== Order Type =====
function setOrderType(type) {
    currentOrderType = type;

    const deliveryBtn =
        $("orderTypeDelivery");

    const takeawayBtn =
        $("orderTypeTakeaway");

    const addressInput =
        $("checkoutAddress");

    if (!deliveryBtn ||
        !takeawayBtn ||
        !addressInput) return;

    const active =
        "flex-1 py-2.5 rounded-xl text-sm font-semibold bg-orange-500 text-white shadow-sm transition-all";

    const inactive =
        "flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-600 transition-all";

    if (type === "DELIVERY") {

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
        console.log("Attempting to create order with data:", {
            customerUid: orderData.customerUid,
            status: "PENDING",
            currentUser: currentUser ? currentUser.uid : "NO USER"
        });

        await addDoc(
            collection(db, "onlineOrders"),
            {
                ...orderData,
                status: "PENDING",
                source: "website",
                createdAt: serverTimestamp()
            }
        );

        console.log("Order created successfully!");
        return true;

    } catch (error) {

        console.error(
            "POS Integration Error:",
            error,
            "Error code:",
            error.code,
            "Error message:",
            error.message
        );

        showToast(
            "Could not place order. Try again.",
            "fa-circle-exclamation"
        );

        return false;
    }
};

// ===== Place Order =====
async function placeOrder() {

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
        $("checkoutAddress").value.trim();

    if (!phone) {

        $("checkoutPhone").focus();

        showToast(
            "Please enter your phone number.",
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

    placeBtn.disabled = true;
    placeBtn.classList.add("loading");

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

        customer: {
            name,
            phone,
            address
        },

        customerUid:
            currentUser.uid
    };

    const ok =
        await pushOrderToPOS(orderData);

    if (ok) {
        await consumeCouponAndTrackLoyalty();
    }

    placeBtn.classList.remove("loading");

    if (!ok) {
        placeBtn.disabled = false;
        return;
    }

    // Let the success animation play before resetting and closing
    placeBtn.classList.add("success");

    setTimeout(() => {

        placeBtn.classList.remove("success");
        placeBtn.disabled = false;

        clearCart();
        removeCoupon();

        updateCartCount();
        renderFloatingCart();
        renderCartModal();

        closeModal(
            $("cartModal")
        );

        showToast(
            "Order placed successfully!",
            "fa-circle-check"
        );

        $("checkoutPhone").value = "";
        $("checkoutAddress").value = "";

    }, 1400);
}

// Marks a used coupon consumed and issues a new loyalty coupon every 10th order
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

        const userSnap = await getDoc(userRef);
        const orderCount = userSnap.data()?.orderCount ?? 0;

        if (orderCount > 0 && orderCount % 10 === 0) {
            const newCode = `LOYAL${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

            await setDoc(doc(db, "coupons", newCode), {
                code: newCode,
                discountPercent: 10,
                type: "loyalty",
                assignedTo: currentUser.uid,
                active: true,
                singleUse: true,
                used: false,
                createdAt: serverTimestamp()
            });

            showToast(
                `You've earned a 10% off coupon: ${newCode}`,
                "fa-gift"
            );
        }

    } catch (error) {
        console.error("Loyalty/coupon tracking error:", error);
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

$("cartBtn")?.addEventListener(
    "click",
    () => {

        renderCartModal();
        openModal(
            $("cartModal")
        );
    }
);

// Track Order button
$("trackOrderBtn")?.addEventListener(
    "click",
    () => {
        openModal($("trackOrderModal"));

        if (currentUser) {
            // Auto-track the most recent active order for logged-in users
            autoTrackActiveOrder();
        }
    }
);

function autoTrackActiveOrder() {
    const trackingContent = $("trackingContent");
    const trackingError = $("trackingError");
    const idInputSection = $("trackOrderIdSection");

    if (!trackingContent) return;

    // Show loading
    trackingContent.innerHTML = `
        <div class="text-center py-12">
            <i class="fa-solid fa-spinner fa-spin text-3xl text-orange-500"></i>
            <p class="mt-3 text-gray-600">Looking for your active order...</p>
        </div>
    `;
    trackingError?.classList.add("hidden");

    // Hide the manual ID input — not needed for logged-in users
    if (idInputSection) idInputSection.classList.add("hidden");

    // Clean up any existing listener first
    if (activeOrderListener) {
        activeOrderListener();
        activeOrderListener = null;
    }

    // Use onSnapshot so we always get fresh server data and react to
    // any status change the POS makes in real time
    activeOrderListener = onSnapshot(
        query(
            collection(db, "onlineOrders"),
            where("customerUid", "==", currentUser.uid)
        ),
        (snapshot) => {
            const allOrders = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

            const activeOrder = allOrders.find(
                o => !["COMPLETED", "REJECTED"].includes(o.status || "PENDING")
            );

            if (!activeOrder) {
                trackingContent.innerHTML = `
                    <div class="text-center py-12 text-gray-400">
                        <i class="fa-solid fa-check-circle text-3xl mb-3 text-green-400"></i>
                        <p class="font-semibold text-gray-600">No active orders right now.</p>
                        <p class="text-sm mt-1">Place an order and track it here in real time.</p>
                    </div>
                `;
                return;
            }

            renderOrderTimeline(activeOrder);
        },
        (error) => {
            console.error("Auto-track error:", error);
            trackingContent.innerHTML = "";
            if (trackingError) {
                trackingError.textContent = "Could not load your order. Please try again.";
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
    () => {

        renderCartModal();

        openModal(
            $("cartModal")
        );
    }
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
                error
            );

            showToast(
                error.message ||
                "Authentication failed.",
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
    () => {
        if (pastOrdersListener) {
            pastOrdersListener();
            pastOrdersListener = null;
        }
        closeModal(
            $("pastOrdersModal")
        );
    }
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
        <div class="text-center py-12 text-gray-400">
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
            getDocs(query(collection(db, "onlineOrders"), where("customerUid", "==", uid)))
        ]);

        const orderCount = userSnap.data()?.orderCount ?? 0;
        const coupons = couponsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const couponOrders = ordersSnap.docs
            .map(d => d.data())
            .filter(o => o.couponCode && o.discountAmount > 0);

        renderMyCoupons(orderCount, coupons, couponOrders);
    } catch (err) {
        console.error("loadMyCoupons error:", err);
        content.innerHTML = `<div class="text-center py-12 text-red-400"><p>Could not load coupons. Please try again.</p></div>`;
    }
}

function renderMyCoupons(orderCount, coupons, couponOrders) {
    const content = $("myCouponsContent");
    if (!content) return;

    const progress = orderCount % 10;
    const ordersLeft = 10 - progress;
    const pct = (progress / 10) * 100;

    const activeCoupons = coupons.filter(c => c.active && !c.used);
    const usedCoupons = coupons.filter(c => !c.active || c.used);
    const totalSaved = couponOrders.reduce((sum, o) => sum + (Number(o.discountAmount) || 0), 0);

    const progressHTML = `
        <div class="bg-orange-50 border border-orange-100 rounded-2xl p-5">
            <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-full bg-orange-500 text-white grid place-items-center shrink-0">
                    <i class="fa-solid fa-star"></i>
                </div>
                <div>
                    <div class="font-bold text-gray-900">Loyalty Reward Progress</div>
                    <div class="text-sm text-gray-500">Every 10 orders earns a 10% off coupon</div>
                </div>
            </div>
            <div class="flex justify-between text-sm font-semibold text-gray-700 mb-1">
                <span>${progress} / 10 orders</span>
                <span>${ordersLeft === 0 ? "Coupon earned!" : ordersLeft + " more to go"}</span>
            </div>
            <div class="h-3 bg-white rounded-full overflow-hidden border border-orange-100">
                <div class="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-500" style="width:${pct}%"></div>
            </div>
        </div>
    `;

    const activeCouponsHTML = activeCoupons.length ? activeCoupons.map(c => `
        <div class="flex items-center justify-between border border-green-100 bg-green-50 rounded-2xl px-4 py-3 gap-3">
            <div>
                <div class="font-mono font-bold text-gray-900 text-sm">${escapeHTML(c.id)}</div>
                <div class="text-xs text-green-700 font-semibold mt-0.5">${c.discountPercent}% off — Ready to use</div>
            </div>
            <button
                onclick="navigator.clipboard.writeText('${escapeHTML(c.id)}').then(()=>showToast('Coupon code copied!','fa-copy'))"
                class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-full hover:bg-green-700 transition-colors pressable shrink-0"
            >
                <i class="fa-solid fa-copy mr-1"></i>Copy
            </button>
        </div>
    `).join("") : `<p class="text-sm text-gray-400 text-center py-3">No active coupons right now.</p>`;

    const historyHTML = usedCoupons.length ? usedCoupons.map(c => {
        const saved = couponOrders.find(o => o.couponCode === c.id);
        return `
        <div class="flex items-center justify-between border border-gray-100 rounded-2xl px-4 py-3 gap-3">
            <div>
                <div class="font-mono font-bold text-gray-500 text-sm line-through">${escapeHTML(c.id)}</div>
                <div class="text-xs text-gray-400 mt-0.5">${c.discountPercent}% off${saved ? ` — saved Rs. ${Number(saved.discountAmount).toLocaleString()}` : ""}</div>
            </div>
            <span class="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full font-semibold">Used</span>
        </div>
    `}).join("") : `<p class="text-sm text-gray-400 text-center py-3">No coupon history yet.</p>`;

    const totalHTML = totalSaved > 0 ? `
        <div class="flex items-center justify-between bg-gray-900 text-white rounded-2xl px-5 py-4">
            <div class="flex items-center gap-2">
                <i class="fa-solid fa-piggy-bank text-orange-400"></i>
                <span class="font-semibold">Total saved with coupons</span>
            </div>
            <span class="font-black text-orange-400 text-lg">Rs. ${totalSaved.toLocaleString()}</span>
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

// ===== Service Worker Registration =====
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js")
            .then(reg => {
                console.log("Service Worker registered successfully:", reg.scope);
            })
            .catch(err => {
                console.warn("Service Worker registration failed:", err);
            });
    });
}

$("myCouponsBtn")?.addEventListener("click", loadMyCoupons);
$("closeMyCouponsModal")?.addEventListener("click", () => closeModal($("myCouponsModal")));

// Fallback: delegation for myCouponsBtn in case it was hidden at load time
document.addEventListener("click", (e) => {
    if (e.target.closest("#myCouponsBtn")) loadMyCoupons();
});

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
    $("myCouponsModal")
].forEach(modal => {

    if (!modal) return;

    modal.addEventListener(
        "click",
        (event) => {

            if (
                event.target === modal
            ) {
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

        if (
            $("authModal")?.classList.contains(
                "is-open"
            )
        ) {
            closeModal(
                $("authModal")
            );
        }

        if (
            $("cartModal")?.classList.contains(
                "is-open"
            )
        ) {
            closeModal(
                $("cartModal")
            );
        }

        if (
            $("pastOrdersModal")?.classList.contains(
                "is-open"
            )
        ) {
            closeModal(
                $("pastOrdersModal")
            );
        }

        if (
            $("myCouponsModal")?.classList.contains(
                "is-open"
            )
        ) {
            closeModal(
                $("myCouponsModal")
            );
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

    renderMenuSkeleton();

    try {

        await loadMenuFromFirestore();

        renderCategories("ALL");

        renderMenu(menuItems);

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
            error.code === "permission-denied";

        const errorMessage = isPermissionError
            ? "The online menu is not publicly readable yet. Please contact the restaurant."
            : "Please refresh and try again.";

        $("menuGrid").innerHTML = `
            <div class="col-span-full py-20 text-center">

                <div class="w-16 h-16 rounded-2xl bg-red-50 text-red-500 grid place-items-center mx-auto mb-4">
                    <i class="fa-solid fa-wifi text-xl"></i>
                </div>

                <h3 class="font-bold text-xl text-gray-800">
                    Couldn’t load the menu
                </h3>

                <p class="text-gray-500 mt-1">
                    ${errorMessage}
                </p>

                <button
                    onclick="location.reload()"
                    class="mt-5 px-5 py-2.5 rounded-xl bg-gray-900 text-white font-bold hover:bg-orange-500 transition-colors pressable"
                >
                    Refresh
                </button>

            </div>
        `;
    }

    renderFloatingCart();

    observeReveals();
}

// ===== Order Tracking Utilities =====

// Status display labels
function getStatusLabel(status) {
    const labels = {
        'PENDING':          'Order Placed',
        'ACCEPTED':         'Order Confirmed',
        'PREPARING':        'Being Prepared',
        'OUT_FOR_DELIVERY': 'Out for Delivery',
        'COMPLETED':        'Delivered',
        'REJECTED':         'Cancelled'
    };
    return labels[status] || status;
}

// Status icons
function getStatusIcon(status) {
    const icons = {
        'PENDING':          'fa-clock',
        'ACCEPTED':         'fa-check-circle',
        'PREPARING':        'fa-fire',
        'OUT_FOR_DELIVERY': 'fa-motorcycle',
        'COMPLETED':        'fa-circle-check',
        'REJECTED':         'fa-times-circle'
    };
    return icons[status] || 'fa-circle';
}

// Time formatting
function formatEstimatedTime(timestamp) {
    if (!timestamp) return 'Calculating...';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
}

// Calculate progress percentage
// Delivery:  PENDING → ACCEPTED → PREPARING → OUT_FOR_DELIVERY → COMPLETED
// Takeaway:  PENDING → ACCEPTED → PREPARING → COMPLETED
function getProgressPercentage(currentStatus, orderType) {
    const deliverySteps = ['PENDING', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'COMPLETED'];
    const takeawaySteps = ['PENDING', 'ACCEPTED', 'PREPARING', 'COMPLETED'];

    const steps = orderType === 'DELIVERY' ? deliverySteps : takeawaySteps;
    const currentIndex = steps.indexOf(currentStatus);

    if (currentIndex === -1) return 0;
    return ((currentIndex + 1) / steps.length) * 100;
}

// Start website
initMenu();
