/**
 * Ist eine Anzeige noch online? Gemeinsam fuer apply-browser.ts und mail.ts.
 *
 * Bis 2026-10-05 pruefte nur die Portal-Bewerbung, ob die Anzeige noch da
 * ist - der Mail-Versand haette auch auf eine laengst vergebene Stelle eine
 * Bewerbung geschickt. Zwischen Fund und Versand liegen leicht drei Wochen.
 */
import type { Page } from "playwright";

const MUSTER = [
  "nicht mehr verfügbar",
  "nicht mehr aktiv",
  "wurde bereits gelöscht",
  "seite nicht gefunden",
  "diese anzeige ist abgelaufen",
  "job wurde entfernt",
  "anzeige wurde deaktiviert",
  "stellenangebot ist nicht mehr",
  "nicht mehr online",
];

/** Schaut auf der schon geladenen Seite, ob das Portal "weg" meldet. */
export async function seiteZeigtAbgelaufen(page: Page): Promise<boolean> {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  return MUSTER.some((m) => text.includes(m));
}

/**
 * Laedt die Anzeige und entscheidet: noch da oder nicht. 404/410 zaehlen
 * als weg, ebenso eine Umleitung weg von der Anzeigen-Adresse auf eine
 * Startseite oder Suche (so verabschieden sich manche Portale stumm).
 * Ein Netzwerkfehler ist dagegen KEIN "weg" - dann wird geworfen, und der
 * Aufrufer laesst die Bewerbung fuer diesen Lauf liegen.
 */
export async function anzeigeNochAktiv(page: Page, url: string): Promise<{ aktiv: boolean; grund: string }> {
  const antwort = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = antwort?.status() ?? 0;
  if (status === 404 || status === 410) return { aktiv: false, grund: `Seite antwortet mit ${status}` };
  await page.waitForTimeout(1200);
  if (await seiteZeigtAbgelaufen(page)) return { aktiv: false, grund: "Portal meldet die Anzeige als nicht mehr verfuegbar" };

  if (page.url().includes("showAdvertExpiredHint=true")) return { aktiv: false, grund: "willhaben leitet auf die Suche um (Anzeige abgelaufen)" };
  const ziel = new URL(page.url());
  const start = new URL(url);
  const nummer = start.pathname.match(/\d{5,}/)?.[0];
  if (nummer && !page.url().includes(nummer)) {
    return { aktiv: false, grund: `Umgeleitet auf ${ziel.hostname}${ziel.pathname} - Anzeige ist weg` };
  }
  return { aktiv: true, grund: "" };
}
