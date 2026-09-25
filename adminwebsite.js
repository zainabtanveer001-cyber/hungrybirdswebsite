// ===== Firebase Initialization (same project as main site) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
const storage = getStorage(app);

// Only these accounts may manage coupons; real enforcement must live in Firestore security rules
const ADMIN_EMAILS = [
    "owner@hungrybirds.com",
    "rehan@hungrybirds-pos.local"
];

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

// ===== Auth gating =====
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        showScreen("loginScreen");
        return;
    }

    if (!ADMIN_EMAILS.includes(user.email)) {
        showScreen("deniedScreen");
        return;
    }

    showScreen("adminPanel");
    await Promise.all([loadCoupons(), loadCustomerData(), loadBanners()]);
    startNewOrderListener();
});

// ===== New Order Notification Sound =====
const newOrderSound = new Audio("mixkit-software-interface-start-2574.wav");
newOrderSound.preload = "auto";

let newOrderListener = null;
const seenOrderIds = new Set();

function startNewOrderListener() {
    // Avoid duplicate listeners on re-auth
    if (newOrderListener) {
        newOrderListener();
        newOrderListener = null;
    }

    // Seed seen IDs with current orders so we don't fire on page load
    getDocs(collection(db, "onlineOrders")).then(snapshot => {
        snapshot.docs.forEach(d => seenOrderIds.add(d.id));

        // Now start listening — only orders added after this point are "new"
        newOrderListener = onSnapshot(
            collection(db, "onlineOrders"),
            (snapshot) => {
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
            }
        );
    });
}

$("adminLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = $("adminEmail").value.trim();
    const password = $("adminPassword").value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Admin sign-in error:", error);
        setFormMessage("adminLoginError", error.message || "Sign-in failed.");
        $("adminLoginError").classList.remove("hidden");
    }
});

$("adminSignOutBtn")?.addEventListener("click", () => signOut(auth));
$("deniedSignOutBtn")?.addEventListener("click", () => signOut(auth));
$("refreshAdminDataBtn")?.addEventListener("click", () => loadCustomerData());

