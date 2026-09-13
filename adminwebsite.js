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
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// Only these accounts may manage coupons; real enforcement must live in Firestore security rules
const ADMIN_EMAILS = [
    "owner@hungrybirds.com",
    "rehan@hungrybirds-pos.local"
];

const $ = (id) => document.getElementById(id);

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
    await loadCoupons();
});

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
