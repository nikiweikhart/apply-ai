/**
 * hokifyBewerben - fuellt hokifys Bewerbungsassistenten aus und schickt die
 * Bewerbung ab (seit 2026-09-30, siehe "Absenden" unten).
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
 * **Absenden (seit 2026-09-30, Nikis Entscheidung - ersetzt die vom
 * 2026-09-13):** Er will keine Telegram-Links mehr, bei denen er alles selbst
 * eingeben muss. Erkundet an hokify.at/apply/29098279 (Action Retail):
 *
 *   1. Assistent (Fragen, Lebenslauf-Upload, Einwilligungs-Seiten)
 *   2. "Bewerbungsvorschau 1/2" - "Deine Antworten", Knopf "Antworten bestaetigen"
 *   3. "Bewerbungsvorschau 2/2" - Profil/Lebenslauf, Knoepfe "Bewerbung
 *      speichern" und "Bewerbung versenden" (der echte Absenden-Knopf)
 *
 * Als abgeschickt gilt es nur, wenn nach dem Klick ein Erfolgstext NEU auf
 * der Seite steht (`adapters/bewerben.ts`), sonst `unsicher`. Was der Bot
 * geantwortet hat, geht danach per Telegram an Niki - so faellt ein falsch
 * angekreuztes Kaestchen wenigstens im Nachhinein auf.
 * `PORTAL_VORSCHAU_STOPP=1` haelt wie frueher an Vorschau 1/2 an.
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
import { ERFOLGS_MUSTER, absendenUndPruefen, type BewerbungsErgebnis } from "./bewerben.ts";

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

export type FrageAntwort = { frage: string; antwort: string };

/**
 * Geht hokifys Fragen-Assistenten durch, bis keine Frage mehr kommt (dann
 * steht die Vorschau da). Muss auf der Seite NACH dem Klick auf "Jetzt
 * bewerben" aufgerufen werden. Gibt zurueck, was beantwortet wurde - eine
 * leere Liste heisst: der Assistent war schon fertig (hokify speichert
 * Antworten serverseitig, beim erneuten Oeffnen steht man gleich in der
 * Vorschau).
 */
