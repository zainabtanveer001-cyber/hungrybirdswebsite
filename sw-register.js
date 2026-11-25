// ===== Self-Healing Service Worker Bootstrap =====
// Loaded as a classic same-origin script before appwebsite.js so browsers stuck on
// legacy pre-v9 Service Workers/caches automatically purge stale cached bundles
// and recover.
(function bootstrapServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    const CURRENT_CACHE = "hungrybirds-cache-v9";
    const MIGRATION_FLAG = "hb_sw_migrated_v9";

    async function recoverOrRegister() {
        try {
            let hasLegacyCache = false;
            if ("caches" in window) {
                const keys = await caches.keys();
                const legacyKeys = keys.filter(
                    (key) => key.startsWith("hungrybirds-cache-") && key !== CURRENT_CACHE
                );
                if (legacyKeys.length > 0) {
                    hasLegacyCache = true;
                    await Promise.all(legacyKeys.map((key) => caches.delete(key)));
                }
            }

            if (hasLegacyCache && navigator.serviceWorker.controller) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((reg) => reg.unregister()));
                if (!sessionStorage.getItem(MIGRATION_FLAG)) {
                    sessionStorage.setItem(MIGRATION_FLAG, "1");
                    window.location.reload();
                    return;
                }
            }

            const reg = await navigator.serviceWorker.register("./sw.js", {
                updateViaCache: "none"
            });
            reg.update().catch(() => {});
        } catch (err) {
            console.warn("Service Worker bootstrap warning:", err);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", recoverOrRegister, { once: true });
    } else {
        recoverOrRegister();
    }

    // Secondary safety net if an active stale controller blocked ES module boot
    window.addEventListener("load", () => {
        setTimeout(async () => {
            if (window.__HB_APP_BOOTED__ || !navigator.serviceWorker.controller) return;
            if (sessionStorage.getItem(MIGRATION_FLAG)) return;
            try {
                sessionStorage.setItem(MIGRATION_FLAG, "1");
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((reg) => reg.unregister()));
                if ("caches" in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map((key) => caches.delete(key)));
                }
                window.location.reload();
            } catch (err) {
                console.warn("Service Worker recovery failed:", err);
            }
        }, 2500);
    });
})();
