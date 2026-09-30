/**
 * Gemeinsamer Vertrag der Bewerbungs-Adapter (hokify, karriere.at) und die
 * eine heikle Stelle, die beide teilen: der letzte Klick aufs Absenden und
 * die Frage, ob die Bewerbung danach WIRKLICH raus ist.
 *
 * Seit 2026-09-30 (Nikis Entscheidung) schicken die Adapter ab der
 * Punkteschwelle selbst ab, statt an der Portal-Vorschau stehen zu bleiben.
 * `PORTAL_VORSCHAU_STOPP=1` in der .env stellt das alte Verhalten wieder her.
 */
import type { Page } from "playwright";
import { warte } from "../lib/browser.ts";

/**
 * Was ein Adapter zurueckmeldet.
 *
 *   - `abgeschickt`: Absenden geklickt UND danach ist ein Erfolgstext neu
 *     aufgetaucht, der vorher nicht auf der Seite stand.
 *   - `vorschau`: bewusst vor dem Absenden angehalten (PORTAL_VORSCHAU_STOPP=1)
 *     - Niki schickt selbst ab.
 *   - `unsicher`: Absenden geklickt, aber kein eindeutiger Erfolgstext. Die
 *     Bewerbung KANN draussen sein. Darf nie als `sent` gelten und darf auch
 *     nie automatisch ein zweites Mal versucht werden (doppelte Bewerbung).
 *   - `trockenlauf`: DRY_RUN - nur nachgesehen, ob der Ablauf startbar waere.
 *
 * `zusammenfassung` ist, was der Bot im Formular angegeben hat - geht an
 * Niki per Telegram, damit ein falsch angekreuztes Kaestchen auffaellt.
 */
export type BewerbungsErgebnis = {
  ergebnis: "abgeschickt" | "vorschau" | "unsicher" | "trockenlauf";
  belegText: string;
  zusammenfassung: string;
};

export type BewerbungsAdapter = (
  page: Page,
  bewerbung: { anschreiben: string; lebenslaufPfad: string },
) => Promise<BewerbungsErgebnis>;

/**
 * Markierung im Feld `applications.error` fuer den Fall `unsicher`. Daran
 * erkennt `npm run apply nochmal`, dass es diese Bewerbung NICHT noch einmal
 * versuchen darf.
 */
export const UNSICHER_MARKE = "UNSICHER, ob abgeschickt - bitte pruefen";

/**
 * Ob ein Erfolgstext NACH dem Klick neu auf der Seite steht. Ein Muster, das
 * schon vorher passte (z.B. weil das eigene Anschreiben "Vielen Dank" sagt),
 * zaehlt ausdruecklich nicht - sonst wuerde die Vorschau-Seite selbst schon
 * als Erfolg durchgehen.
 */
export function erfolgNeuAufgetaucht(vorher: string, nachher: string, muster: RegExp[]): RegExp | null {
  const v = vorher.toLowerCase();
  const n = nachher.toLowerCase();
  return muster.find((m) => m.test(n) && !m.test(v)) ?? null;
}

/**
 * Texte, an denen ein Portal NACH dem Absenden erkennbar "ist raus" sagt.
 * Bewusst eng gefasst: jedes Muster enthaelt das Wort "Bewerbung" bzw.
 * "beworben" in einer abgeschlossenen Form ("versendet", nicht
 * "abschickst") - die Vorschau-Seite sagt z.B. "bevor du deine Bewerbung
 * abschickst" und darf nicht als Erfolg gelten. Und selbst wenn ein Muster
 * schon VOR dem Klick passt, zaehlt es nicht (`erfolgNeuAufgetaucht`).
 */
export const ERFOLGS_MUSTER: RegExp[] = [
  /bewerbung (wurde |ist )?(erfolgreich |bereits )?(versendet|verschickt|abgeschickt|übermittelt|gesendet|eingegangen|abgeschlossen)/,
  /(vielen )?danke? (dir )?für (deine|ihre) bewerbung/,
  /deine bewerbung ist (raus|unterwegs|angekommen|beim unternehmen)/,
  /(erfolgreich|bereits) beworben/,
  /du hast dich (erfolgreich |bereits )?beworben/,
];

/** Sichtbare reCAPTCHA-Aufgabe ("Bilder anklicken") - wird nie umgangen. */
async function captchaSichtbar(page: Page): Promise<boolean> {
  const rahmen = page.locator('iframe[src*="recaptcha"][src*="bframe"], iframe[title*="challenge" i], iframe[src*="hcaptcha"]');
  const anzahl = await rahmen.count().catch(() => 0);
  for (let i = 0; i < anzahl; i++) {
    const box = await rahmen.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 50 && box.height > 50) return true;
  }
  return false;
}

/**
 * Klickt den Absenden-Knopf und wartet bis zu `wartezeitMs` darauf, dass
 * ein Erfolgstext neu auftaucht. `erfolg` ist der gefundene Text oder
 * `null`, wenn es nicht eindeutig ist (dann: `unsicher`). `captcha` heisst:
 * das Portal will eine Bilderaufgabe - dann ist nichts abgeschickt.
 */
export async function absendenUndPruefen(
  page: Page,
  klicken: () => Promise<void>,
  erfolgsMuster: RegExp[] = ERFOLGS_MUSTER,
  wartezeitMs = 25_000,
): Promise<{ erfolg: string | null; captcha: boolean; seitentextNachher: string }> {
  const vorher = await page.locator("body").innerText().catch(() => "");
  await klicken();

  const ende = Date.now() + wartezeitMs;
  let nachher = "";
  while (Date.now() < ende) {
    await warte(1000, 1200);
    nachher = await page.locator("body").innerText().catch(() => "");
    const treffer = erfolgNeuAufgetaucht(vorher, nachher, erfolgsMuster);
    if (treffer) {
      const stelle = nachher.toLowerCase().search(treffer);
      return {
        erfolg: nachher.slice(stelle, stelle + 120).replace(/\s+/g, " ").trim(),
        captcha: false,
        seitentextNachher: nachher,
      };
    }
    if (await captchaSichtbar(page)) return { erfolg: null, captcha: true, seitentextNachher: nachher };
  }
  return { erfolg: null, captcha: false, seitentextNachher: nachher };
}