// ===== Customer and order listing =====
async function loadCustomerData() {
    const customersContainer = $("customersTable");
    const ordersContainer = $("ordersTable");

    if (!customersContainer || !ordersContainer) return;

    const loading = `<div class="text-center text-gray-400 py-6"><i class="fa-solid fa-spinner fa-spin"></i></div>`;
    customersContainer.innerHTML = loading;
    ordersContainer.innerHTML = loading;

    try {
        const [usersSnapshot, ordersSnapshot, couponsSnapshot] = await Promise.all([
            getDocs(collection(db, "users")),
            getDocs(collection(db, "onlineOrders")),
            getDocs(collection(db, "coupons"))
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
        container.innerHTML = `<p class="text-gray-400 text-sm">No customer records yet.</p>`;
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
        container.innerHTML = `<p class="text-gray-400 text-sm">No online orders yet.</p>`;
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
        query(collection(db, "users"), where("email", "==", email))
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

    if (!code || !discountPercent) {
        setFormMessage("couponFormMessage", "Code and discount % are required.");
        $("couponFormMessage").classList.remove("hidden");
        return;
    }

    try {
        let assignedTo = null;

        if (assignedEmail) {
            assignedTo = await resolveUidByEmail(assignedEmail);

            if (!assignedTo) {
                setFormMessage(
                    "couponFormMessage",
                    "No customer account found for that email (they must sign in at least once)."
                );
                $("couponFormMessage").classList.remove("hidden");
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
            maxUses: maxUsesRaw ? Number(maxUsesRaw) : null,
            expiresAt: expiryRaw ? new Date(expiryRaw) : null,
            createdAt: serverTimestamp()
        });

        setFormMessage("couponFormMessage", `Coupon ${code} created.`, false);
        $("couponFormMessage").classList.remove("hidden");
        $("couponForm").reset();

        await loadCoupons();

    } catch (error) {
        console.error("Coupon creation error:", error);
        setFormMessage("couponFormMessage", "Could not create coupon.");
        $("couponFormMessage").classList.remove("hidden");
    }
});

// ===== Coupon listing =====
async function loadCoupons() {
    const container = $("couponsTable");

    if (!container) return;

    container.innerHTML = `<div class="text-center text-gray-400 py-6"><i class="fa-solid fa-spinner fa-spin"></i></div>`;

    try {
        const snapshot = await getDocs(collection(db, "coupons"));

        if (snapshot.empty) {
            container.innerHTML = `<p class="text-gray-400 text-sm">No coupons yet.</p>`;
            return;
        }

        container.innerHTML = snapshot.docs.map(docSnap => {
            const data = docSnap.data();

            return `
                <div class="flex justify-between items-center border border-gray-100 rounded-2xl p-3">
                    <div>
                        <div class="font-bold">${data.code} <span class="text-xs font-normal text-gray-400">(${data.type})</span></div>
                        <div class="text-sm text-gray-500">${data.discountPercent}% off ${data.assignedTo ? "· assigned" : "· public"}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button data-id="${docSnap.id}" data-active="${data.active}" class="toggle-coupon text-xs px-3 py-1.5 rounded-full ${data.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}">
                            ${data.active ? "Active" : "Inactive"}
                        </button>
                        <button data-id="${docSnap.id}" class="delete-coupon w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        container.querySelectorAll(".toggle-coupon").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const nowActive = btn.dataset.active === "true";

                await updateDoc(doc(db, "coupons", id), { active: !nowActive });
                await loadCoupons();
            });
        });

        container.querySelectorAll(".delete-coupon").forEach(btn => {
            btn.addEventListener("click", async () => {
                await deleteDoc(doc(db, "coupons", btn.dataset.id));
                await loadCoupons();
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
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                // Compress to JPEG with quality
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
    await uploadBytes(storageRef, blob);

    return await getDownloadURL(storageRef);
}

// ===== Image Preview Handler =====
$("bannerImagesField")?.addEventListener("change", (event) => {
    const files = event.target.files;
    const previewContainer = $("imagePreviewContainer");
    const preview = $("imagePreview");

    if (!files.length) {
        previewContainer.classList.add("hidden");
        return;
    }

    previewContainer.classList.remove("hidden");
    preview.innerHTML = "";

    Array.from(files).forEach((file, index) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const div = document.createElement("div");
            div.className = "relative";
            div.innerHTML = `
                <img src="${e.target.result}" class="w-full h-20 object-cover rounded-lg border border-gray-200">
                <span class="absolute -top-2 -right-2 bg-orange-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">${index + 1}</span>
            `;
            preview.appendChild(div);
        };
    });
});

// ===== Banner Management =====
async function loadBanners() {
    const container = $("bannersTable");

    if (!container) return;

    container.innerHTML = `<div class="text-center text-gray-400 py-6"><i class="fa-solid fa-spinner fa-spin"></i></div>`;

    try {
        const snapshot = await getDocs(collection(db, "banners"));

        if (snapshot.empty) {
            container.innerHTML = `<p class="text-gray-400 text-sm">No banners yet.</p>`;
            return;
        }

        container.innerHTML = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            const imageCount = data.imageUrls ? data.imageUrls.length : 0;

            return `
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center border border-gray-100 rounded-2xl p-3 gap-3">
                    <div class="flex-1">
                        <div class="font-bold text-sm">${escapeHTML(data.title)}</div>
                        <div class="text-xs text-gray-500">${escapeHTML(data.description || "No description")}</div>
                        <div class="text-xs text-gray-400 mt-1">${data.type} · ${imageCount} image${imageCount !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="flex items-center gap-2 w-full sm:w-auto">
                        <button data-id="${docSnap.id}" data-active="${data.active}" class="toggle-banner text-xs px-3 py-1.5 rounded-full ${data.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"} flex-1 sm:flex-none">
                            ${data.active ? "Active" : "Inactive"}
                        </button>
                        <button data-id="${docSnap.id}" class="delete-banner w-8 h-8 rounded-xl bg-red-50 text-red-500 hover:bg-red-100">
                            <i class="fa-solid fa-trash text-xs"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        container.querySelectorAll(".toggle-banner").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                const nowActive = btn.dataset.active === "true";

                await updateDoc(doc(db, "banners", id), { active: !nowActive });
                await loadBanners();
            });
        });

        container.querySelectorAll(".delete-banner").forEach(btn => {
            btn.addEventListener("click", async () => {
                await deleteDoc(doc(db, "banners", btn.dataset.id));
                await loadBanners();
            });
        });

    } catch (error) {
        console.error("Failed to load banners:", error);
        container.innerHTML = `<p class="text-red-500 text-sm">Could not load banners.</p>`;
    }
}

$("bannerForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const files = $("bannerImagesField").files;
    const title = $("bannerTitleField").value.trim();
    const description = $("bannerDescriptionField").value.trim();
    const link = $("bannerLinkField").value.trim();
    const type = $("bannerTypeField").value;
    const active = $("bannerActiveField").checked;
    const submitBtn = $("bannerSubmitBtn");

    if (!files.length || !title) {
        setFormMessage("bannerFormMessage", "At least one image and a title are required.");
        $("bannerFormMessage").classList.remove("hidden");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Uploading...`;

    try {
        const bannerId = `banner_${Date.now()}`;

        // Upload all images and get their URLs
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
        $("bannerFormMessage").classList.remove("hidden");
        $("bannerForm").reset();
        $("imagePreviewContainer").classList.add("hidden");

        await loadBanners();

    } catch (error) {
        console.error("Banner creation error:", error);
        setFormMessage("bannerFormMessage", "Could not create banner. Please try again.");
        $("bannerFormMessage").classList.remove("hidden");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Banner";
    }
});
