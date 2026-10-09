import { Link } from "react-router-dom";
import { LEGAL_BUSINESS, LEGAL_PHONE, LEGAL_PHONE_HREF, LEGAL_UPDATED, type LegalDocument } from "./legal-content";

/** Shared markup for the browser route and the JavaScript-free public document. */
export default function LegalDocumentView({ document }: { document: LegalDocument }) {
  const updated = document.updated || LEGAL_UPDATED;
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link className="legal-brand" to="/" aria-label="Allan Limousine home">
          <img src="/allan-limousine-logo.png" alt="Allan Limousine" />
        </Link>
        <nav className="legal-nav" aria-label="Main navigation">
          <Link to="/">Home</Link>
          <Link to="/privacy" aria-current={document.title === "Privacy Policy" ? "page" : undefined}>Privacy</Link>
          <Link to="/terms" aria-current={document.title === "Terms and Conditions" ? "page" : undefined}>Terms</Link>
          <Link className="legal-reserve" to="/#reserve">Reserve a ride</Link>
        </nav>
      </header>

      <section className="legal-masthead" aria-labelledby="legal-title">
        <div className="legal-masthead-inner">
          <p className="legal-eyebrow"><span /> Allan Limousine / Legal</p>
          <h1 id="legal-title">{document.title}</h1>
          <p className="legal-introduction">{document.introduction}</p>
          <p className="legal-updated">Last updated <time dateTime={updated.dateTime}>{updated.label}</time></p>
        </div>
        <div className="legal-masthead-index" aria-hidden="true">AL <i>/</i> CHI</div>
      </section>

      <main className="legal-main">
        <aside className="legal-aside">
          <p className="legal-aside-title">In this document</p>
          <nav aria-label="Document sections">
            <ol>
              {document.sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="legal-aside-contact">
            <span>Questions?</span>
            <a href={LEGAL_PHONE_HREF}>{LEGAL_PHONE}</a>
          </div>
        </aside>

        <article className="legal-article">
          <div className="legal-notice" role="note">
            <span className="legal-notice-mark" aria-hidden="true">i</span>
            <p>This document provides general information and is not legal advice. Consult a qualified attorney for advice about your circumstances.</p>
          </div>
          {document.sections.map((section, index) => (
            <section
              className={`legal-section${section.highlight ? " is-highlighted" : ""}`}
              id={section.id}
              key={section.id}
              aria-labelledby={`${section.id}-heading`}
            >
              <div className="legal-section-number">{String(index + 1).padStart(2, "0")}</div>
              <div className="legal-section-copy">
                <h2 id={`${section.id}-heading`}>{section.title}</h2>
                <div className="legal-prose">{section.content}</div>
              </div>
            </section>
          ))}
          <div className="legal-document-end">
            <span>End of document</span>
            <span aria-hidden="true" />
            <span>{document.title}</span>
          </div>
        </article>
      </main>

      <footer className="legal-footer">
        <div className="legal-footer-top">
          <div>
            <p className="legal-eyebrow">Allan Limousine</p>
            <h2>Clear answers.<br /><em>Considered service.</em></h2>
          </div>
          <div className="legal-footer-contact">
            <span>Speak with our team</span>
            <a href={LEGAL_PHONE_HREF}>{LEGAL_PHONE}</a>
            <small>{LEGAL_BUSINESS}</small>
          </div>
          <Link className="legal-footer-cta" to="/#reserve">Arrange your ride <span aria-hidden="true">↗</span></Link>
        </div>
        <div className="legal-footer-bottom">
          <Link to="/" className="legal-footer-home">Allan Limousine <span>Chicago, Illinois</span></Link>
          <div className="legal-footer-links">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
          <span className="legal-copyright">© Allan Limousine</span>
        </div>
      </footer>
    </div>
  );
}
