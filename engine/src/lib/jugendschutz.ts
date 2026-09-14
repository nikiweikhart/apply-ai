/**
 * Vorfilter im Code - läuft vor dem KI-Aufruf.
 *
 * GRUNDSATZ, teuer gelernt am 2026-08-25: dieser Filter fasst nur an, was
 * **eindeutig** ist. Eine Bewertung durch Haiku kostet etwa 0,1 Cent - der
 * Filter spart also kaum Geld. Sein einziger echter Zweck ist, rechtlich
 * Unmögliches und Nikis eigene No-Gos abzufangen, bevor sie überhaupt in der
 * Trefferliste auftauchen.
 *
 * Der erste Entwurf durchsuchte den ganzen Anzeigentext nach Stichworten wie
 * "40 Stunden" oder "Nachtdienst" und warf damit 21 von 28 Anzeigen weg -
 * darunter "Friseur:in für 20 Stunden" (weil irgendwo im Text "40 Stunden"
 * stand) und "Büromitarbeiter TEILZEIT STUDENTENJOB ab 15h" (wegen "38,5h"
 * an anderer Stelle). Ein Filter, der die richtigen Jobs wegwirft, ist
 * schlimmer als gar keiner.
 *
 * Deshalb jetzt drei enge Gruppen:
 *
 *   ALTER       Ausdrückliche Altersgrenzen im Text. Eindeutig formuliert,
 *               also im ganzen Text suchbar. Nur solange Niki unter 18 ist.
 *   TAETIGKEIT  Berufe, die unter 18 nicht gehen - aber nur im **Titel**
 *               gesucht. "Nachtdienst" irgendwo im Fließtext heißt gar nichts,
 *               "Nachtportier" in der Überschrift schon.
 *   UMFANG      Reine Vollzeitstellen, erkannt am Feld "Anstellungsart" des
 *               Portals - nicht am Fließtext.
 *
 * Alles Weiche - Nachtschichten als eine von mehreren Möglichkeiten,
 * Sonntagsarbeit, geforderte Berufserfahrung - entscheidet die KI. Die sieht
 * den Zusammenhang, ein Stichwort sieht ihn nicht.
 *
 * EHRLICHE EINSCHRÄNKUNG: keine Rechtsberatung, sondern eine Vorsortierung.
 * Das letzte Wort hat Niki.
 */

export type PruefErgebnis = {
  /** false = gar nicht erst bewerben. */
  ok: boolean;
  /** Warum nicht - in einem Satz. */
  grund?: string;
  /** Rechtlich unmöglich, oder von Niki ausgeschlossen? */
  art?: "rechtlich" | "umfang" | "ausgeschlossen";
  /** Welches Stichwort den Ausschlag gab, zum Nachvollziehen. */
  fundstelle?: string;
};

type Regel = { name: string; muster: RegExp; grund: string };

/**
 * Ausdrückliche Altersgrenzen. Im ganzen Text gesucht, weil die Formulierung
 * eindeutig ist. Achtung bei "ab 18": ohne das Wort "Jahre" wäre auch
 * "ab 18 Uhr" ein Treffer - deshalb steht es im Muster.
 *
 * ⚠ Kein `\b` am Anfang, obwohl es hier naheliegt. `\b` kennt nur die
 * Buchstaben A-Z: vor einem "ü" oder "Ü" sieht JavaScript **keine**
 * Wortgrenze. Das Muster `\b(...|über 18 jahr|...)` hat deshalb die Zeile
 * "Über 18 Jahre" glatt durchgelassen - aufgefallen am 2026-08-30 an einer
 * Anzeige, die dadurch 78 Punkte bekam, obwohl sie für Niki gar nicht in
 * Frage kommt. Stattdessen: eine ausdrückliche Grenze über `\p{L}`, die
 * alle Buchstaben kennt, mit dem dafür nötigen `u` am Ende.
 */
