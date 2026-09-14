/**
 * hokifyBewerben - fuellt hokifys Bewerbungsassistenten aus und uebergibt
 * dann an hokifys EIGENE Bewerbungsvorschau, statt selbst abzuschicken.
 *
 * Erkundet am 2026-09-13 (eingeloggt, an einer echten Anzeige): Nach "Jetzt
 * bewerben" kommt kein einzelnes Formular, sondern ein mehrschrittiger
 * "Interview"-Assistent - pro Anzeige unterschiedlich viele Fragen, als
 * Auswahl (Radio-Knoepfe), Freitext (ein Tiptap/ProseMirror-Editor, kein
 * normales <textarea>) oder freiwillige Checkbox (Werbe-Einwilligung). Bei
 * der McDonald's-Testanzeige zum Beispiel sieben Fragen. Genau das ist das
 * Risiko, vor dem die hokify-Seite selbst warnt: "Fragen ... koennen zu
 * einer automatischen Vorauswahl oder Absage fuehren."
 *
 * Nikis Entscheidung (2026-09-13): Claude (Haiku, guenstig) beantwortet die
 * Fragen anhand seines Profiltexts. Danach zeigt hokify von sich aus eine
 * mehrseitige Vorschau ("Alle Angaben korrekt? Pruefe deine Antworten &
 * persoenlichen Angaben, bevor du deine Bewerbung abschickst!") mit allen
 * Antworten zum Nachlesen und Aendern - diese Funktion klickt dort bewusst
 * NICHT weiter, sondern wirft einen Fehler mit der Zusammenfassung. Der
 * Aufrufer (apply-browser.ts) faengt das als `needs_manual` auf und schickt
 * Niki den Direktlink per Telegram - er prueft und schickt selbst ab.
 * Zwei Gruende, warum das besser ist als selbst einen Absenden-Knopf zu
 * suchen: der Ablauf hat mehrere unbekannte Vorschau-Seiten, UND ein echter
 * Testlauf zeigte, dass eine einzelne falsch geparste Modellantwort sonst
 * unbemerkt haette durchrutschen koennen (siehe Bugfix unten) - Nikis eigener
 * Blick auf die von hokify selbst gebaute Vorschau ist die zuverlaessigere
 * letzte Sicherung als ein zweiter, von uns selbst gebauter Bestaetigungsschritt.
 *
 * DRY_RUN (Standard: an) verlaesst diese Funktion, BEVOR ueberhaupt "Jetzt
 * bewerben" angeklickt wird - hokify speichert Antworten naemlich serverseitig
 * pro Anzeige, sobald man sie eintippt (beim erneuten Aufrufen der Anzeige
 * stand der Assistent wieder genau dort, wo man aufgehoert hatte). Das ist
 * also selbst ohne einen Absenden-Klick schon ein echter Seiteneffekt, kein
 * reiner Lesezugriff - im Trockenlauf wird deshalb ueberhaupt nichts
 * angeklickt.
 */
import type { Page } from "playwright";
import { claude, kosten } from "../lib/claude.ts";
import { MODELS, env } from "../lib/env.ts";
import { log } from "../lib/log.ts";
import { screenshot, warte } from "../lib/browser.ts";
import { db } from "../lib/supabase.ts";

const MAX_FRAGEN = 15;

const ANTWORT_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      gewaehlte_option: {
        type: "string",
        description:
          "Nur bei Auswahlfragen: EXAKT einer der gegebenen Optionstexte, Zeichen fuer Zeichen " +
          "uebernommen. Sonst leerer Text.",
      },
      freitext_antwort: {
        type: "string",
        description:
          "Nur bei Freitextfragen: kurze, ehrliche Antwort auf Deutsch, unter 180 Zeichen, " +
          "keine erfundenen Angaben. Sonst leerer Text.",
      },
    },
    required: ["gewaehlte_option", "freitext_antwort"],
    additionalProperties: false,
  },
};

const ANWEISUNG = (profil: string) =>
  `
Du beantwortest eine einzelne Frage aus einem Bewerbungsassistenten fuer
einen 17-jaehrigen Schueler in Wien, der einen Wochenendjob sucht. Antworte
in seinem Namen, ehrlich und auf Basis genau dieser Angaben - erfinde nichts,
was hier nicht steht:

${profil}

Ist es eine Auswahlfrage (Optionen werden mitgeliefert): gib in
"gewaehlte_option" GENAU einen der gegebenen Optionstexte zurueck, unveraendert.
Ist es eine Freitextfrage (keine Optionen): schreib eine kurze, ehrliche
Antwort in "freitext_antwort", unter 180 Zeichen.
Bist du unsicher, welche Option am ehesten stimmt: waehl die vorsichtigste,
die am wenigsten behauptet.
`.trim();

