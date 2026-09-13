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

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);