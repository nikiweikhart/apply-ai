/**
 * karriereBewerben - fuellt karriere.ats eigenes "smart bewerben"-Formular
 * aus und schickt es ab (seit 2026-09-30, siehe unten).
 *
 * Erkundet am 2026-09-13 (eingeloggt, an einer echten Anzeige, mit Nikis
 * Zustimmung fuer genau diesen Testklick): Nicht jede Anzeige hat einen
 * eigenen karriere.at-Bewerbungsablauf - viele Knoepfe verweisen nach
 * aussen (dasselbe Muster wie bei willhaben). Nur wo karriere.at wirklich
 * "smart bewerben" anbietet (ein Link mit `data-is-smart-apply-link="true"`,
 * `target="_blank"`, Ziel `/bewerben/backend/apply/<id>`), gibt es ein
 * eigenes Formular unter `karriere.at/bewerben`:
 *
 *   - Lebenslauf: der hinterlegte karriere.at-Lebenslauf ist standardmaessig
 *     schon ausgewaehlt (`[data-qa="karriere at cv selected"]`) - eigener
 *     Upload ist nicht noetig.
 *   - Persoenliche Daten (Vorname/Nachname/E-Mail) sind aus Nikis Profil
 *     vorausgefuellt. Die Telefonnummer NICHT - karriere.at verlangt sie
 *     aber beim Klick auf "Vorschau ansehen" ("Bitte gib eine Telefonnummer
 *     an."). Das ist eine Luecke in Nikis karriere.at-Profil, keine, die der
 *     Adapter fuellen sollte (er erfindet keine Kontaktdaten) - wirft
 *     stattdessen einen klaren Fehler.
 *   - "Anmerkungen" ist ein ganz normales <textarea> (kein Tiptap wie bei
 *     hokify), max. 3000 Zeichen - hierhin kommt das Anschreiben.
 *   - Die DSGVO-Checkbox ist ein eigens gestyltes Kaestchen; das <input>
 *     selbst liegt unsichtbar hinter einem SVG-Icon, deshalb wird das
 *     <label> angeklickt statt der Checkbox direkt (sonst wartet Playwright
 *     ewig auf "sichtbar").
 *   - "Vorschau ansehen" prueft nur die Eingaben (kein Absenden) - "Bewerbung
 *     abschliessen" (`[data-qa="apply"]`) ist der einzige echte Sende-Knopf.
 *     Bis 2026-09-30 hoerte diese Funktion an der Vorschau auf. Seitdem
 *     (Nikis Entscheidung) klickt sie selbst auf "Bewerbung abschliessen"
 *     und gilt nur dann als abgeschickt, wenn danach ein Erfolgstext NEU auf
 *     der Seite steht (`adapters/bewerben.ts`). `PORTAL_VORSCHAU_STOPP=1`
 *     stellt das alte Anhalten an der Vorschau wieder her.
 *     Achtung: `data-qa` dieses Knopfes aendert sich mit seinem Zustand
 *     ("preview button disabled" solange ein Pflichtfeld fehlt, danach nur
 *     noch "preview button") - deshalb wird hier per sichtbarem Text
 *     gesucht, nicht per exaktem data-qa-Wert (im echten Testlauf gefunden:
 *     nach Nachtragen der Telefonnummer passte das alte Selektor-Muster
 *     nicht mehr und der Klick lief in einen Timeout).
 *
 * DRY_RUN (Standard: an) prueft nur, ob "smart bewerben" auf der Anzeige
 * steht, und verlaesst die Funktion, bevor es geoeffnet wird.
 */
import type { Page } from "playwright";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { screenshot, warte } from "../lib/browser.ts";
import { ERFOLGS_MUSTER, absendenUndPruefen, type BewerbungsErgebnis } from "./bewerben.ts";

const ANMERKUNG_MAX = 3000;

