import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Download } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type InstallPromptWindow = Window & { __allanInstallPrompt?: InstallPromptEvent };
const deferredInstallPrompt = () => (window as InstallPromptWindow).__allanInstallPrompt || null;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const isMobileDevice = () =>
  /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function PWAInstallGate({ children }: { children: ReactNode }) {
  const [continueInBrowser, setContinueInBrowser] = useState(() => sessionStorage.getItem("allan-browser-booking") === "true");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(deferredInstallPrompt);
  const mobile = isMobileDevice();
  useEffect(() => {
    if (!mobile) return;
    const handler = (event: Event) => {
      event.preventDefault();
      const installEvent = event as InstallPromptEvent;
      (window as InstallPromptWindow).__allanInstallPrompt = installEvent;
      setPrompt(installEvent);
    };
    const promptReady = () => setPrompt(deferredInstallPrompt());
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("allan-install-prompt-ready", promptReady);
    promptReady();
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("allan-install-prompt-ready", promptReady);
    };
  }, [mobile]);
  if (isStandalone() || !mobile || continueInBrowser) return children;
  const install = async () => {
    const availablePrompt = prompt || deferredInstallPrompt();
    if (!availablePrompt) return;
    try {
      await availablePrompt.prompt();
      const choice = await availablePrompt.userChoice;
      if (choice.outcome === "accepted") setContinueInBrowser(true);
    } finally {
      delete (window as InstallPromptWindow).__allanInstallPrompt;
      setPrompt(null);
    }
  };
  const continueBooking = () => {
    sessionStorage.setItem("allan-browser-booking", "true");
    setContinueInBrowser(true);
    window.setTimeout(() => document.getElementById("reserve")?.scrollIntoView({ behavior: "smooth" }), 0);
  };
  return <main className="install-gate">
    <div className="install-gate-glow" />
    <section className="install-gate-card">
      <img className="install-gate-logo" src="/allan-limousine-logo.png" alt="Allan Limousine — Luxury Chauffeur Service" />
      <div className="install-incentive"><b>$15 OFF</b><span>YOUR FIRST RIDE</span></div>
      <p className="eyebrow brass">Private chauffeur service</p>
      <h1>Your chauffeur,<br /><em>one tap away.</em></h1>
      <p className="install-gate-copy">Save Allan Limousine to your Home Screen for 1-tap bookings and instant driver tracking.</p>
      <ul><li><Check />Faster repeat bookings</li><li><Check />Guaranteed upfront fares</li><li><Check />Direct ride updates</li></ul>
      {prompt && <button className="solid-button install-gate-action" onClick={install}><Download /> Claim $15 Off &amp; Install App <ArrowRight /></button>}
      {!prompt && <small className="install-hint">Native installation is unavailable in this browser.</small>}
      <button className="install-browser-fallback" onClick={continueBooking}>Continue to Browser Booking</button>
    </section>
  </main>;
}