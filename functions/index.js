const crypto = require("crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");

initializeApp();
const db = getFirestore();

const DELIVERY_MIN_SUBTOTAL = 500;

/**
 * Generates a cryptographically strong, readable loyalty coupon code.
 */
function generateLoyaltyCode() {
  return `LOYAL${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

/**
 * Builds a PII-free tracking projection document from an onlineOrders record.
 */
function buildTrackingProjection(orderId, data) {
  const projection = {
    orderId,
    status: data.status || "PENDING",
    orderType: data.orderType || "DELIVERY",
    total: Number(data.total || 0),
    createdAt: data.createdAt || FieldValue.serverTimestamp(),
  };

  const optionalFields = [
    "pendingAt",
    "acceptedAt",
    "preparingAt",
    "out_for_deliveryAt",
    "completedAt",
    "rejectedAt",
    "estimatedReadyTime",
    "rejectionReason",
  ];

  for (const field of optionalFields) {
    if (data[field] !== undefined) {
      projection[field] = data[field];
    }
  }

  return projection;
}

/**
 * Syncs newly created orders to the non-PII /orderTracking projection
 * and mints a server-generated 10% loyalty coupon every 10th order.
 */
exports.onOrderCreated = onDocumentCreated("onlineOrders/{orderId}", async (event) => {
  const snap = event.data;
  if (!snap) return;

  const orderId = event.params.orderId;
  const data = snap.data() || {};

  await db.collection("orderTracking").doc(orderId).set(buildTrackingProjection(orderId, data), {
    merge: true,
  });

  if (!data.customerUid) return;

  const userRef = db.collection("users").doc(data.customerUid);
  const shouldIssueLoyalty = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const currentCount = Number(userSnap.data()?.orderCount || 0);
    return currentCount > 0 && currentCount % 10 === 0;
  });

  if (shouldIssueLoyalty) {
    const code = generateLoyaltyCode();
    await db.collection("coupons").doc(code).create({
      code,
      discountPercent: 10,
      type: "loyalty",
      assignedTo: data.customerUid,
      active: true,
      singleUse: true,
      used: false,
      usedCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
});

/**
 * Keeps the non-PII /orderTracking projection synchronized whenever POS updates order status.
 */
exports.onOrderUpdated = onDocumentUpdated("onlineOrders/{orderId}", async (event) => {
  const afterSnap = event.data?.after;
  if (!afterSnap) return;

  const orderId = event.params.orderId;
  const data = afterSnap.data() || {};

  await db.collection("orderTracking").doc(orderId).set(buildTrackingProjection(orderId, data), {
    merge: true,
  });
});

/**
 * Server-verified checkout callable that recomputes prices from /menu,
 * validates & consumes coupons atomically, and enforces Rs. 500 delivery minimum.
 */
exports.createVerifiedOrder = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required to place an order.");
  }

  const uid = request.auth.uid;
  const { items, orderType, customer, couponCode } = request.data || {};

  if (!["DELIVERY", "TAKEAWAY"].includes(orderType)) {
    throw new HttpsError("invalid-argument", "Invalid order type.");
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpsError("invalid-argument", "Order must contain between 1 and 50 items.");
  }

  const phone = String(customer?.phone || "").trim();
  const address = orderType === "DELIVERY" ? String(customer?.address || "").trim() : "";
  const name = String(customer?.name || request.auth.token?.email?.split("@")[0] || "Customer").trim();

  if (phone.replace(/\D/g, "").length < 7 || phone.length > 20) {
    throw new HttpsError("invalid-argument", "A valid phone number is required.");
  }
  if (orderType === "DELIVERY" && !address) {
    throw new HttpsError("invalid-argument", "Delivery address is required.");
  }

  const result = await db.runTransaction(async (tx) => {
    const verifiedItems = [];
    let subtotal = 0;

    for (const rawItem of items) {
      const itemId = String(rawItem?.menuItemId || rawItem?.id || "").trim();
      const qty = Number(rawItem?.qty);
      if (!itemId || !Number.isInteger(qty) || qty <= 0 || qty > 99) {
        throw new HttpsError("invalid-argument", "Invalid menu item or quantity.");
      }

      const menuSnap = await tx.get(db.collection("menu").doc(itemId));
      if (!menuSnap.exists) {
        throw new HttpsError("not-found", `Menu item ${itemId} no longer exists.`);
      }
      const menuData = menuSnap.data();
      const price = Number(menuData.price ?? menuData.sellingPrice ?? menuData.salePrice ?? menuData.customerPrice);
      if (!Number.isFinite(price) || price < 0) {
        throw new HttpsError("failed-precondition", `Invalid menu price for ${itemId}.`);
      }

      subtotal += price * qty;
      verifiedItems.push({
        id: itemId,
        menuItemId: itemId,
        name: String(menuData.name || menuData.displayName || menuData.title || "Item"),
        price,
        qty,
      });
    }

    if (orderType === "DELIVERY" && subtotal < DELIVERY_MIN_SUBTOTAL) {
      throw new HttpsError("failed-precondition", `Minimum order for delivery is Rs. ${DELIVERY_MIN_SUBTOTAL}.`);
    }

    let discountAmount = 0;
    let appliedCode = null;

    if (couponCode) {
      const normalizedCode = String(couponCode).trim().toUpperCase();
      const couponRef = db.collection("coupons").doc(normalizedCode);
      const couponSnap = await tx.get(couponRef);
      if (!couponSnap.exists) {
        throw new HttpsError("not-found", "Invalid coupon code.");
      }
      const coupon = couponSnap.data();
      if (!coupon.active) {
        throw new HttpsError("failed-precondition", "This coupon is no longer active.");
      }
      if (coupon.singleUse && coupon.used) {
        throw new HttpsError("failed-precondition", "This coupon has already been used.");
      }
      if (!coupon.singleUse && coupon.maxUses && (coupon.usedCount || 0) >= coupon.maxUses) {
        throw new HttpsError("failed-precondition", "This coupon has reached its usage limit.");
      }
      if (coupon.assignedTo && coupon.assignedTo !== uid) {
        throw new HttpsError("permission-denied", "This coupon is not valid for your account.");
      }
      if (coupon.expiresAt && coupon.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "This coupon has expired.");
      }

      discountAmount = Math.round(subtotal * (Number(coupon.discountPercent || 0) / 100));
      appliedCode = normalizedCode;

      if (coupon.singleUse) {
        tx.update(couponRef, { active: false, used: true });
      } else {
        tx.update(couponRef, { usedCount: FieldValue.increment(1) });
      }
    }

    const total = Math.max(0, subtotal - discountAmount);
    const orderRef = db.collection("onlineOrders").doc();
    const now = FieldValue.serverTimestamp();

    tx.set(orderRef, {
      items: verifiedItems,
      subtotal,
      discountAmount,
      couponCode: appliedCode,
      total,
      orderType,
      customer: { name, phone, address },
      customerUid: uid,
      status: "PENDING",
      source: "website",
      createdAt: now,
    });

    tx.set(
      db.collection("users").doc(uid),
      {
        email: request.auth.token?.email || "",
        orderCount: FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true }
    );

    return { orderId: orderRef.id, total, discountAmount };
  });

  return result;
});
