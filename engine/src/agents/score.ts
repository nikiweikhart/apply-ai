/**
 * score - bewertet jede gefundene Anzeige von 0 bis 100.
 *
 * Zwei Stufen, in dieser Reihenfolge, und das ist Absicht:
 *
 *   1. Vorfilter im Code (lib/jugendschutz.ts). Was daran scheitert, bekommt
 *      0 Punkte und wird der KI nie gezeigt - kostet also nichts.
 *   2. Was durchkommt, geht an Haiku 4.5. Nikis Profil steht als fester
 *      Vorspann davor und wird zwischengespeichert, damit es nicht bei jeder
 *      einzelnen Anzeige neu bezahlt werden muss.
 *
 * Das Ergebnis kommt in einem festen Format zurück (output_config.format),
 * nicht als Fließtext - es muss also nichts aus einer Antwort herausgeklaubt
 * werden, was schiefgehen könnte.
 *
 * Starten mit:
 *   npm run score            alle noch unbewerteten Anzeigen
 *   npm run score 5          höchstens 5 (zum Ausprobieren)
 *   npm run score trocken    nur den Vorfilter zeigen, kein KI-Aufruf, kostenlos
 *   npm run score nochmal    auch schon Bewertetes neu bewerten (ueberschreibt)
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { claude, kosten } from "../lib/claude.ts";
import { MODELS } from "../lib/env.ts";
import { istMinderjaehrig, vorfilter } from "../lib/jugendschutz.ts";

// ------------------------------------------------------------- Aufrufparameter
const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const TROCKEN = argv.includes("trocken");
/**
 * Bewertet auch, was schon eine Bewertung hat, und ueberschreibt sie. Noetig,
 * wenn sich die Anweisung, das Profil oder die Anzeigendaten geaendert haben.
 */
const NOCHMAL = argv.includes("nochmal");
const MAX = Number(argv.find((a) => /^\d+$/.test(a)) ?? 999);

// ------------------------------------------------------------- Einstellungen
const { data: einstellungen } = await db
  .from("settings")
  .select("profile_text, availability, exclusions")
  .eq("id", 1)
  .single();

const profil = (einstellungen?.profile_text as string | null) ?? "";
if (!profil && !TROCKEN) {
  console.error(
    "X  [score] Kein Profiltext hinterlegt.\n" +
      "        -> Erst 'npm run profil' laufen lassen, sonst weiss Claude nicht,\n" +
      "           fuer wen es die Anzeigen bewerten soll.",
  );
  process.exit(1);
}

const verfuegbarkeit = (einstellungen?.availability ?? {}) as {
  geburtsdatum?: string | null;
};
const ausschluesse = (einstellungen?.exclusions ?? {}) as {
  taetigkeiten?: string[];
  firmen?: string[];
};
const minderjaehrig = istMinderjaehrig(verfuegbarkeit.geburtsdatum);

// ------------------------------------------------------------- Offene Anzeigen
// Nur, was noch keine Bewertung hat - jede Anzeige wird genau einmal bewertet.
const { data: bewertet } = await db.from("scores").select("job_id");
const schonBewertet = new Set((bewertet ?? []).map((b) => b.job_id as string));

const { data: alleJobs, error: jobFehler } = await db
  .from("jobs")
  .select("id, title, company, location, employment, description")
  .order("found_at", { ascending: false });

if (jobFehler) {
  console.error(`X  [score] Anzeigen nicht ladbar: ${jobFehler.message}`);
  process.exit(1);
}

const offen = (alleJobs ?? [])
  .filter((j) => NOCHMAL || !schonBewertet.has(j.id as string))
  .slice(0, MAX);

console.log(
  `\nApply AI - Bewerter\n${"=".repeat(60)}\n` +
    `${offen.length} ${NOCHMAL ? "Anzeigen (Neubewertung)" : "offene Anzeigen"}  |  Jugendschutz: ${
      minderjaehrig
        ? "unter 18, strenge Regeln"
        : "volljaehrig, Regeln entfallen"
    }\n` +
    `${TROCKEN ? "TROCKENLAUF - kein KI-Aufruf, keine Kosten, nichts wird gespeichert\n" : ""}`,
);

