import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { LegalDocument } from "./legal-content";
import LegalDocumentView from "./LegalDocumentView";
import "./legal-page.css";

export default function LegalPage({ document }: { document: LegalDocument }) {
  const location = useLocation();

  useEffect(() => {
    const previousTitle = window.document.title;
    window.document.title = `${document.title} | Allan Limousine`;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    return () => {
      window.document.title = previousTitle;
    };
  }, [document]);

  useEffect(() => {
    if (!location.hash) return;
    let id: string;
    try { id = decodeURIComponent(location.hash.slice(1)); }
    catch { return; }
    const frame = window.requestAnimationFrame(() => {
      window.document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [document, location.hash, location.pathname]);

  return <LegalDocumentView document={document} />;
}