type FrageAntwort = { frage: string; antwort: string };

export async function hokifyBewerben(
  page: Page,
  bewerbung: { anschreiben: string; lebenslaufPfad: string },
): Promise<{ belegText: string }> {
  if (env.dryRun) {
    return {
      belegText:
        "Trockenlauf: wuerde 'Jetzt bewerben' anklicken und den Assistenten ausfuellen. " +
        "Nichts angeklickt (hokify speichert Antworten serverseitig, sobald man sie eintippt).",
    };
  }

  const { data: einstellungen } = await db.from("settings").select("profile_text").eq("id", 1).single();
  const profil = (einstellungen?.profile_text as string | null) ?? "";

  await page.locator('[data-cy="applyButton"]').first().click();
  await warte(1500, 2000);

  const fragenUndAntworten: FrageAntwort[] = [];
  let kostenGesamt = 0;

  for (let schritt = 0; schritt < MAX_FRAGEN; schritt++) {
    await warte(1000, 1400);

    const dateiEingabe = page.locator('input[type="file"]');
    if ((await dateiEingabe.count()) > 0) {
      await dateiEingabe.first().setInputFiles(bewerbung.lebenslaufPfad);
      await warte(1000, 1500);
      const weiter = page.locator('[data-cy="interview-button-next"]');
      if ((await weiter.count()) === 0) break;
      await weiter.click();
      continue;
    }

    // Alles in EINEM page.evaluate lesen, nicht in mehreren einzelnen
    // Playwright-Aufrufen: hokifys Seite ist eine SPA, die zwischen zwei
    // getrennten Aufrufen noch nachziehen kann - dann kaemen Radiooptionen
    // von der neuen Frage und der Fragetext noch von der alten (genau das
    // ist bei einem echten Testlauf passiert: Optionen zu einer
    // Arbeitserlaubnis-Frage, aber der herausgelesene Fragetext gehoerte zu
    // einer ganz anderen, laengst beantworteten Frage). Ein einziger
    // Rundgang liest beides garantiert aus demselben Seitenzustand.
    const { optionen, hatEditor, checkboxAnzahl, ganzerText } = await page.evaluate(() => {
      const optionen = Array.from(document.querySelectorAll('input[type="radio"][name="answer"]'))
        .map((el) => {
          const zeile = el.closest("label") ?? el.parentElement;
          return zeile?.textContent?.trim() ?? "";
        })
        .filter(Boolean);
      return {
        optionen,
        hatEditor: document.querySelectorAll(".tiptap.ProseMirror").length > 0,
        checkboxAnzahl: document.querySelectorAll('input[type="checkbox"]').length,
        ganzerText: document.body.innerText,
      };
    });
    const editor = page.locator(".tiptap.ProseMirror");

    // Fragetext: alles, was auf der Seite steht, abzueglich der Kopfzeilen
    // (Navigation, Jobtitel, Firma) und der Knopfbeschriftungen - Nikis
    // Firmenname taucht als letzte Kopfzeile auf, alles danach ist die
    // eigentliche Frage samt Optionen/Zaehler.
    const fragenAbschnitt = ganzerText.split("\n\n").slice(-6).join("\n").slice(0, 500);

    // Checkbox-Fragen ohne Radio/Freitext sind bei hokify bisher immer
    // ausdruecklich als "freiwillig" markiert (z.B. Werbe-Einwilligung fuer
    // passende Jobangebote per Mail) - datensparsamste Wahl wie bei einem
    // Cookie-Banner: nichts ankreuzen, einfach weiter.
    if (optionen.length === 0 && !hatEditor && checkboxAnzahl > 0) {
      fragenUndAntworten.push({
        frage: fragenAbschnitt.split("\n").find((z) => z.trim().length > 10) ?? "Freiwillige Frage",
        antwort: "übersprungen (freiwillig, nichts angekreuzt)",
      });
      const weiter = page.locator('[data-cy="interview-button-next"]');
      if ((await weiter.count()) === 0) break;
      await weiter.click();
      continue;
    }

    if (optionen.length === 0 && !hatEditor) {
      // Weder Auswahl noch Freitext noch Checkbox auf dieser Seite - der
      // Fragen-Teil ist vorbei (oder etwas Unbekanntes). In beiden Faellen
      // hier aufhoeren, statt zu raten.
      break;
    }

    const antwort = await claude.messages.create({
      model: MODELS.fast,
      max_tokens: 300,
      system: [{ type: "text", text: ANWEISUNG(profil), cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content:
            `Seitenausschnitt:\n${fragenAbschnitt}\n\n` +
            (optionen.length > 0
              ? `Gegebene Optionen:\n${optionen.map((o) => `- ${o}`).join("\n")}`
              : "Keine Optionen - das ist eine Freitextfrage."),
        },
      ],
      output_config: { format: ANTWORT_FORMAT },
    });

    const roh = antwort.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const geparst = JSON.parse(roh) as { gewaehlte_option: string; freitext_antwort: string };
    kostenGesamt += kosten(MODELS.fast, antwort.usage.input_tokens, antwort.usage.output_tokens);

    const frageZeile = fragenAbschnitt.split("\n").find((z) => z.trim().length > 10) ?? "Frage";

    if (optionen.length > 0) {
      // Per Text klicken scheitert oft an eigenwillig gestylten Radio-Knoepfen
      // (der echte <input> ist meist unsichtbar hinter einer eigenen
      // Optik versteckt - Playwright wartet dann ewig auf "sichtbar").
      // Deshalb ueber den Index in derselben Reihenfolge wie `optionen` klicken
      // und mit `force` die Sichtbarkeitspruefung uebergehen - das setzt den
      // nativen Radio-Zustand trotzdem korrekt.
      // Kein stiller Rateversuch: passt die Modellantwort zu keiner der
      // gegebenen Optionen, brechen wir ab statt blind die erste Option zu
      // waehlen (das waere bei Ja/Nein-Fragen systematisch "Ja"). Leichte
      // Abweichungen bei Leerzeichen/Gross-Kleinschreibung sind egal.
      const normal = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      const index = optionen.findIndex((o) => normal(o) === normal(geparst.gewaehlte_option));
      if (index === -1) {
        throw new Error(
          `Antwort "${geparst.gewaehlte_option}" passt zu keiner Option (${optionen.join(" / ")}) - ` +
            `Frage: ${frageZeile}`,
        );
      }
      const treffer = optionen[index]!;
      await page.locator('input[type="radio"][name="answer"]').nth(index).click({ force: true });
      fragenUndAntworten.push({ frage: frageZeile, antwort: treffer });
    } else {
      await editor.click();
      await page.keyboard.type(geparst.freitext_antwort.slice(0, 180));
      fragenUndAntworten.push({ frage: frageZeile, antwort: geparst.freitext_antwort });
    }

    await warte(500, 800);
    const weiter = page.locator('[data-cy="interview-button-next"]');
    if ((await weiter.count()) === 0) break;
    await weiter.click();
  }

  if (fragenUndAntworten.length === 0) {
    throw new Error("Kein einziges Formularfeld gefunden - der Ablauf hat sich vermutlich geaendert.");
  }

  // Ab hier zeigt hokify von SICH AUS eine Bewerbungsvorschau ("Alle Angaben
  // korrekt?") mit allen Antworten zum Nachlesen und Aendern - genau die
  // Bestaetigung vor dem Absenden, die Niki wollte. Diese Funktion klickt
  // deshalb absichtlich NICHT weiter: sie uebergibt an hokifys eigene
  // Vorschau statt selbst einen Absenden-Knopf zu suchen (der Ablauf hat
  // mindestens zwei Vorschau-Seiten, und ein automatischer Klick durch eine
  // Seite, die Niki nie gesehen hat, waere genau das Risiko, das er
  // ausdruecklich nicht wollte).
  const bild = await screenshot(page, "hokify-vorschau");
  const zusammenfassung = fragenUndAntworten.map((f) => `• ${f.frage}\n  → ${f.antwort}`).join("\n\n");

  await log("browser", "info", "hokify-Assistent ausgefuellt, hokify zeigt jetzt die eigene Vorschau", {
    costUsd: kostenGesamt,
    data: { anzahlFragen: fragenUndAntworten.length, screenshot: bild ?? null },
  });

  throw new Error(
    `${fragenUndAntworten.length} Fragen beantwortet (${(kostenGesamt * 100).toFixed(2)} US-Cent). ` +
      `hokify zeigt jetzt seine eigene Bewerbungsvorschau - bitte kurz pruefen und selbst abschicken:\n\n` +
      zusammenfassung,
  );
}