// Kein fruehes process.exit(0): Node stuerzt unter Windows gelegentlich ab,
// wenn der Prozess erzwungen beendet wird, waehrend eine offene
// Datenbankverbindung noch am Schliessen ist. Eine leere `offen`-Liste
// durchlaeuft die Schleife unten ohnehin folgenlos.
if (offen.length === 0) console.log("Nichts zu tun. Alle Anzeigen sind bewertet.\n");

// ------------------------------------------------------------- Bewertungsformat
const FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      // Achtung: minimum/maximum lehnt die API im Schema ab - die Grenzen
      // stehen deshalb in der Beschreibung und werden unten abgeklemmt.
      punkte: {
        type: "integer",
        description:
          "Wie gut passt die Stelle zu Niki? Ganze Zahl von 0 bis 100.",
      },
      begruendung: {
        type: "string",
        description:
          "Zwei bis drei Saetze auf Deutsch, direkt an Niki gerichtet.",
      },
      jugendschutz_ok: {
        type: "boolean",
        description: "Ist die Stelle mit dem Jugendschutz vereinbar?",
      },
      jugendschutz_hinweis: {
        type: "string",
        description:
          "Falls es beim Jugendschutz etwas zu klaeren gibt: was genau. " +
          "Sonst ein leerer Text.",
      },
      wochenende_moeglich: {
        type: "boolean",
        description:
          "Deutet die Anzeige darauf hin, dass Samstag oder Sonntag geht?",
      },
    },
    required: [
      "punkte",
      "begruendung",
      "jugendschutz_ok",
      "jugendschutz_hinweis",
      "wochenende_moeglich",
    ],
    additionalProperties: false,
  },
};

type Bewertung = {
  punkte: number;
  begruendung: string;
  jugendschutz_ok: boolean;
  jugendschutz_hinweis: string;
  wochenende_moeglich: boolean;
};

/**
 * Fester Vorspann - ändert sich zwischen den Anzeigen nicht.
 *
 * Er ist mit `cache_control` als zwischenspeicherbar markiert. Gemessen am
 * 2026-08-25 greift der Zwischenspeicher aber **nicht**: er springt erst ab
 * einer gewissen Mindestlänge an, und dieser Vorspann ist mit rund 1.500
 * Wörtern zu kurz dafür. Die Markierung bleibt trotzdem drin - sie kostet
 * nichts und greift automatisch, sobald das Profil länger wird.
 *
 * Viel gespart wäre ohnehin nicht: die Anzeige selbst ist etwa dreimal so
 * lang wie der Vorspann und muss jedes Mal neu gelesen werden.
 */
const ANWEISUNG = `
Du bewertest Stellenanzeigen fuer einen Schueler, der einen Wochenendjob sucht.
Du kennst ihn genau - hier ist sein Profil:

${profil}

${
  minderjaehrig
    ? `Er ist noch nicht 18. In Oesterreich gilt fuer ihn das Kinder- und
