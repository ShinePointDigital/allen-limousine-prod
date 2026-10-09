import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import LegalDocumentView from "./LegalDocumentView";
import { privacyDocument, termsDocument } from "./legal-content";

export const staticLegalDocuments = {
  "/privacy": privacyDocument,
  "/terms": termsDocument,
} as const;

export type StaticLegalPath = keyof typeof staticLegalDocuments;

export function staticLegalPath(pathname: string): StaticLegalPath | null {
  const normalized = pathname.replace(/\/$/, "").replace(/\.html$/, "");
  return Object.hasOwn(staticLegalDocuments, normalized) ? normalized as StaticLegalPath : null;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

/** Complete HTML: no scripts, API requests, database connection, or client rendering required. */
export function renderStaticLegalPage(pathname: StaticLegalPath, css: string): string {
  const document = staticLegalDocuments[pathname];
  const markup = renderToStaticMarkup(
    <StaticRouter location={pathname}>
      <LegalDocumentView document={document} />
    </StaticRouter>,
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.title)} | Allan Limousine</title>
  <meta name="description" content="${escapeHtml(document.introduction)}">
  <link rel="canonical" href="https://allanlimousine.com${pathname}">
  <link rel="icon" href="/allan-limousine-logo.png">
  <style>:root{--font-standard-ui:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0}${css}</style>
</head>
<body>${markup}</body>
</html>`;
}
