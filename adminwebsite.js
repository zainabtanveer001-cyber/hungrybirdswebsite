// ===== Firebase Initialization (same project as main site) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    initializeFirestore,
    collection,
    getDocs,
    getDoc,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true
});
const storage = getStorage(app);

// Keep this list synchronized with isAdmin() in firestore.rules
const ADMIN_EMAILS = [
    "owner@hungrybirds.com",
    "rehan@hungrybirds-pos.local"
];

const MAX_BANNER_FILES = 5;
const MAX_BANNER_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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

function formatDate(value) {
    if (!value) return "Date unavailable";

    const date = value.toDate ? value.toDate() : new Date(value);

    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

function parseLocalEndOfDay(dateStr) {
    if (!dateStr) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function isValidBannerLink(url) {
    if (!url) return true;
    return /^https?:\/\//i.test(url) || url.startsWith("/");
}

function getFriendlyAuthError(error) {
    const code = error?.code || "";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) {
        return "Invalid email or password.";
    }
    if (code === "auth/invalid-email") {
        return "Please enter a valid email address.";
    }
    if (code === "auth/too-many-requests") {
        return "Too many attempts. Please wait a moment and try again.";
    }
    if (code === "auth/network-request-failed") {
        return "Network error. Check your connection and try again.";
    }
    return "Sign-in failed. Please try again.";
}

function showScreen(screen) {
    ["loginScreen", "deniedScreen", "adminPanel"].forEach(id => {
        $(id)?.classList.toggle("hidden", id !== screen);
    });
}

function setFormMessage(id, message, isError = true) {
    const el = $(id);

    if (!el) return;

    el.textContent = message;
    el.classList.remove("hidden", "text-red-500", "text-green-600");
    el.classList.add(isError ? "text-red-500" : "text-green-600");
}

function hideFormMessage(id) {
    const el = $(id);
    if (el) el.classList.add("hidden");
}

// ===== New Order Notification Sound =====
const newOrderSound = new Audio("mixkit-software-interface-start-2574.wav");
newOrderSound.preload = "auto";

let newOrderListener = null;
const seenOrderIds = new Set();

function cleanupNewOrderListener() {
    if (newOrderListener) {
        newOrderListener();
        newOrderListener = null;
    }
    seenOrderIds.clear();
}

function clearAdminTables() {
    ["customersTable", "ordersTable", "couponsTable", "bannersTable"].forEach(id => {
        const el = $(id);
        if (el) el.innerHTML = "";
    });
    if ($("customersSummary")) $("customersSummary").textContent = "";
    if ($("ordersSummary")) $("ordersSummary").textContent = "";
}

function startNewOrderListener() {
    cleanupNewOrderListener();

    let initialSnapshotLoaded = false;
    const recentOrdersQuery = query(
        collection(db, "onlineOrders"),
        orderBy("createdAt", "desc"),
        limit(100)
    );

    newOrderListener = onSnapshot(
        recentOrdersQuery,
        (snapshot) => {
            if (!initialSnapshotLoaded) {
                snapshot.docs.forEach(d => seenOrderIds.add(d.id));
                initialSnapshotLoaded = true;
                return;
            }

            snapshot.docChanges().forEach(change => {
                if (
                    change.type === "added" &&
                    !seenOrderIds.has(change.doc.id)
                ) {
                    seenOrderIds.add(change.doc.id);
                    newOrderSound.currentTime = 0;
                    newOrderSound.play().catch(() => {
                        // Autoplay blocked until first user interaction — silently ignored
                    });
                }
            });
        },
        (error) => {
            console.error("New order listener error:", error);
        }
    );
}

// ===== Auth gating =====
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        cleanupNewOrderListener();
        clearAdminTables();
        showScreen("loginScreen");
        return;
    }

    if (!ADMIN_EMAILS.includes(user.email)) {
        cleanupNewOrderListener();
        clearAdminTables();
        showScreen("deniedScreen");
        return;
    }

    showScreen("adminPanel");
    await Promise.all([loadCoupons(), loadCustomerData(), loadBanners()]);
    startNewOrderListener();
});