Jugendlichenbeschaeftigungsgesetz: hoechstens 8 Stunden am Tag, keine Nachtarbeit
zwischen 20:00 und 06:00 (Gastgewerbe bis 23:00), Sonn- und Feiertagsarbeit nur
eingeschraenkt, keine gefaehrlichen Arbeiten. Er sucht ausdruecklich auch
Sonntagsstellen - schreibe ihm bei solchen Anzeigen in die Begruendung, dass er
das mit dem Arbeitgeber klaeren muss, und zieh ein paar Punkte ab. Sortiere sie
aber nicht aus.`
    : `Er ist volljaehrig. Die Beschraenkungen fuer Jugendliche gelten fuer ihn nicht mehr.`
}

So vergibst du Punkte:

  85-100  Passt hervorragend. Wochenende ausdruecklich moeglich, Wien oder gut
          erreichbar, kein Vorwissen noetig, Bereich passt (Verkauf,
          Kundenkontakt, Gastronomie, Buero).
  70-84   Passt gut, ein Punkt ist offen - etwa der genaue Arbeitstag oder eine
          weitere Anfahrt.
  50-69   Denkbar, aber mit deutlichen Fragezeichen: unklarer Zeitrahmen,
          Anforderungen leicht ueber seinem Stand, Bereich nur so mittel.
  25-49   Eher nicht. Passt beim Zeitrahmen, beim Ort oder beim Inhalt schlecht.
  0-24    Aussichtslos oder unpassend.

Achte besonders auf diese Punkte, in dieser Reihenfolge:
  1. Geht die Stelle am Wochenende? Das ist die wichtigste Frage - alles andere
     nuetzt nichts, wenn sie unter der Woche stattfindet.
  2. Wie viele Stunden verlangt sie? Eine reine Vollzeitstelle (38 bis 40
     Wochenstunden) geht neben der Schule nicht: hoechstens 15 Punkte. Steht in
     der Anzeige beides - Vollzeit UND Teilzeit oder geringfuegig - dann zaehlt
     die kleine Variante, und die Stelle bleibt interessant.
  3. Ist sie ohne abgeschlossene Ausbildung und ohne mehrjaehrige
     Berufserfahrung machbar? Wird beides ausdruecklich verlangt: unter 25.
  4. Wie weit ist der Weg von Wien aus? Er hat ein Auto, also sind auch
     Randgemeinden moeglich - aber naeher ist besser.
  5. Passt der Bereich zu seinen Interessen?

Zu Schichten: Taucht "Nachtschicht" oder "Nachtdienst" nur als eine von
mehreren Moeglichkeiten auf, ist die Stelle nicht verloren - dann zieh ein paar
Punkte ab und schreib in den Jugendschutz-Hinweis, dass er die Tagschicht
vereinbaren muss. Ist die Stelle ihrem Wesen nach eine Nachtstelle, setz
jugendschutz_ok auf false und vergib hoechstens 10 Punkte.

Sei ehrlich, nicht hoeflich. Eine schlechte Stelle bekommt wenige Punkte, auch
wenn die Anzeige nett geschrieben ist. Schreib die Begruendung so, dass Niki in
zwei Saetzen versteht warum - keine Floskeln, kein "spannende Herausforderung".
`.trim();

// ------------------------------------------------------------- Durchlauf
let gefiltert = 0;
let bewertetAnzahl = 0;
let kostenGesamt = 0;
let zwischenspeicherTreffer = 0;
const verteilung = { hoch: 0, mittel: 0, niedrig: 0 };

