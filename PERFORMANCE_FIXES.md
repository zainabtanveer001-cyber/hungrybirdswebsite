# Restaurant Website Performance Fixes

## Priority 1 - Immediate Wins (30 min)

### 1. Remove Tailwind CDN, use pre-built CSS
**Impact:** 70-80% faster initial load
**Change:** Replace `<script src="https://cdn.tailwindcss.com"></script>` with a static Tailwind build

### 2. Add Firestore indexes
**Impact:** 50% faster queries
**Files:** Firebase Console → Firestore → Indexes
- Create composite index: `onlineOrders` collection on `(customerUid, createdAt DESC)`
- Create composite index: `coupons` collection on `(assignedTo, active, used)`

### 3. Limit query results
**Impact:** Faster load, less bandwidth
**Files:** appwebsite.js
- Past orders: limit to 20 most recent
- Coupons query: add `where("active", "==", true)` for active tab
- Track order: query only active orders first

### 4. Cleanup listeners properly
**Impact:** Stops background bandwidth drain
**Files:** appwebsite.js
- Unsubscribe `pastOrdersListener` when modal closes
- Unsubscribe `activeOrderListener` when track modal closes

## Priority 2 - Medium Effort (1-2 hours)

### 5. Lazy load images
Add `loading="lazy"` to menu item images

### 6. Add service worker for offline menu caching

### 7. Debounce cart updates
Don't re-render cart on every increment - batch updates

## Priority 3 - Long Term

### 8. Image CDN (Cloudinary/ImgIx)
Serve optimized, resized images

### 9. Code splitting
Load coupons/orders code only when needed

### 10. Bundle Firebase SDK locally
Stop loading from CDN on every visit