$("adminLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = $("adminEmail").value.trim();
    const password = $("adminPassword").value;
    const signInBtn = $("adminSignInBtn");

    hideFormMessage("adminLoginError");
    if (signInBtn) {
        signInBtn.disabled = true;
        signInBtn.textContent = "Signing In...";
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
        $("adminPassword").value = "";
    } catch (error) {
        console.error("Admin sign-in error:", error?.code || error);
        setFormMessage("adminLoginError", getFriendlyAuthError(error));
    } finally {
        if (signInBtn) {
            signInBtn.disabled = false;
            signInBtn.textContent = "Sign In";
        }
    }
});

$("adminForgotPasswordBtn")?.addEventListener("click", async () => {
    const email = $("adminEmail")?.value.trim();
    if (!email) {
        setFormMessage("adminLoginError", "Enter your admin email first to reset your password.");
        return;
    }
    try {
        await sendPasswordResetEmail(auth, email);
        setFormMessage("adminLoginError", "Password reset email sent if that account exists.", false);
    } catch (error) {
        console.error("Password reset error:", error?.code || error);
        setFormMessage("adminLoginError", getFriendlyAuthError(error));
    }
});

$("adminSignOutBtn")?.addEventListener("click", () => signOut(auth));
$("deniedSignOutBtn")?.addEventListener("click", () => signOut(auth));
$("refreshAdminDataBtn")?.addEventListener("click", () =>
    Promise.all([loadCoupons(), loadCustomerData(), loadBanners()])
);

