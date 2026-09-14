/**
 * Kleinigkeiten, die jeder Portal-Adapter braucht.
 *
 * Stehen hier, damit sie beim zweiten Portal nicht abgeschrieben werden -
 * und damit eine Verbesserung allen Adaptern zugutekommt.
 */
import type { Page } from "playwright";

const MAIL_MUSTER = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Mailadresse aus der Anzeige holen.
 *
 * Nicht ueber den sichtbaren Text: dort klebt die Adresse manchmal am Wort
 * davor ("Bewerbung anapply.job.123@..."), weil sie in einem eigenen Element
 * steht und der Zeilenumbruch dabei verlorengeht. Deshalb wird der Quelltext
 * genommen und jede Auszeichnung durch ein Leerzeichen ersetzt - dann steht
 * an jeder Elementgrenze eine saubere Luecke.
 */
export async function mailAusSeite(page: Page, bereich = "main"): Promise<string | undefined> {
  const mailto = await page
    .locator('a[href^="mailto:"]')
    .first()
    .getAttribute("href", { timeout: 1000 })
    .catch(() => null);
  if (mailto) return mailto.replace(/^mailto:/i, "").split("?")[0]?.trim();

  let html = await page.locator(bereich).first().innerHTML().catch(() => "");
  if (!html) html = await page.locator("body").innerHTML().catch(() => "");
  const flach = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  return flach.match(MAIL_MUSTER)?.[0];
}

/**
 * Schneidet die Kopfzeile der Seite ab (Menue, Suchfelder) und begrenzt die
 * Laenge, damit spaeter keine Menuepunkte mitbewertet werden.
 */
export function textAufraeumen(text: string, abWort?: string): string {
  let roh = text;
  if (abWort) {
    const start = text.indexOf(abWort);
    if (start >= 0) roh = text.slice(start + abWort.length);
  }
  return roh.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20_000);
}

/** Zeilen im Kopf der Anzeige - dort stehen Firma, Gehalt und Adresse. */
export function kopfbereich(text: string, zeilen = 25): string[] {
  return text
    .split("\n")
    .map((z) => z.trim())
    .filter(Boolean)
    .slice(0, zeilen);
}

/** Zeilen, in denen eine vierstellige Zahl kein Ort ist, sondern Geld. */
const GELD = /(eur|euro|€|brutto|netto|\/monat|pro stunde|std|gehalt|lohn)/i;

/**
 * Sucht die Adresse im Kopf der Anzeige, Muster "1190 Wien".
 *
 * Drei Fallen sind umgangen: der Titel (eine Anzeige "Assistenz September
 * 2026" ergab frueher den Ort "2026 ..."), Gehaltszeilen ("5000 EUR"), und
 * Postleitzahl und Ort in zwei getrennten Zeilen.
 */
export function ortAusText(text: string, titel?: string, firma?: string): string | undefined {
  const zeilen = kopfbereich(text);

  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i] ?? "";
    if (zeile === titel?.trim() || zeile === firma?.trim()) continue;
    if (GELD.test(zeile)) continue;

    const treffer = zeile.match(/\b([1-9]\d{3})\b\s*(.*)$/u);
    if (!treffer) continue;

    const plz = treffer[1] ?? "";
    const rest = (treffer[2] ?? "").trim() || (zeilen[i + 1] ?? "").trim();
    const ort = (rest.split(",")[0] ?? "").trim();

    if (!/^\p{Lu}/u.test(ort)) continue;
    return `${plz} ${ort}`.slice(0, 80);
  }
  return undefined;
}

/**
 * Macht aus "vor 3 Tagen" oder "online seit 2 Wochen" einen Zeitstempel.
 * Portale schreiben fast nie ein echtes Datum hin.
 */
export function relativeZeit(text: string, jetzt = new Date()): string | undefined {
  const m = text.match(/(\d+)\s*(minute|stunde|tag|woche|monat)/i);
  if (!m) {
    if (/heute|gerade eben|vor wenigen/i.test(text)) return jetzt.toISOString();
    if (/gestern/i.test(text)) return new Date(jetzt.getTime() - 864e5).toISOString();
    return undefined;
  }
  const zahl = Number(m[1]);
  const einheit = (m[2] ?? "").toLowerCase();
  const proEinheit: Record<string, number> = {
    minute: 60_000,
    stunde: 3_600_000,
    tag: 86_400_000,
    woche: 604_800_000,
    monat: 2_592_000_000,
  };
  const ms = proEinheit[einheit];
  if (!ms || !Number.isFinite(zahl)) return undefined;
  return new Date(jetzt.getTime() - zahl * ms).toISOString();
}

/**
 * Scrollt nach unten, bis genug Treffer geladen sind oder nichts mehr kommt.
 * Portale laden ihre Listen oft erst beim Scrollen nach.
 */
export async function nachladenDurchScrollen(
  page: Page,
  auswahl: string,
  ziel: number,
  runden = 8,
): Promise<number> {
  let vorher = await page.locator(auswahl).count();
  for (let i = 0; i < runden && vorher < ziel; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1200);
    const jetzt = await page.locator(auswahl).count();
    if (jetzt === vorher) break;
    vorher = jetzt;
  }
  return vorher;
}

/**
 * Liest ein beschriftetes Feld aus dem Seitentext.
 *
 * Manche Portale (karriere.at) kennzeichnen ihre Felder nicht im Quelltext,
 * schreiben die Beschriftung aber als eigene Zeile über den Wert:
 *
 *     Anstellungsart
 *
 *     Vollzeit (Festanstellung), Teilzeit (Festanstellung)
 *
 * Diese Funktion sucht die Beschriftung als eigenständige Zeile und gibt die
 * nächste nicht-leere Zeile zurück.
 */
export function feldAusText(text: string, beschriftung: string): string | undefined {
  const zeilen = text.split("\n").map((z) => z.trim());
  const gesucht = beschriftung.trim().toLowerCase();
  for (let i = 0; i < zeilen.length; i++) {
    if ((zeilen[i] ?? "").toLowerCase().replace(/:$/, "") !== gesucht) continue;
    const wert = zeilen.slice(i + 1).find((z) => z);
    // Zwei Beschriftungen hintereinander heisst: das Feld ist leer.
    if (wert && wert.length < 200) return wert;
  }
  return undefined;
}
