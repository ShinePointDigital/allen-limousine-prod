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
import "./tracking.css";
import "./tracking-recovery.css";
import "./pwa-gate.css";
import "./bloom.css";

const LEGACY_SERVICE_WORKER_RESET = "allen-sw-reset-2026-09-v4";

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

    await navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);