// ===== Customer and order listing =====
async function loadCustomerData() {
    const customersContainer = $("customersTable");
    const ordersContainer = $("ordersTable");

    if (!customersContainer || !ordersContainer) return;

    const loading = `<div class="text-center text-gray-500 py-6"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    customersContainer.innerHTML = loading;
    ordersContainer.innerHTML = loading;

    try {
        const [usersSnapshot, ordersSnapshot, couponsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "users"), limit(200))),
            getDocs(query(collection(db, "onlineOrders"), orderBy("createdAt", "desc"), limit(100))),
            getDocs(query(collection(db, "coupons"), limit(200)))
        ]);

        const couponsByCustomer = new Map();
        couponsSnapshot.forEach((couponSnap) => {
            const coupon = couponSnap.data();

            if (coupon.assignedTo) {
                const assignedCoupons = couponsByCustomer.get(coupon.assignedTo) || [];
                assignedCoupons.push(coupon.code || couponSnap.id);
                couponsByCustomer.set(coupon.assignedTo, assignedCoupons);
            }
        });

        const customers = new Map(usersSnapshot.docs.map((userSnap) => [
            userSnap.id,
            { uid: userSnap.id, ...userSnap.data(), orders: [] }
        ]));

        const orders = ordersSnapshot.docs.map((orderSnap) => ({
            id: orderSnap.id,
            ...orderSnap.data()
        })).sort((first, second) => {
            const firstTime = first.createdAt?.toMillis?.() || 0;
            const secondTime = second.createdAt?.toMillis?.() || 0;
            return secondTime - firstTime;
        });

        orders.forEach((order) => {
            const uid = order.customerUid || "guest";

            if (!customers.has(uid)) {
                customers.set(uid, {
                    uid,
                    email: "No account email",
                    orders: []
                });
            }

            customers.get(uid).orders.push(order);
        });

        renderCustomers([...customers.values()], couponsByCustomer);
        renderOrders(orders);
    } catch (error) {
        console.error("Failed to load customer data:", error);
        customersContainer.innerHTML = `<p class="text-red-500 text-sm">Could not load customers. Check Firestore admin permissions.</p>`;
        ordersContainer.innerHTML = `<p class="text-red-500 text-sm">Could not load orders. Check Firestore admin permissions.</p>`;
    }
}

function renderCustomers(customers, couponsByCustomer) {
    const container = $("customersTable");
    const summary = $("customersSummary");

    if (!container) return;

    const sortedCustomers = customers.sort((first, second) => second.orders.length - first.orders.length);
    if (summary) summary.textContent = `${sortedCustomers.length} customer${sortedCustomers.length === 1 ? "" : "s"}`;

    if (!sortedCustomers.length) {
        container.innerHTML = `<p class="text-gray-500 text-sm">No customer records yet.</p>`;
        return;
    }

    container.innerHTML = sortedCustomers.map((customer) => {
        const latestOrder = customer.orders[0];
        const contact = latestOrder?.customer || {};
        const assignedCoupons = couponsByCustomer.get(customer.uid) || [];
        const usedCoupons = [...new Set(customer.orders.map((order) => order.couponCode).filter(Boolean))];

        return `
            <article class="border border-gray-100 rounded-2xl p-4">
                <div class="flex flex-col sm:flex-row sm:justify-between gap-3">
                    <div class="min-w-0">
                        <h3 class="font-bold text-gray-900">${escapeHTML(contact.name || customer.email || "Customer")}</h3>
                        <p class="text-sm text-gray-500 break-words">${escapeHTML(customer.email || "No account email")}</p>
                        <p class="text-sm text-gray-500">${escapeHTML(contact.phone || "No phone recorded")}${contact.address ? ` · ${escapeHTML(contact.address)}` : ""}</p>
                    </div>
                    <div class="sm:text-right text-sm shrink-0">
                        <p class="font-bold text-gray-900">${customer.orders.length} order${customer.orders.length === 1 ? "" : "s"}</p>
                        <p class="text-gray-500">${latestOrder ? `Last order: ${escapeHTML(formatDate(latestOrder.createdAt))}` : "No orders yet"}</p>
                    </div>
                </div>
                <div class="mt-3 text-xs text-gray-500">
                    Coupons used: <span class="font-semibold text-gray-700">${escapeHTML(usedCoupons.join(", ") || "None")}</span>
                    ${assignedCoupons.length ? ` · Assigned: <span class="font-semibold text-gray-700">${escapeHTML(assignedCoupons.join(", "))}</span>` : ""}
                </div>
            </article>
        `;
    }).join("");
}

function renderOrders(orders) {
    const container = $("ordersTable");
    const summary = $("ordersSummary");

    if (!container) return;
    if (summary) summary.textContent = `${orders.length} order${orders.length === 1 ? "" : "s"}`;

    if (!orders.length) {
        container.innerHTML = `<p class="text-gray-500 text-sm">No online orders yet.</p>`;
        return;
    }

    container.innerHTML = orders.map((order) => {
        const customer = order.customer || {};
        const items = (order.items || []).map((item) => `${item.name} x ${item.qty}`).join(", ");

        return `
            <article class="border border-gray-100 rounded-2xl p-4">
                <div class="flex flex-col sm:flex-row sm:justify-between gap-3">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                            <h3 class="font-bold text-gray-900">${escapeHTML(customer.name || "Customer")}</h3>
                            <span class="text-xs font-bold uppercase text-orange-600">${escapeHTML(order.status || "Pending")}</span>
                        </div>
                        <p class="text-sm text-gray-500">${escapeHTML(formatDate(order.createdAt))} · ${escapeHTML(order.orderType || "Order")}</p>
                        <p class="text-sm text-gray-700 mt-2">${escapeHTML(items || "No items recorded")}</p>
                        <p class="text-xs text-gray-500 mt-1">${escapeHTML(customer.phone || "No phone")} ${customer.address ? `· ${escapeHTML(customer.address)}` : ""}</p>
                    </div>
                    <div class="sm:text-right shrink-0">
                        <p class="font-black text-gray-900">Rs. ${Number(order.total || 0).toLocaleString()}</p>
                        <p class="text-xs text-gray-500">Coupon: <span class="font-semibold">${escapeHTML(order.couponCode || "None")}</span></p>
                        ${Number(order.discountAmount || 0) > 0 ? `<p class="text-xs text-green-600">Saved Rs. ${Number(order.discountAmount).toLocaleString()}</p>` : ""}
                    </div>
                </div>
            </article>
        `;
    }).join("");
}

// ===== Coupon creation =====
async function resolveUidByEmail(email) {
    if (!email) return null;

    const snapshot = await getDocs(
        query(collection(db, "users"), where("email", "==", email), limit(1))
    );

    return snapshot.empty ? null : snapshot.docs[0].id;
}

$("couponForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const code = $("couponCodeField").value.trim().toUpperCase();
    const discountPercent = Number($("couponDiscountField").value);
    const type = $("couponTypeField").value;
    const assignedEmail = $("couponAssignedEmailField").value.trim();
    const maxUsesRaw = $("couponMaxUsesField").value;
    const expiryRaw = $("couponExpiryField").value;
    const submitBtn = $("couponSubmitBtn");

    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        setFormMessage("couponFormMessage", "Coupon code must be 3–32 characters (letters, numbers, - or _).");
        return;
    }

    if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 100) {
        setFormMessage("couponFormMessage", "Discount % must be between 1 and 100.");
        return;
    }

    if (type === "loyalty" && !assignedEmail) {
        setFormMessage("couponFormMessage", "Loyalty coupons require an assigned customer email.");
        return;
    }

    const maxUses = maxUsesRaw ? Number(maxUsesRaw) : null;
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
        setFormMessage("couponFormMessage", "Max uses must be a positive whole number.");
        return;
    }

    if (submitBtn) submitBtn.disabled = true;

    try {
        const existingCoupon = await getDoc(doc(db, "coupons", code));
        if (existingCoupon.exists()) {
            setFormMessage("couponFormMessage", `Coupon ${code} already exists.`);
            return;
        }

        let assignedTo = null;

        if (assignedEmail) {
            assignedTo = await resolveUidByEmail(assignedEmail);

            if (!assignedTo) {
                setFormMessage(
                    "couponFormMessage",
                    "No customer account found for that email (they must sign in at least once)."
                );
                return;
            }
        }

        await setDoc(doc(db, "coupons", code), {
            code,
            discountPercent,
            type,
            assignedTo,
            active: true,
            singleUse: type === "loyalty",
            used: false,
            usedCount: 0,
            maxUses: type === "promo" ? maxUses : null,
            expiresAt: parseLocalEndOfDay(expiryRaw),
            createdAt: serverTimestamp()
        });

        setFormMessage("couponFormMessage", `Coupon ${code} created.`, false);
        $("couponForm").reset();

        await loadCoupons();

    } catch (error) {
        console.error("Coupon creation error:", error);
        setFormMessage("couponFormMessage", "Could not create coupon.");
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
});

// ===== Coupon listing =====
async function loadCoupons() {
    const container = $("couponsTable");

    if (!container) return;

    container.innerHTML = `<div class="text-center text-gray-500 py-6"><i class="fa-solid fa-spinner fa-spin"></i></div>`;

    try {
        const snapshot = await getDocs(query(collection(db, "coupons"), limit(200)));

        if (snapshot.empty) {
            container.innerHTML = `<p class="text-gray-500 text-sm">No coupons yet.</p>`;
            return;
        }

        container.innerHTML = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            const safeId = escapeHTML(docSnap.id);
            const safeCode = escapeHTML(data.code || docSnap.id);
            const safeType = escapeHTML(data.type || "promo");
            const safeDiscount = Number(data.discountPercent || 0);

            return `
                <div class="flex justify-between items-center border border-gray-100 rounded-2xl p-3">
                    <div>
                        <div class="font-bold">${safeCode} <span class="text-xs font-normal text-gray-500">(${safeType})</span></div>
                        <div class="text-sm text-gray-500">${safeDiscount}% off ${data.assignedTo ? "· assigned" : "· public"}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" data-id="${safeId}" data-active="${Boolean(data.active)}" class="toggle-coupon text-xs px-3 py-1.5 rounded-full ${data.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}">
                            ${data.active ? "Active" : "Inactive"}
                        </button>
                        <button type="button" data-id="${safeId}" aria-label="Delete coupon ${safeCode}" class="delete-coupon w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100">
                            <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        container.querySelectorAll(".toggle-coupon").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const nowActive = btn.dataset.active === "true";
                try {
                    await updateDoc(doc(db, "coupons", id), { active: !nowActive });
                    await loadCoupons();
                } catch (error) {
                    console.error("Failed to toggle coupon:", error);
                    setFormMessage("couponFormMessage", "Could not update coupon status.");
                }
            });
        });

        container.querySelectorAll(".delete-coupon").forEach(btn => {
            btn.addEventListener("click", async () => {
                try {
                    await deleteDoc(doc(db, "coupons", btn.dataset.id));
                    await loadCoupons();
                } catch (error) {
                    console.error("Failed to delete coupon:", error);
                    setFormMessage("couponFormMessage", "Could not delete coupon.");
                }
            });
        });

    } catch (error) {
        console.error("Failed to load coupons:", error);
        container.innerHTML = `<p class="text-red-500 text-sm">Could not load coupons.</p>`;
    }
}