const ALTER: Regel[] = [
  {
    name: "mindestalter-18",
    muster:
      /(?<![\p{L}\p{N}])(ab\s*18\s*jahr|mindestalter[:\s]*(von\s*)?18|mind\.?\s*18\s*jahr|(ü|ue)ber\s*18\s*jahr|18\s*jahre?\s*(oder|und)\s*älter|volljährig)/iu,
    grund: "Die Anzeige verlangt ausdrücklich ein Mindestalter von 18 Jahren.",
  },
  {
    name: "mindestalter-hoeher",
    muster: /\b(ab\s*(19|20|21|25)\s*jahr|mindestalter[:\s]*(von\s*)?(19|20|21|25))/i,
    grund: "Die Anzeige verlangt ein Mindestalter über 18 Jahren.",
  },
  {
    name: "lkw-bus-schein",
    // Führerschein B hat Niki. C (LKW) und D (Bus) gibt es erst ab 18.
    muster:
      /\b(lkw[-\s]?(führerschein|schein)|führerschein\s*(der\s*)?klasse\s*[cd]\b|busführerschein|\bc\s*\+\s*e\b)/i,
    grund: "LKW- oder Busführerschein gibt es frühestens mit 18.",
  },
];

/**
 * Tätigkeiten, die unter 18 nicht erlaubt sind. NUR im Titel gesucht -
 * im Fließtext stehen solche Wörter zu oft nebenbei.
 */
const TAETIGKEIT: Regel[] = [
  {
    name: "bewachung",
    // "ordner" bewusst ohne Wortgrenze davor - sonst rutscht "Eventordner*in"
    // durch, und genau so heissen diese Anzeigen.
    muster: /(security|sicherheitsdienst|bewachung|wachdienst|ordner|türsteher|doorman)/i,
    grund: "Bewachungs- und Ordnerdienste setzen in Österreich Volljährigkeit voraus.",
  },
  {
    name: "lkw-fahrer",
    muster: /\b(lkw|sattelschlepper|schwertransport)/i,
    grund: "Ein LKW braucht den Führerschein C - den gibt es erst ab 18.",
  },
  {
    name: "gefaehrlich",
    muster: /\b(schweiß|schweiss|dachdecker|gerüst|kranführer|stapler|höhenarbeit)/i,
    grund: "Gefährliche Arbeiten (Schweißen, Höhe, Stapler, Kran) sind unter 18 nicht erlaubt.",
  },
  {
    name: "gefahrstoffe",
    muster: /\b(gefahrstoff|gefahrgut|chemikalien|asbest|sprengstoff|strahlenschutz)/i,
    grund: "Arbeiten mit Gefahrstoffen sind unter 18 verboten.",
  },
  {
    name: "nachtberuf",
    // Nur Berufe, die per Definition nachts stattfinden.
    muster: /\b(nachtportier|nachtdienst|nachtschicht|nachtwache)/i,
    grund: "Der Beruf findet nachts statt - unter 18 nicht erlaubt.",
  },
];

/** Ist Niki am Tag der Prüfung noch unter 18? */
export function istMinderjaehrig(geburtsdatum?: string | null, stichtag = new Date()): boolean {
  if (!geburtsdatum) return true; // im Zweifel die vorsichtigere Annahme
  const geboren = new Date(geburtsdatum);
  if (Number.isNaN(geboren.getTime())) return true;
  const achtzehn = new Date(geboren);
  achtzehn.setFullYear(achtzehn.getFullYear() + 18);
  return stichtag < achtzehn;
}

/**
 * Reine Vollzeitstelle? Beurteilt am Feld "Anstellungsart" des Portals, nicht
 * am Fließtext. Steht dort neben Vollzeit auch Teilzeit oder geringfügig, ist
 * die Stelle offen - dann entscheidet die KI.
 */
function nurVollzeit(anstellung?: string | null): boolean {
  if (!anstellung) return false;
  const a = anstellung.toLowerCase();
  if (!a.includes("vollzeit")) return false;
  return !/(teilzeit|geringf|studenten|ferial|aushilfe|wochenend)/i.test(a);
}

