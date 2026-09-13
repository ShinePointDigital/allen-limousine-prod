import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Check, Download, Home, Share, Smartphone, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type InstallPromptWindow = Window & { __allenInstallPrompt?: InstallPromptEvent };
const deferredInstallPrompt = () => (window as InstallPromptWindow).__allenInstallPrompt || null;

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const isAppleMobile = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobileDevice = () =>
  /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function PWAInstallGate({ children }: { children: ReactNode }) {
  const [continueInBrowser, setContinueInBrowser] = useState(() => sessionStorage.getItem("allan-browser-booking") === "true");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(deferredInstallPrompt);
  const [showIosGuide, setShowIosGuide] = useState(false);
  const ios = isAppleMobile();
  const mobile = isMobileDevice();
  useEffect(() => {
    if (!mobile) return;
    const handler = (event: Event) => {
      event.preventDefault();
      const installEvent = event as InstallPromptEvent;
      (window as InstallPromptWindow).__allenInstallPrompt = installEvent;
      setPrompt(installEvent);
    };
    const promptReady = () => setPrompt(deferredInstallPrompt());
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("allen-install-prompt-ready", promptReady);
    promptReady();
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("allen-install-prompt-ready", promptReady);
    };
  }, [mobile]);
  if (isStandalone() || !mobile || continueInBrowser) return children;
  const install = async () => {
    if (ios) { setShowIosGuide(true); return; }
    const availablePrompt = prompt || deferredInstallPrompt();
    if (!availablePrompt) return;
    try {
      await availablePrompt.prompt();
      const choice = await availablePrompt.userChoice;
      if (choice.outcome === "accepted") setContinueInBrowser(true);
    } finally {
      delete (window as InstallPromptWindow).__allenInstallPrompt;
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
      <img className="install-gate-logo" src="/allen-limousine-logo.png" alt="Allen Limousine — Luxury Chauffeur Service" />
      <div className="install-incentive"><b>$15 OFF</b><span>YOUR FIRST RIDE</span></div>
      <p className="eyebrow brass">Private chauffeur service</p>
      <h1>Your chauffeur,<br /><em>one tap away.</em></h1>
      <p className="install-gate-copy">Save Allen Limousine to your Home Screen for 1-tap bookings and instant driver tracking.</p>
      <ul><li><Check />Faster repeat bookings</li><li><Check />Guaranteed upfront fares</li><li><Check />Direct ride updates</li></ul>
      <button className="solid-button install-gate-action" onClick={install} disabled={!ios && !prompt}><Download /> {ios || prompt ? "Claim $15 Off & Install App" : "Preparing Install…"} <ArrowRight /></button>
      {!prompt && !ios && <small className="install-hint">Chrome is preparing the secure install prompt.</small>}
      <button className="install-browser-fallback" onClick={continueBooking}>Continue to Browser Booking</button>
    </section>
    {showIosGuide && <div className="pwa-guide-backdrop"><section className="pwa-guide"><button className="pwa-guide-close" onClick={() => setShowIosGuide(false)}><X /></button><p className="eyebrow brass">Install on iPhone</p><h2>Three taps to<br /><em>claim your offer.</em></h2><ol><li><i><Share /></i><span><b>1. Tap Share</b>Use the Share icon in Safari’s toolbar.</span></li><li><i><Home /></i><span><b>2. Add to Home Screen</b>Scroll down and choose “Add to Home Screen.”</span></li><li><i><Smartphone /></i><span><b>3. Launch the app</b>Open ALLAN from your new Home Screen icon.</span></li></ol><button className="solid-button" onClick={() => setShowIosGuide(false)}>Ready to install</button></section></div>}
  </main>;
}