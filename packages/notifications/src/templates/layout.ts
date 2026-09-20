import { escapeHtml } from "../html.js";

export const IGNORE_HINT =
  "Wenn du diese Nachricht nicht erwartet hast, kannst du sie ignorieren.";

const SIGNATURE_TEXT = "DartBase · dartbase.ch";

/**
 * Datum und Uhrzeit fuer Mailtexte: TT.MM.JJJJ, HH:MM in Zuerich. Die
 * Zeitzone ist fest, weil Mails ohne Browser-Kontext gerendert werden.
 */
export function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

/** Textvariante: Absaetze, Link, Hinweis, Signatur. */
export function textLayout(paragraphs: readonly string[]): string {
  return [...paragraphs, IGNORE_HINT, SIGNATURE_TEXT].join("\n\n");
}

/**
 * HTML-Variante: eine schmale Spalte, Systemschrift, ein Button-Link.
 * Bewusst ohne Bilder, ohne externe Ressourcen, ohne Tracking. Alle
 * uebergebenen Absaetze muessen bereits escaped sein.
 */
export function htmlLayout(input: {
  readonly title: string;
  readonly paragraphsHtml: readonly string[];
  readonly action: { readonly label: string; readonly url: string };
}): string {
  const url = escapeHtml(input.action.url);
  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:16px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">${escapeHtml(input.title)}</h1>
    ${input.paragraphsHtml.map((paragraph) => `<p style="margin:0 0 16px;">${paragraph}</p>`).join("\n    ")}
    <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#34d399;color:#052e16;font-weight:600;text-decoration:none;">${escapeHtml(input.action.label)}</a></p>
    <p style="margin:0 0 16px;font-size:14px;color:#94a3b8;">Falls der Button nicht funktioniert, kopiere diesen Link in den Browser:<br><span style="word-break:break-all;">${url}</span></p>
    <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">${escapeHtml(IGNORE_HINT)}</p>
    <p style="margin:0;font-size:14px;color:#94a3b8;">${escapeHtml(SIGNATURE_TEXT)}</p>
  </div>
</body>
</html>`;
}