/**
 * Steht der Fund unter "Von Vorteil" statt unter "Erforderlich"?
 *
 * hokify sortiert die Anforderungen einer Anzeige unter zwei Überschriften:
 *
 *     Erforderlich für diesen Job
 *       Sehr gute Deutschkenntnisse
 *       Über 18 Jahre           <- Bedingung, Anzeige fällt raus
 *     Von Vorteil für diesen Job
 *       Über 18 Jahre           <- nur ein Wunsch, Anzeige bleibt drin
 *
 * Ohne diese Unterscheidung hätte der Filter am 2026-08-30 zehn Anzeigen
 * weggeworfen, von denen die Hälfte gar keine Altersgrenze verlangt - genau
 * der Fehler, der beim ersten Entwurf des Vorfilters schon einmal passiert
 * ist. Deshalb: rückwärts schauen, welche der beiden Überschriften zuletzt
 * kam.
 *
 * Der Abstand ist begrenzt, damit ein beiläufiges "von Vorteil" weit oben im
 * Text keine echte Bedingung weiter unten entschärft.
 */
function nurWunsch(text: string, stelle: number): boolean {
  const davor = text.slice(Math.max(0, stelle - 400), stelle).toLowerCase();
  const wunsch = davor.lastIndexOf("von vorteil");
  const pflicht = davor.lastIndexOf("erforderlich");
  return wunsch >= 0 && wunsch > pflicht;
}

/**
 * Prüft eine Anzeige.
 *
 * @param ausschlussWoerter  Nikis eigene No-Gos aus settings.exclusions.
 */
export function vorfilter(
  job: { title: string; company?: string | null; employment?: string | null; description?: string | null },
  optionen: { minderjaehrig: boolean; ausschlussWoerter?: string[]; ausschlussFirmen?: string[] } = {
    minderjaehrig: true,
  },
): PruefErgebnis {
  const titel = job.title ?? "";
  const ganzerText = [titel, job.employment ?? "", job.description ?? ""].join("\n");

  if (optionen.minderjaehrig) {
    for (const regel of ALTER) {
      const treffer = ganzerText.match(regel.muster);
      if (treffer && !nurWunsch(ganzerText, treffer.index ?? 0)) {
        return {
          ok: false,
          grund: regel.grund,
          art: "rechtlich",
          fundstelle: treffer[0].trim().slice(0, 80),
        };
      }
    }
    for (const regel of TAETIGKEIT) {
      const treffer = titel.match(regel.muster);
      if (treffer) {
        return {
          ok: false,
          grund: regel.grund,
          art: "rechtlich",
          fundstelle: treffer[0].trim().slice(0, 80),
        };
      }
    }
  }

  if (nurVollzeit(job.employment)) {
    return {
      ok: false,
      grund: "Das Portal führt die Stelle ausschließlich als Vollzeit - neben der Schule nichts.",
      art: "umfang",
      fundstelle: job.employment ?? undefined,
    };
  }

  // Nikis eigene No-Gos zuletzt, und nur im Titel.
  for (const wort of optionen.ausschlussWoerter ?? []) {
    if (!wort.trim()) continue;
    const muster = new RegExp(`\\b${wort.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    if (muster.test(titel)) {
      return {
        ok: false,
        grund: `Steht auf Nikis Ausschlussliste: ${wort}.`,
        art: "ausgeschlossen",
        fundstelle: wort,
      };
    }
  }

  // Ganze Firmen, die Niki nicht will (z.B. McDonald's) - anders als die
  // Taetigkeiten oben geht es hier um den Namen des Arbeitgebers, nicht den
  // Anzeigentitel. Einfacher Teilstring-Vergleich statt Regex-Wortgrenze,
  // weil Firmennamen oft Sonderzeichen enthalten ("McDonald's").
  const firma = (job.company ?? "").toLowerCase();
  for (const wort of optionen.ausschlussFirmen ?? []) {
    if (!wort.trim()) continue;
    if (firma.includes(wort.trim().toLowerCase())) {
      return {
        ok: false,
        grund: `Firma steht auf Nikis Ausschlussliste: ${wort}.`,
        art: "ausgeschlossen",
        fundstelle: job.company ?? wort,
      };
    }
  }

  return { ok: true };
}

/** Für den Trockenlauf: wie viele Regeln es gibt. */
export const REGEL_ANZAHL = ALTER.length + TAETIGKEIT.length;