// ===== Image Compression Utility =====
async function compressImage(file, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;

                // Scale down if too large
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
                resolve(compressedDataUrl);
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
}

// ===== DataURL to Blob =====
function dataURLToBlob(dataURL) {
    const arr = dataURL.split(",");
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

// ===== Upload Image to Firebase Storage =====
async function uploadImage(file, bannerId, index) {
    const compressedDataUrl = await compressImage(file);
    const blob = dataURLToBlob(compressedDataUrl);

    const storageRef = ref(storage, `banners/${bannerId}/image_${index}_${Date.now()}.jpg`);
    await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });

    return await getDownloadURL(storageRef);
}

// ===== Image Preview Handler =====
$("bannerImagesField")?.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    const previewContainer = $("imagePreviewContainer");
    const preview = $("imagePreview");

    if (!files.length) {
        previewContainer.classList.add("hidden");
        return;
    }

    if (files.length > MAX_BANNER_FILES) {
        setFormMessage("bannerFormMessage", `Please select at most ${MAX_BANNER_FILES} images.`);
        event.target.value = "";
        previewContainer.classList.add("hidden");
        return;
    }

    for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
            setFormMessage("bannerFormMessage", `Unsupported image format: ${file.name}. Use JPEG, PNG, WebP, or GIF.`);
            event.target.value = "";
            previewContainer.classList.add("hidden");
            return;
        }
        if (file.size > MAX_BANNER_BYTES) {
            setFormMessage("bannerFormMessage", `${file.name} exceeds the 5 MB limit.`);
            event.target.value = "";
            previewContainer.classList.add("hidden");
            return;
        }
    }

    hideFormMessage("bannerFormMessage");
    previewContainer.classList.remove("hidden");
    preview.innerHTML = "";

    files.forEach((file, index) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const div = document.createElement("div");
            div.className = "relative";

            const img = document.createElement("img");
            img.src = e.target.result;
            img.alt = `Banner preview ${index + 1}`;
            img.className = "w-full h-20 object-cover rounded-lg border border-gray-200";

            const badge = document.createElement("span");
            badge.className = "absolute -top-2 -right-2 bg-orange-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center";
            badge.textContent = String(index + 1);

            div.appendChild(img);
            div.appendChild(badge);
            preview.appendChild(div);
        };
    });
});

