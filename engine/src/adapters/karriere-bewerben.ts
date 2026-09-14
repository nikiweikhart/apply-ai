/**
 * karriereBewerben - fuellt karriere.ats eigenes "smart bewerben"-Formular
 * aus und uebergibt dann an Niki, genau wie bei hokify: diese Funktion
 * klickt NICHT auf den letzten Absenden-Knopf.
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
 *     Diese Funktion klickt bewusst nur bis "Vorschau ansehen" und hoert
 *     dann auf, aus demselben Grund wie bei hokify: Nikis eigener Blick auf
 *     karriere.ats eigene Vorschau ist die zuverlaessigere letzte Sicherung.
 *     Achtung: `data-qa` dieses Knopfes aendert sich mit seinem Zustand
 *     ("preview button disabled" solange ein Pflichtfeld fehlt, danach nur
 *     noch "preview button") - deshalb wird hier per sichtbarem Text
 *     gesucht, nicht per exaktem data-qa-Wert (im echten Testlauf gefunden:
 *     nach Nachtragen der Telefonnummer passte das alte Selektor-Muster
 *     nicht mehr und der Klick lief in einen Timeout).
 *
 * DRY_RUN (Standard: an) verlaesst diese Funktion, bevor ueberhaupt "smart
 * bewerben" geoeffnet wird.
 */
import type { Page } from "playwright";
import { env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { screenshot, warte } from "../lib/browser.ts";

const ANMERKUNG_MAX = 3000;

export async function karriereBewerben(
  page: Page,
  bewerbung: { anschreiben: string; lebenslaufPfad: string },
): Promise<{ belegText: string }> {
  if (env.dryRun) {
    return {
      belegText:
        "Trockenlauf: wuerde 'smart bewerben' oeffnen und das Formular ausfuellen. " +
        "Nichts angeklickt.",
    };
  }

  const smartBewerbenHref = await page.evaluate(() => {
    const el = document.querySelector('a[data-is-smart-apply-link="true"]');
    return el?.getAttribute("href") ?? null;
  });

  if (!smartBewerbenHref) {
    throw new Error(
      "Kein 'smart bewerben'-Knopf auf dieser Anzeige - karriere.at leitet hier vermutlich " +
        "nach aussen weiter (wie bei willhaben). Bitte selbst auf der Anzeige nachsehen.",
    );
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

  await page.locator('[data-qa="application letter empty state"]').click();
  await warte(600, 900);
  await page.locator('[data-qa="application letter"]').fill(bewerbung.anschreiben.slice(0, ANMERKUNG_MAX));

  const gdprGesetzt = await page.locator('[data-qa="general policy"]').isChecked();
  if (!gdprGesetzt) {
    await page.locator('[data-qa="general policy label"]').click();
  }

  await warte(500, 800);
  await page.getByRole("button", { name: "Vorschau ansehen" }).click();
  await warte(1500, 2000);

  const seitentext = (await page.locator("body").innerText()).toLowerCase();
  if (seitentext.includes("bitte gib eine telefonnummer an")) {
    const bild = await screenshot(page, "karriere-fehlt-telefonnummer");
    throw new Error(
      "karriere.at verlangt eine Telefonnummer, die in Nikis Profil dort noch fehlt. " +
        "Bitte einmalig unter karriere.at/profil ergaenzen - danach klappt der Ablauf wie bei " +
        `Vorname/Nachname/E-Mail automatisch.${bild ? ` (${bild})` : ""}`,
    );
  }

  // Ab hier zeigt karriere.at die eigene Vorschau - dieselbe Grenze wie bei
  // hokify: kein automatischer Klick auf "Bewerbung abschliessen".
  const bild = await screenshot(page, "karriere-vorschau");
  await log("browser", "info", "karriere.at-Formular ausgefuellt, karriere.at zeigt jetzt die eigene Vorschau", {
    data: { screenshot: bild ?? null },
  });

  throw new Error(
    "Formular ausgefuellt (Lebenslauf, Anschreiben, DSGVO-Haken). karriere.at zeigt jetzt seine " +
      "eigene Vorschau - bitte kurz pruefen und selbst auf 'Bewerbung abschliessen' klicken.",
  );
}
