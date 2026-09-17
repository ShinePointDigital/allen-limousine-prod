import { useEffect, useState } from "react";
import { Download, Home, Share, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const isAppleMobile = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function PWAInstallBanner() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [iosGuide, setIosGuide] = useState(false);
  const [visible, setVisible] = useState(false);
  const ios = isAppleMobile();
  useEffect(() => {
    if (standalone() || localStorage.getItem("allan-pwa-install-dismissed")) return;
    const handler = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    if (ios) setVisible(true);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, [ios]);
  const dismiss = () => { setVisible(false); setIosGuide(false); localStorage.setItem("allan-pwa-install-dismissed", "true"); };
  const install = async () => {
    if (ios) { setIosGuide(true); return; }
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setVisible(false);
    setPrompt(null);
  };
  if (!visible) return null;
  return <>
    <aside className="pwa-install-banner"><div className="pwa-install-mark">A</div><div><b>Keep ALLAN one tap away</b><span>Install the private booking app.</span></div><button onClick={install}><Download /> Install</button><button className="pwa-dismiss" onClick={dismiss} aria-label="Dismiss install prompt"><X /></button></aside>
    {iosGuide && <div className="pwa-guide-backdrop"><section className="pwa-guide"><button className="pwa-guide-close" onClick={() => setIosGuide(false)}><X /></button><p className="eyebrow brass">Install on iPhone</p><h2>Add ALLAN<br /><em>to your Home Screen.</em></h2><ol><li><i><Share /></i><span><b>1. Tap Share</b>Use the Share icon in Safari’s toolbar.</span></li><li><i><Home /></i><span><b>2. Add to Home Screen</b>Scroll down and choose the Home Screen option.</span></li><li><i><Download /></i><span><b>3. Tap Add</b>Confirm “Add” in the upper-right corner.</span></li></ol><button className="solid-button" onClick={dismiss}>Got it</button></section></div>}
  </>;
}