// ===== Banner Management =====
async function loadBanners() {
    const container = $("bannersTable");

    if (!container) return;

    container.innerHTML = `<div class="text-center text-gray-500 py-6"><i class="fa-solid fa-spinner fa-spin"></i></div>`;

    try {
        const snapshot = await getDocs(query(collection(db, "banners"), limit(50)));

        if (snapshot.empty) {
            container.innerHTML = `<p class="text-gray-500 text-sm">No banners yet.</p>`;
            return;
        }

        const bannersById = new Map(
            snapshot.docs.map(docSnap => [docSnap.id, docSnap.data()])
        );

        container.innerHTML = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            const safeId = escapeHTML(docSnap.id);
            const safeTitle = escapeHTML(data.title || "Banner");
            const safeDescription = escapeHTML(data.description || "No description");
            const safeType = escapeHTML(data.type || "promo");
            const imageCount = Array.isArray(data.imageUrls) ? data.imageUrls.length : 0;

            return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center border border-gray-100 rounded-2xl p-3 gap-3">
                    <div class="flex-1">
                        <div class="font-bold text-sm">${safeTitle}</div>
                        <div class="text-xs text-gray-500">${safeDescription}</div>
                        <div class="text-xs text-gray-500 mt-1">${safeType} · ${imageCount} image${imageCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="flex items-center gap-2 w-full sm:w-auto">
                        <button type="button" data-id="${safeId}" data-active="${Boolean(data.active)}" class="toggle-banner text-xs px-3 py-1.5 rounded-full ${data.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"} flex-1 sm:flex-none">
                            ${data.active ? "Active" : "Inactive"}
                        </button>
                        <button type="button" data-id="${safeId}" aria-label="Delete banner ${safeTitle}" class="delete-banner w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100">
                            <i class="fa-solid fa-trash text-xs" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        container.querySelectorAll(".toggle-banner").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const nowActive = btn.dataset.active === "true";
                try {
                    await updateDoc(doc(db, "banners", id), { active: !nowActive });
                    await loadBanners();
                } catch (error) {
                    console.error("Failed to toggle banner:", error);
                    setFormMessage("bannerFormMessage", "Could not update banner status.");
                }
            });
        });

        container.querySelectorAll(".delete-banner").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const banner = bannersById.get(id);
                const urls = Array.isArray(banner?.imageUrls) ? banner.imageUrls : [];
                try {
                    await Promise.allSettled(
                        urls.map(url => deleteObject(ref(storage, url)))
                    );
                    await deleteDoc(doc(db, "banners", id));
                    await loadBanners();
                } catch (error) {
                    console.error("Failed to delete banner:", error);
                    setFormMessage("bannerFormMessage", "Could not delete banner.");
                }
            });
        });

    } catch (error) {
        console.error("Failed to load banners:", error);
        container.innerHTML = `<p class="text-red-500 text-sm">Could not load banners.</p>`;
    }
}