export async function karriereBewerben(
  page: Page,
  bewerbung: { anschreiben: string; lebenslaufPfad: string },
): Promise<BewerbungsErgebnis> {
  const smartBewerbenHref = await page.evaluate(() => {
    const el = document.querySelector('a[data-is-smart-apply-link="true"]');
    return el?.getAttribute("href") ?? null;
  });

  if (!smartBewerbenHref) {
    throw new Error(
      "Kein 'smart bewerben'-Knopf auf dieser Anzeige - karriere.at leitet hier vermutlich " +
        "nach aussen weiter (wie bei willhaben), oder es ist schon beworben. Bitte selbst auf der Anzeige nachsehen.",
    );
  }

  if (env.dryRun) {
    // Nur gelesen, ob "smart bewerben" da ist - nichts geoeffnet.
    return {
      ergebnis: "trockenlauf",
      belegText: env.portalVorschauStopp
        ? "Trockenlauf: wuerde das Formular ausfuellen und an der karriere.at-Vorschau anhalten."
        : "Trockenlauf: wuerde das Formular ausfuellen und ABSCHICKEN.",
      zusammenfassung: "",
    };
  }

  // Der Link oeffnet in einem neuen Tab (target="_blank") und ist selbst
  // 0x0 Pixel gross (ein sichtbarer, separat gestylter Knopf loest ihn nur
  // aus) - direktes Navigieren zur aufgeloesten Adresse ist deshalb
  // zuverlaessiger als ein Playwright-Klick auf ein unsichtbares Element.
  await page.goto(new URL(smartBewerbenHref, page.url()).toString(), { waitUntil: "domcontentloaded" });
  await warte(1500, 2000);

  const cvAusgewaehlt = await page.locator('[data-qa="karriere at cv selected"]').count();
  if (cvAusgewaehlt === 0) {
    await page.locator('[data-qa="use karriere at cv"]').click();
    await warte(600, 900);
  }

  const anschreiben = bewerbung.anschreiben.slice(0, ANMERKUNG_MAX);
  await page.locator('[data-qa="application letter empty state"]').click();
  await warte(600, 900);
  await page.locator('[data-qa="application letter"]').fill(anschreiben);

  const gdprGesetzt = await page.locator('[data-qa="general policy"]').isChecked();
  if (!gdprGesetzt) {
    await page.locator('[data-qa="general policy label"]').click();
  }

  await warte(500, 800);
  await page.getByRole("button", { name: "Vorschau ansehen" }).click();
  await warte(1500, 2000);

  const seitentext = await page.locator("body").innerText();
  if (seitentext.toLowerCase().includes("bitte gib eine telefonnummer an")) {
    const bild = await screenshot(page, "karriere-fehlt-telefonnummer");
    throw new Error(
      "karriere.at verlangt eine Telefonnummer, die in Nikis Profil dort noch fehlt. " +
        "Bitte einmalig unter karriere.at/profil ergaenzen - danach klappt der Ablauf wie bei " +
        `Vorname/Nachname/E-Mail automatisch.${bild ? ` (${bild})` : ""}`,
    );
  }

  const zusammenfassung =
    "• Lebenslauf: der auf karriere.at hinterlegte\n" +
    "• Datenschutz-Haken (Pflicht): gesetzt\n" +
    `• Anmerkung/Anschreiben:\n${anschreiben}`;

  await log("browser", "info", "karriere.at-Formular ausgefuellt, Vorschau erreicht", {});

  if (env.portalVorschauStopp) {
    return {
      ergebnis: "vorschau",
      belegText: "karriere.at zeigt seine eigene Vorschau - bitte kurz pruefen und selbst auf 'Bewerbung abschliessen' klicken.",
      zusammenfassung,
    };
  }

  const abschliessen = page.locator('[data-qa="apply"]');
  if (!(await abschliessen.isVisible().catch(() => false))) {
    const bild = await screenshot(page, "karriere-kein-abschliessen-knopf");
    throw new Error(
      `Vorschau ohne 'Bewerbung abschliessen'-Knopf - nichts abgeschickt, bitte selbst ansehen.${bild ? ` (${bild})` : ""}`,
    );
  }

  const { erfolg, captcha } = await absendenUndPruefen(page, () => abschliessen.click(), ERFOLGS_MUSTER);
  if (captcha) {
    throw new Error("Nach 'Bewerbung abschliessen' kam ein CAPTCHA - wird nicht umgangen, nichts abgeschickt. Bitte selbst abschicken.");
  }
  if (!erfolg) {
    return {
      ergebnis: "unsicher",
      belegText: "'Bewerbung abschliessen' geklickt, aber keine eindeutige Erfolgsmeldung von karriere.at.",
      zusammenfassung,
    };
  }
  return { ergebnis: "abgeschickt", belegText: `karriere.at meldet: "${erfolg}"`, zusammenfassung };
}