export async function hokifyAssistentAusfuellen(
  page: Page,
  lebenslaufPfad: string,
): Promise<{ fragenUndAntworten: FrageAntwort[]; kostenGesamt: number }> {
  const { data: einstellungen } = await db.from("settings").select("profile_text").eq("id", 1).single();
  const profil = (einstellungen?.profile_text as string | null) ?? "";

  const fragenUndAntworten: FrageAntwort[] = [];
  let kostenGesamt = 0;

  for (let schritt = 0; schritt < MAX_FRAGEN; schritt++) {
    await warte(1000, 1400);

    const dateiEingabe = page.locator('input[type="file"]');
    if ((await dateiEingabe.count()) > 0) {
      await dateiEingabe.first().setInputFiles(lebenslaufPfad);
      await warte(1000, 1500);
      if (!(await weiterKlicken(page))) break;
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
    const { optionen, hatEditor, checkboxAnzahl, privacyWerte, ganzerText } = await page.evaluate(() => {
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
        privacyWerte: Array.from(document.querySelectorAll('input[type="radio"][name="PRIVACY"]')).map(
          (el) => (el as HTMLInputElement).value,
        ),
        ganzerText: document.body.innerText,
      };
    });
    const editor = page.locator(".tiptap.ProseMirror");

    // Fragetext: alles, was auf der Seite steht, abzueglich der Kopfzeilen
    // (Navigation, Jobtitel, Firma) und der Knopfbeschriftungen - Nikis
    // Firmenname taucht als letzte Kopfzeile auf, alles danach ist die
    // eigentliche Frage samt Optionen/Zaehler.
    const fragenAbschnitt = ganzerText.split("\n\n").slice(-6).join("\n").slice(0, 500);

    // Reine Checkbox-Seiten gibt es bei hokify in zwei Sorten:
    //   - freiwillig (z.B. Werbe-Einwilligung fuer passende Jobangebote per
    //     Mail): datensparsamste Wahl wie bei einem Cookie-Banner - nichts
    //     ankreuzen, einfach weiter.
    //   - Pflicht: "Um fortzufahren bitte die Datenschutzvereinbarung lesen
    //     und akzeptieren." (gefunden am 2026-09-30 bei Action Retail). Ohne
    //     Haken keine Bewerbung - dasselbe wie der DSGVO-Haken bei
    //     karriere.at. Wird angehakt und landet sichtbar in der Telegram-
    //     Zusammenfassung.
    // Jede ANDERE Pflicht-Checkbox faengt `weiterKlicken` ab ("Antwort
    // notwendig") - dann Abbruch statt blind anzukreuzen.
    // Einwilligungs-Seite mit zwei Radio-Knoepfen `name="PRIVACY"` (gefunden
    // am 2026-09-30 bei Action Retail): "Akzeptieren" (value=accept) oder
    // "Ohne Zustimmung fortfahren" (value=decline) - z.B. ob die Firma die
    // Daten 12 Monate fuer spaetere Kontakte aufheben darf. Gibt es
    // "decline", ist die Einwilligung freiwillig -> datensparsam ablehnen.
    // Nur wenn es NUR "accept" gibt, ist sie Pflicht fuer die Bewerbung.
    if (privacyWerte.length > 0) {
      const wert = privacyWerte.includes("decline") ? "decline" : privacyWerte.includes("accept") ? "accept" : null;
      if (!wert) {
        throw new Error(`Unbekannte Einwilligungs-Seite (Werte: ${privacyWerte.join(", ")}) - bitte selbst ansehen.`);
      }
      await page.locator(`input[type="radio"][name="PRIVACY"][value="${wert}"]`).check({ force: true });
      const einwilligung =
        fragenAbschnitt
          .split("\n")
          .filter((z) => !/^um fortzufahren/i.test(z.trim()))
          .sort((a, b) => b.length - a.length)[0]
          ?.trim()
          .slice(0, 140) ?? "Einwilligung";
      fragenUndAntworten.push({
        frage: `Einwilligung: ${einwilligung}`,
        antwort: wert === "decline" ? "Ohne Zustimmung fortgefahren (freiwillig)" : "akzeptiert (Pflicht, keine Ablehnen-Option)",
      });
      await warte(400, 700);
      if (!(await weiterKlicken(page))) break;
      continue;
    }

    if (optionen.length === 0 && !hatEditor && checkboxAnzahl > 0) {
      const frage = fragenAbschnitt.split("\n").find((z) => z.trim().length > 10) ?? "Checkbox-Frage";
      if (checkboxAnzahl === 1 && DATENSCHUTZ_PFLICHT.test(ganzerText)) {
        await page.locator('input[type="checkbox"]').first().check({ force: true });
        fragenUndAntworten.push({ frage: "Datenschutzvereinbarung des Arbeitgebers", antwort: "akzeptiert (Pflicht fuer die Bewerbung)" });
      } else {
        fragenUndAntworten.push({ frage, antwort: "übersprungen (freiwillig, nichts angekreuzt)" });
      }
      await warte(400, 700);
      if (!(await weiterKlicken(page))) break;
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
    if (!(await weiterKlicken(page))) break;
  }

  return { fragenUndAntworten, kostenGesamt };
}

export async function hokifyBewerben(
  page: Page,
  bewerbung: { anschreiben: string; lebenslaufPfad: string },
): Promise<BewerbungsErgebnis> {
  const bewerbenKnopf = page.locator('[data-cy="applyButton"]').first();

  if (env.dryRun) {
    // Nur lesen: ist der Knopf da? Mehr nicht - hokify speichert Antworten
    // serverseitig, sobald man sie eintippt, schon ein Klick waere also ein
    // echter Seiteneffekt.
    if ((await bewerbenKnopf.count()) === 0) {
      throw new Error("Kein 'Jetzt bewerben'-Knopf auf der Anzeige (schon beworben oder Ablauf geaendert?).");
    }
    return {
      ergebnis: "trockenlauf",
      belegText: env.portalVorschauStopp
        ? "Trockenlauf: wuerde den Assistenten ausfuellen und an hokifys Vorschau anhalten."
        : "Trockenlauf: wuerde den Assistenten ausfuellen und ABSCHICKEN.",
      zusammenfassung: "",
    };
  }

  if ((await bewerbenKnopf.count()) === 0) {
    throw new Error("Kein 'Jetzt bewerben'-Knopf auf der Anzeige (schon beworben oder Ablauf geaendert?).");
  }
  await bewerbenKnopf.click();
  await warte(1500, 2000);

  // Leere Liste ist KEIN Fehler: hokify merkt sich Antworten serverseitig.
  // Wer den Assistenten schon einmal fertig hatte (z.B. alte needs_manual-
  // Bewerbungen aus der Zeit mit Vorschau-Stopp), landet sofort wieder in
  // der Vorschau.
  const { fragenUndAntworten, kostenGesamt } = await hokifyAssistentAusfuellen(page, bewerbung.lebenslaufPfad);

  // Vorschau 1/2: "Deine Antworten" + Knopf "Antworten bestaetigen".
  // Vorschau 2/2: Profil/Lebenslauf + "Bewerbung speichern" / "Bewerbung
  // versenden" (erkundet am 2026-09-30 an hokify.at/apply/29098279).
  const bestaetigen = page.getByRole("button", { name: "Antworten bestätigen" });
  const versenden = page.getByRole("button", { name: "Bewerbung versenden" });
  if (!(await bestaetigen.isVisible().catch(() => false)) && !(await versenden.isVisible().catch(() => false))) {
    const bild = await screenshot(page, "hokify-keine-vorschau");
    throw new Error(
      `Nach dem Assistenten steht keine hokify-Vorschau da (${fragenUndAntworten.length} Fragen beantwortet) - ` +
        `Ablauf vermutlich geaendert, bitte selbst ansehen.${bild ? ` (${bild})` : ""}`,
    );
  }

  const seitentext = await page.locator("body").innerText().catch(() => "");
  const vorschauAntworten = abschnitt(seitentext, "Deine Antworten", "Antworten bestätigen");
  const zusammenfassung = [
    fragenUndAntworten.length > 0
      ? `Diesmal beantwortet (${(kostenGesamt * 100).toFixed(2)} US-Cent):\n` +
        fragenUndAntworten.map((f) => `• ${f.frage}\n  → ${f.antwort}`).join("\n")
      : "Assistent war schon fertig (Antworten von einem frueheren Lauf).",
    vorschauAntworten ? `Laut hokify-Vorschau:\n${vorschauAntworten}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  await log("browser", "info", "hokify-Assistent ausgefuellt, Vorschau erreicht", {
    costUsd: kostenGesamt,
    data: { anzahlFragen: fragenUndAntworten.length },
  });

  if (env.portalVorschauStopp) {
    // Altes Verhalten (bis 2026-09-30): an hokifys eigener Vorschau stehen
    // bleiben, Niki schickt selbst ab.
    return {
      ergebnis: "vorschau",
      belegText: "hokify zeigt seine eigene Bewerbungsvorschau - bitte kurz pruefen und selbst abschicken.",
      zusammenfassung,
    };
  }

  if (await bestaetigen.isVisible().catch(() => false)) {
    await bestaetigen.click();
    await warte(1500, 2000);
  }
  if (!(await versenden.isVisible().catch(() => false))) {
    const bild = await screenshot(page, "hokify-kein-versenden-knopf");
    throw new Error(
      `Vorschau 2/2 ohne 'Bewerbung versenden'-Knopf - nichts abgeschickt, bitte selbst ansehen.${bild ? ` (${bild})` : ""}`,
    );
  }

  const { erfolg, captcha } = await absendenUndPruefen(page, () => versenden.click(), ERFOLGS_MUSTER);
  if (captcha) {
    throw new Error("Nach 'Bewerbung versenden' kam ein CAPTCHA - wird nicht umgangen, nichts abgeschickt. Bitte selbst abschicken.");
  }
  if (!erfolg) {
    return {
      ergebnis: "unsicher",
      belegText: "'Bewerbung versenden' geklickt, aber keine eindeutige Erfolgsmeldung von hokify.",
      zusammenfassung,
    };
  }
  return { ergebnis: "abgeschickt", belegText: `hokify meldet: "${erfolg}"`, zusammenfassung };
}

/** Text zwischen zwei Ueberschriften einer Seite, auf 1500 Zeichen gekuerzt. */
function abschnitt(text: string, von: string, bis: string): string {
  const a = text.indexOf(von);
  if (a < 0) return "";
  const b = text.indexOf(bis, a + von.length);
  return text
    .slice(a + von.length, b > a ? b : undefined)
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, 1500);
}

/** "Um fortzufahren bitte die Datenschutzvereinbarung lesen und akzeptieren." */
const DATENSCHUTZ_PFLICHT = /datenschutz\S*\s+(lesen\s+und\s+)?akzeptieren/i;

/**
 * Klickt im Assistenten auf "Weiter". Gibt `false` zurueck, wenn es keinen
 * solchen Knopf gibt (dann ist der Fragen-Teil vorbei). Meldet hokify danach
 * "Antwort notwendig", hat der Assistent eine Pflichtfrage, die hier nicht
 * erkannt wurde - Abbruch statt 15-mal im Kreis zu klicken.
 */
async function weiterKlicken(page: Page): Promise<boolean> {
  const weiter = page.locator('[data-cy="interview-button-next"]');
  if ((await weiter.count()) === 0) return false;
  await weiter.click();
  await warte(900, 1200);
  const text = await page.locator("body").innerText().catch(() => "");
  if (/antwort notwendig/i.test(text)) {
    const bild = await screenshot(page, "hokify-pflichtfrage-unbekannt");
    throw new Error(
      "hokify meldet 'Antwort notwendig' - eine Pflichtfrage, die der Adapter nicht beantworten kann " +
        `(bitte selbst ansehen).${bild ? ` (${bild})` : ""}\n${text.split("\n\n").slice(-5).join("\n").slice(0, 300)}`,
    );
  }
  return true;
}