$("bannerForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const files = Array.from($("bannerImagesField").files || []);
    const title = $("bannerTitleField").value.trim();
    const description = $("bannerDescriptionField").value.trim();
    const link = $("bannerLinkField").value.trim();
    const type = $("bannerTypeField").value;
    const active = $("bannerActiveField").checked;
    const submitBtn = $("bannerSubmitBtn");

    if (!files.length || !title) {
        setFormMessage("bannerFormMessage", "At least one image and a title are required.");
        return;
    }

    if (files.length > MAX_BANNER_FILES) {
        setFormMessage("bannerFormMessage", `You can upload up to ${MAX_BANNER_FILES} images per banner.`);
        return;
    }

    for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_BANNER_BYTES) {
            setFormMessage("bannerFormMessage", "Each file must be a JPEG, PNG, WebP, or GIF under 5 MB.");
            return;
        }
    }

    if (!isValidBannerLink(link)) {
        setFormMessage("bannerFormMessage", "Banner link must start with https://, http://, or /.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Uploading...`;

    try {
        const bannerId = `banner_${Date.now()}`;

        const imageUrls = [];
        for (let i = 0; i < files.length; i++) {
            const url = await uploadImage(files[i], bannerId, i);
            imageUrls.push(url);
        }

        await setDoc(doc(db, "banners", bannerId), {
            imageUrls,
            title,
            description,
            link,
            type,
            active,
            order: 0,
            createdAt: serverTimestamp()
        });

        setFormMessage("bannerFormMessage", `Banner created with ${imageUrls.length} image(s).`, false);
        $("bannerForm").reset();
        $("imagePreviewContainer").classList.add("hidden");

        await loadBanners();

    } catch (error) {
        console.error("Banner creation error:", error);
        setFormMessage("bannerFormMessage", "Could not create banner. Please try again.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Banner";
    }
});
