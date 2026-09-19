import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./redesign.css";
import "./operations.css";
import "./admin-comfort.css";
import "./reservation-pricing.css";
import "./booking-wizard.css";
import "./location-autocomplete.css";
import "./tracking.css";
import "./tracking-live-map.css";
import "./tracking-recovery.css";
import "./pwa-gate.css";
import "./pwa-navigation.css";
import "./bloom.css";

declare const __ALLAN_BUILD_ID__: string;
const LEGACY_SERVICE_WORKER_RESET = "allan-sw-reset-2026-09-v6";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    let resetRequired = false;
    try {
      resetRequired = localStorage.getItem(LEGACY_SERVICE_WORKER_RESET) !== "complete";
      if (resetRequired) localStorage.setItem(LEGACY_SERVICE_WORKER_RESET, "complete");
    } catch {
      // Storage can be unavailable in private browsing; avoid a reload loop.
    }

    if (resetRequired) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
      if ("caches" in window) {
        await Promise.all((await caches.keys()).map(cacheName => caches.delete(cacheName)));
      }
      window.location.reload();
      return;
    }

    let reloadingForUpdate = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });

    const registration = await navigator.serviceWorker.register(
      `/sw.js?build=${encodeURIComponent(__ALLAN_BUILD_ID__)}`,
      { updateViaCache: "none" },
    ).catch(() => null);
    if (!registration) return;

    const checkForUpdate = () => registration.update().catch(() => undefined);
    window.addEventListener("online", checkForUpdate);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    });
    window.setInterval(checkForUpdate, 15 * 60 * 1000);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);