for (const [i, job] of offen.entries()) {
  const kopf = `${String(i + 1).padStart(3)}/${offen.length}  ${(job.title as string).slice(0, 55)}`;

  // ---- Stufe 1: Vorfilter im Code
  const pruefung = vorfilter(
    {
      title: job.title as string,
      company: job.company as string | null,
      employment: job.employment as string | null,
      description: job.description as string | null,
    },
    { minderjaehrig, ausschlussWoerter: ausschluesse.taetigkeiten, ausschlussFirmen: ausschluesse.firmen },
  );

  if (!pruefung.ok) {
    gefiltert++;
    console.log(
      `${kopf}\n        AUSSORTIERT  ${pruefung.grund}  ("${pruefung.fundstelle}")`,
    );
    if (!TROCKEN) {
      await db.from("scores").upsert(
        {
          job_id: job.id,
          score: 0,
          reasoning: `${pruefung.grund} Gefunden in der Anzeige: "${pruefung.fundstelle}".`,
          kjbg_ok: pruefung.art !== "rechtlich",
          kjbg_reason:
            pruefung.art === "rechtlich" ? (pruefung.grund ?? null) : null,
          hard_filtered: true,
          model: null,
        },
        { onConflict: "job_id" },
      );
    }
    continue;
  }

  if (TROCKEN) {
    console.log(`${kopf}\n        durchgelassen -> ginge an die KI`);
    continue;
  }

  // ---- Stufe 2: Bewertung durch Claude
  const anzeige = [
    `Titel: ${job.title}`,
    `Firma: ${job.company ?? "unbekannt"}`,
    `Ort: ${job.location ?? "unbekannt"}`,
    `Anstellungsart: ${job.employment ?? "nicht angegeben"}`,
    "",
    "Anzeigentext:",
    (job.description as string | null)?.slice(0, 6000) ?? "(kein Text)",
  ].join("\n");

  try {
    const antwort = await claude.messages.create({
      model: MODELS.fast,
      max_tokens: 1024,
      // Der Vorspann ist bei jeder Anzeige derselbe -> zwischenspeichern.
      system: [
        { type: "text", text: ANWEISUNG, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: anzeige }],
      output_config: { format: FORMAT },
    });

    const roh = antwort.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const b = JSON.parse(roh) as Bewertung;
    // Die API laesst keine Zahlengrenzen im Schema zu - also hier abklemmen.
    const punkte = Math.max(0, Math.min(100, Math.round(b.punkte)));
    const hinweis = b.jugendschutz_hinweis?.trim()
      ? b.jugendschutz_hinweis.trim()
      : null;

    const c = kosten(
      MODELS.fast,
      antwort.usage.input_tokens,
      antwort.usage.output_tokens,
    );
    kostenGesamt += c;
    bewertetAnzahl++;
    if ((antwort.usage.cache_read_input_tokens ?? 0) > 0)
      zwischenspeicherTreffer++;
    if (punkte >= 70) verteilung.hoch++;
    else if (punkte >= 40) verteilung.mittel++;
    else verteilung.niedrig++;

    await db.from("scores").upsert(
      {
        job_id: job.id,
        score: punkte,
        reasoning: b.begruendung,
        kjbg_ok: b.jugendschutz_ok,
        kjbg_reason: hinweis,
        hard_filtered: false,
        model: MODELS.fast,
      },
      { onConflict: "job_id" },
    );

    const balken = "#".repeat(Math.round(b.punkte / 10)).padEnd(10, ".");
    console.log(
      `${kopf}\n        ${balken} ${String(b.punkte).padStart(3)}  ${b.begruendung}`,
    );
    if (b.jugendschutz_hinweis)
      console.log(`        Jugendschutz: ${b.jugendschutz_hinweis}`);
  } catch (e) {
    console.log(
      `${kopf}\n        FEHLER  ${(e as Error).message.slice(0, 200)}`,
    );
    await log("score", "error", `Bewertung fehlgeschlagen: ${job.title}`, {
      jobId: job.id as string,
      data: { fehler: (e as Error).message },
    });
  }
}

// ------------------------------------------------------------- Ergebnis
// if/else statt process.exit(0) im Trockenlauf-Zweig: Node stuerzt unter
// Windows gelegentlich ab, wenn der Prozess erzwungen beendet wird, waehrend
// eine offene Datenbankverbindung noch am Schliessen ist.
if (TROCKEN) {
  console.log(
    `\n${"=".repeat(60)}\n` +
      `Trockenlauf: ${gefiltert} von ${offen.length} haette der Vorfilter aussortiert,\n` +
      `${offen.length - gefiltert} waeren an die KI gegangen.\n` +
      `Nichts gespeichert, nichts bezahlt.\n`,
  );
} else {
  await log(
    "score",
    "info",
    `${bewertetAnzahl} Anzeigen bewertet, ${gefiltert} vorher aussortiert`,
    {
      costUsd: kostenGesamt,
      data: { verteilung },
    },
  );

  console.log(
    `\n${"=".repeat(60)}\n` +
      `${gefiltert} im Code aussortiert (kostenlos), ${bewertetAnzahl} von Claude bewertet.\n` +
      `Davon ${verteilung.hoch} ueber 70 Punkten, ${verteilung.mittel} im Mittelfeld, ` +
      `${verteilung.niedrig} unter 40.\n` +
      `Zwischenspeicher hat bei ${zwischenspeicherTreffer} von ${bewertetAnzahl} Aufrufen gegriffen.\n` +
      `Kosten dieses Laufs: ${(kostenGesamt * 100).toFixed(2)} US-Cent.\n\n` +
      `Die besten ansehen:  npm run treffer\n`,
  );
}
