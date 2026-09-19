/**
 * write - schreibt das Anschreiben zu einer Anzeige.
 *
 * Ablauf, in dieser Reihenfolge:
 *
 *   1. Alle bewerteten Anzeigen ab der Rueckfrage-Schwelle (settings.approval_min)
 *      holen, beste zuerst.
 *   2. Firmensperre: pro Firma hoechstens eine Bewerbung innerhalb der
 *      Sperrfrist (lib/firma.ts). Ohne diese Klammer gingen sechs Briefe an
 *      sechs Standorte derselben Kette raus.
 *   3. Sonnet 5 schreibt Betreff und Anschreiben, bezogen auf genau diese Anzeige.
 *   4. Ab settings.auto_send_min (Vollautomatik, Nikis Entscheidung vom
 *      2026-07-24, Schwelle am 2026-08-30 auf 70 gesenkt): Status direkt
 *      `approved`, Telegram bekommt nur eine Information, keine Knoepfe.
 *      Darunter, ab settings.approval_min: Status `pending_approval` mit
 *      Freigeben/Ablehnen-Knoepfen - Niki entscheidet.
 *
 * **Der Writer selbst verschickt nichts** - er schreibt nur und setzt den
 * Status. Ob daraus wirklich eine Mail oder eine Portal-Bewerbung wird,
 * entscheiden `mail.ts` und `apply-browser.ts` (Phase 7/8), beide mit
 * eigenen Sicherheitsnetzen (DRY_RUN, MAIL_TEST_MODE).
 *
 * Bis 2026-09-07 schrieb hier Opus 5 (3-5 Cent pro Anschreiben). Ein Vergleich
 * zur selben Anzeige zeigte Sonnet 5 mindestens gleichwertig, deutlich billiger
 * (unter 1 Cent) und ohne Opus' Umlaut-Fehler (es schrieb durchgehend ae/oe/ue
 * statt ä/ö/ü) - Nikis Entscheidung: nur noch Sonnet. Trotzdem laeuft der
 * Writer standardmaessig nur ueber die drei besten offenen Anzeigen, nicht
 * ueber alles: jeder Aufruf ist ein KI-Aufruf, und die Qualitaet verdient
 * trotzdem einen Blick, bevor mehr geschrieben wird.
 *
 * Starten mit:
 *   npm run write              die 3 besten offenen Anzeigen
 *   npm run write 1            nur die beste (zum Anschauen)
 *   npm run write trocken      nur zeigen, wer drankaeme - kein KI-Aufruf, kostenlos
 *   npm run write nochmal      auch schon geschriebene Anschreiben neu schreiben
 *   npm run write ohnesperre   Firmensperre ausser Kraft (bewusst, selten)
 *
 * Ansehen danach:  npm run anschreiben
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { claude, kosten } from "../lib/claude.ts";
import { MODELS } from "../lib/env.ts";
import { sendeNachricht, telegramEingerichtet } from "../lib/telegram.ts";
import {
  gleicheFirma,
  firmenSchluessel,
  innerhalbSperrfrist,
  SPERRFRIST_TAGE,
} from "../lib/firma.ts";

// ------------------------------------------------------------- Aufrufparameter
const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const TROCKEN = argv.includes("trocken");
const NOCHMAL = argv.includes("nochmal");
const OHNE_SPERRE = argv.includes("ohnesperre");
const MAX = Number(argv.find((a) => /^\d+$/.test(a)) ?? 3);

// ------------------------------------------------------------- Einstellungen
const { data: einstellungen } = await db
  .from("settings")
  .select("profile_text, cover_template, auto_send_min, approval_min, availability")
  .eq("id", 1)
  .single();

const profil = (einstellungen?.profile_text as string | null) ?? "";
const vorlage = (einstellungen?.cover_template as string | null) ?? "";
const autoAb = (einstellungen?.auto_send_min as number | null) ?? 70;
const freigabeAb = (einstellungen?.approval_min as number | null) ?? 60;
const name = (einstellungen?.availability as { name?: string } | null)?.name ?? "";

if (!profil || !name) {
  console.error(
    "X  [write] Kein Profiltext oder Name hinterlegt.\n" +
      "        -> Erst 'npm run profil' laufen lassen, sonst weiss Claude nicht,\n" +
      "           in wessen Namen es schreiben soll.",
  );
  process.exit(1);
}

// ------------------------------------------------------------- Kandidaten
const { data: bewertungen, error: fehler } = await db
  .from("scores")
  .select(
    "score, reasoning, kjbg_reason, jobs(id, title, company, location, employment, description, url, contact_email)",
  )
  .eq("hard_filtered", false)
  .gte("score", freigabeAb)
  .order("score", { ascending: false });

if (fehler) {
  console.error(`X  [write] Bewertungen nicht ladbar: ${fehler.message}`);
  process.exit(1);
}

type Anzeige = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  employment: string | null;
  description: string | null;
  url: string;
  contact_email: string | null;
};

const kandidaten = (bewertungen ?? [])
  .map((b) => ({
    punkte: b.score as number,
    begruendung: b.reasoning as string,
    jugendschutz: b.kjbg_reason as string | null,
    job: b.jobs as unknown as Anzeige | null,
  }))
  .filter((k): k is typeof k & { job: Anzeige } => k.job !== null);

// ------------------------------------------------------------- Was es schon gibt
const { data: bestehende } = await db
  .from("applications")
  .select("job_id, status, created_at, jobs(company)");

const schonGeschrieben = new Set((bestehende ?? []).map((a) => a.job_id as string));

/**
 * Firmen, die durch eine bestehende Bewerbung gesperrt sind. Eine abgelehnte
 * Bewerbung (`rejected`) sperrt nicht - die wurde ja bewusst weggeworfen.
 *
 * jobId bleibt dran, damit `npm run write nochmal` eine Anzeige nicht durch
 * ihre EIGENE bisherige Bewerbung blockiert - sonst waere jedes Neuschreiben
 * sofort sein eigener Firmensperre-Treffer.
 */
const gesperrteFirmen = (bestehende ?? [])
  .filter((a) => a.status !== "rejected" && innerhalbSperrfrist(a.created_at as string))
  .map((a) => ({
    jobId: a.job_id as string,
    firma: (a.jobs as unknown as { company: string | null } | null)?.company ?? null,
  }));

console.log(
  `\nApply AI - Writer\n${"=".repeat(72)}\n` +
    `${kandidaten.length} Anzeigen ab ${freigabeAb} Punkten  |  ` +
    `${schonGeschrieben.size} haben schon ein Anschreiben  |  ` +
    `Firmensperre ${OHNE_SPERRE ? "AUS" : `${SPERRFRIST_TAGE} Tage`}\n` +
    (TROCKEN ? "TROCKENLAUF - kein KI-Aufruf, keine Kosten, nichts wird gespeichert\n" : "") +
    `Modell: ${MODELS.good}, unter 1 US-Cent pro Anschreiben\n`,
);

// ------------------------------------------------------------- Auswahl treffen
// Firmen, die in DIESEM Lauf schon drangekommen sind - sonst schreibt ein
// einziger Aufruf mit "npm run write 6" doch wieder sechsmal an dieselbe Kette.
const indiesemLauf: (string | null)[] = [];
const ausgewaehlt: typeof kandidaten = [];
let uebersprungenFirma = 0;

for (const k of kandidaten) {
  if (ausgewaehlt.length >= MAX) break;
  if (!NOCHMAL && schonGeschrieben.has(k.job.id)) continue;

  if (!OHNE_SPERRE) {
    const blocker = [
      ...gesperrteFirmen.filter((g) => g.jobId !== k.job.id).map((g) => g.firma),
      ...indiesemLauf,
    ].find((f) => gleicheFirma(f, k.job.company));
    if (blocker !== undefined) {
      uebersprungenFirma++;
      console.log(
        `    uebersprungen (${String(k.punkte).padStart(3)})  ${k.job.title.slice(0, 45)}\n` +
          `                       Firmensperre: "${firmenSchluessel(k.job.company)}" ist ` +
          `durch "${blocker ?? "?"}" schon vergeben.`,
      );
      continue;
    }
  }

  ausgewaehlt.push(k);
  indiesemLauf.push(k.job.company);
}

// Kein fruehes process.exit(0): Node stuerzt unter Windows gelegentlich ab,
// wenn der Prozess erzwungen beendet wird, waehrend eine offene
// Datenbankverbindung noch am Schliessen ist. Eine leere `ausgewaehlt`-Liste
// durchlaeuft die Schleife weiter unten ohnehin folgenlos.
if (ausgewaehlt.length === 0) {
  console.log(
    `\nNichts zu tun.` +
      (uebersprungenFirma > 0
        ? ` ${uebersprungenFirma} Anzeigen hat die Firmensperre gestoppt.`
        : "") +
      `\nMit 'npm run write nochmal' werden vorhandene Anschreiben neu geschrieben.\n`,
  );
}

// ------------------------------------------------------------- Schreibformat
const FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      betreff: {
        type: "string",
        description:
          "Betreffzeile der Bewerbungsmail. Nennt die Stelle so, wie die Anzeige sie nennt.",
      },
      anschreiben: {
        type: "string",
        description:
          "Das vollstaendige Anschreiben, von der Anrede bis zum Namen. Fliesstext mit " +
          "Absaetzen, keine Aufzaehlungszeichen, keine Platzhalter in eckigen Klammern.",
      },
      offene_punkte: {
        type: "string",
        description:
          "Was Niki vor dem Abschicken pruefen sollte - Dinge, die aus der Anzeige nicht " +
          "hervorgingen. Ein bis zwei Saetze, oder ein leerer Text, wenn alles klar war.",
      },
    },
    required: ["betreff", "anschreiben", "offene_punkte"],
    additionalProperties: false,
  },
};

type Brief = { betreff: string; anschreiben: string; offene_punkte: string };

/**
 * Fester Vorspann. Wie beim Bewerter als zwischenspeicherbar markiert - bei
 * drei Anschreiben pro Lauf greift der Zwischenspeicher kaum, er kostet aber
 * auch nichts.
 */
const ANWEISUNG = `
Du schreibst Bewerbungsanschreiben fuer einen Schueler in Wien, der einen
Wochenendjob sucht. Du schreibst in seinem Namen, in der Ich-Form, auf Deutsch.

Hier ist er:

${profil}

${
  vorlage
    ? `Er hat eine Vorlage, an die du dich haeltst - Aufbau und Ton daraus
uebernehmen, Inhalt aber auf die konkrete Anzeige beziehen:\n\n${vorlage}`
    : `Eine Vorlage gibt es noch nicht. Dein Anschreiben wird der erste Entwurf,
an dem sich die spaeteren orientieren - schreib es entsprechend sauber.`
}

So schreibst du:

  - 180 bis 250 Woerter. Kuerzer ist besser als laenger. Wer geringfuegig
    Beschaeftigte sucht, liest keine Seite.
  - Anrede: Steht in der Anzeige ein Name, sprich die Person an. Sonst
    "Sehr geehrte Damen und Herren,".
  - Erster Absatz: worauf er sich bewirbt und woher er die Stelle hat.
  - Mittelteil: zwei bis drei konkrete Bezuege zwischen SEINER Erfahrung und
    DIESER Anzeige. Nicht aufzaehlen, was im Lebenslauf steht - erklaeren,
    was davon fuer diese Stelle etwas bedeutet.
  - Ein Satz zur Verfuegbarkeit: Samstag oder Sonntag ganztags. Daran
    scheitern die meisten Bewerbungen, also sag ihn klar.
  - Schluss: Bitte um ein Gespraech. Kein Konjunktiv-Gewinde.
  - Unterschrift: nur "${name}" in der letzten Zeile.

Und so nicht:

  - Keine erfundenen Angaben. Seine Adresse steht oben und darf verwendet
    werden - aber nicht automatisch in jedem Brief: ein kurzes Anschreiben
    ueber ein Bewerbungsportal braucht meist keinen vollen Briefkopf. Nur
    wenn die Anzeige ausdruecklich eine postalische Bewerbung verlangt,
    gehoeren Name und Adresse oben in den Brief. Telefonnummer und Noten
    kennst du nicht - die kommen nicht vor, auch nicht als Platzhalter in
    eckigen Klammern. Der Lebenslauf haengt der Mail an.
  - Keine Behauptungen ueber Erfahrung, die oben nicht steht. Er hat noch nie
    an einer Kassa gestanden; wenn die Anzeige Kassenerfahrung will, schreib
    ehrlich, dass er sie sich schnell aneignet - erfinde sie nicht.
  - Keine Floskeln: dynamisches Team, spannende Herausforderung, mit grossem
    Interesse habe ich Ihre Anzeige gelesen.
  - Kein Superlativ-Selbstlob. Er ist 17 und bewirbt sich um einen
    Wochenendjob, nicht um eine Vorstandsposition.
  - Schreib mit echten deutschen Umlauten (ä, ö, ü, ß) - nicht mit ae, oe, ue,
    ss als Ersatz. Das wirkt in einer Bewerbung veraltet.

Sein Alter ist kein Makel, aber auch kein Geheimnis: er ist 17 und Schueler.
Wenn die Stelle ein Mindestalter von 18 nennt oder Sonntagsarbeit verlangt,
sprich das offen an - das erspart beiden Seiten den Termin.
`.trim();

// ------------------------------------------------------------- Durchlauf
let geschrieben = 0;
let kostenGesamt = 0;

for (const [i, k] of ausgewaehlt.entries()) {
  const job = k.job;
  const kopf =
    `${String(i + 1).padStart(2)}/${ausgewaehlt.length}  ` +
    `${String(k.punkte).padStart(3)}  ${job.title.slice(0, 50)}`;

  if (TROCKEN) {
    console.log(
      `${kopf}\n        ${job.company ?? "?"}  |  ${job.location ?? "?"}\n` +
        `        wuerde geschrieben`,
    );
    continue;
  }

  const anzeige = [
    `Titel: ${job.title}`,
    `Firma: ${job.company ?? "unbekannt"}`,
    `Ort: ${job.location ?? "unbekannt"}`,
    `Anstellungsart: ${job.employment ?? "nicht angegeben"}`,
    `Gefunden auf: ${job.url}`,
    "",
    "Anzeigentext:",
    job.description?.slice(0, 8000) ?? "(kein Text)",
    "",
    `Zur Einordnung - so wurde die Stelle fuer ihn bewertet ` +
      `(${k.punkte} von 100): ${k.begruendung}`,
    k.jugendschutz ? `Offener Punkt beim Jugendschutz: ${k.jugendschutz}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const antwort = await claude.messages.create({
      model: MODELS.good,
      max_tokens: 2048,
      system: [{ type: "text", text: ANWEISUNG, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: anzeige }],
      output_config: { format: FORMAT },
    });

    const roh = antwort.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const brief = JSON.parse(roh) as Brief;
    const offen = brief.offene_punkte?.trim() ?? "";

    const c = kosten(MODELS.good, antwort.usage.input_tokens, antwort.usage.output_tokens);
    kostenGesamt += c;
    geschrieben++;

    // Ab auto_send_min entscheidet Niki nicht mehr mit - das ist die
    // "Vollautomatik", die er schon am 2026-07-24 beschlossen und am
    // 2026-08-30 von 80 auf 70 gesenkt hat. Bis zum 2026-09-13 stand der Wert
    // zwar in der Datenbank, wurde hier aber nur als Log-Label benutzt -
    // jede Bewerbung wartete in Wahrheit trotzdem auf einen Telegram-Knopf.
    // Jetzt geht eine Anzeige ab dieser Schwelle direkt auf `approved`, ohne
    // Knoepfe - Telegram bekommt nur noch eine Information, keine Frage.
    // Darunter (ab approval_min) bleibt es wie bisher: Rueckfrage mit
    // Freigeben/Ablehnen.
    const vollautomatik = k.punkte >= autoAb;

    // Sofort per Telegram pushen, solange die Anzeige noch frisch im Kopf
    // ist. Bei einer Rueckfrage bleibt es "draft", wenn Telegram nicht
    // eingerichtet ist oder der Versand fehlschlaegt - `npm run freigabe`
    // holt das dann nach. Die Vollautomatik haengt davon nicht ab: ein
    // fehlgeschlagener Push ist dort nur eine verpasste Benachrichtigung,
    // kein Grund, die laengst getroffene Entscheidung zurueckzuhalten.
    let telegramOk = false;
    if (telegramEingerichtet()) {
      try {
        await sendeNachricht(
          (vollautomatik
            ? `Automatisch beworben (${k.punkte} Punkte, ab ${autoAb} keine Rueckfrage)\n`
            : `Neues Anschreiben (${k.punkte} Punkte)\n`) +
            `${job.title}\n${job.company ?? "?"}  |  ${job.location ?? "?"}\n\n` +
            `Betreff: ${brief.betreff}\n\n${brief.anschreiben}\n\n` +
            (offen ? `Vor dem Abschicken pruefen: ${offen}\n\n` : "") +
            job.url,
          vollautomatik
            ? undefined
            : [
                { text: "Freigeben", callback_data: `appr:${job.id}` },
                { text: "Ablehnen", callback_data: `rej:${job.id}` },
              ],
        );
        telegramOk = true;
      } catch (e) {
        console.log(`        Telegram-Push fehlgeschlagen: ${(e as Error).message.slice(0, 150)}`);
      }
    }

    const { error: speicherFehler } = await db.from("applications").upsert(
      {
        job_id: job.id,
        // Vollautomatik: sofort "approved", unabhaengig vom Telegram-Push.
        // Sonst wie bisher - "pending_approval" nur, wenn Niki die Nachricht
        // auch wirklich auf dem Handy hat, sonst "draft".
        status: vollautomatik ? "approved" : telegramOk ? "pending_approval" : "draft",
        channel: job.contact_email ? "mail" : "portal",
        subject: brief.betreff,
        cover_letter: brief.anschreiben,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id" },
    );

    if (speicherFehler) throw new Error(`Nicht gespeichert: ${speicherFehler.message}`);

    const woerter = brief.anschreiben.trim().split(/\s+/).length;
    console.log(
      `${kopf}\n` +
        `        ${job.company ?? "?"}  |  ${job.location ?? "?"}  |  ` +
        `${job.contact_email ? `Mail an ${job.contact_email}` : "keine Mailadresse -> Portal"}\n` +
        `        Betreff: ${brief.betreff}\n` +
        `        ${woerter} Woerter, ${(c * 100).toFixed(1)} Cent, ` +
        `${vollautomatik ? "Vollautomatik - approved" : "Rueckfrage"}\n` +
        (offen ? `        Vor dem Abschicken pruefen: ${offen}\n` : "") +
        `        Telegram: ${
          telegramOk
            ? vollautomatik
              ? "geschickt (nur Information)"
              : "geschickt, wartet auf Freigabe"
            : vollautomatik
              ? "NICHT geschickt (approved trotzdem gesetzt)"
              : "NICHT geschickt - npm run freigabe holt es nach"
        }\n`,
    );

    await log("write", "info", `Anschreiben fertig: ${job.title}`, {
      jobId: job.id,
      costUsd: c,
      inputTokens: antwort.usage.input_tokens,
      outputTokens: antwort.usage.output_tokens,
      data: { punkte: k.punkte, firma: job.company, offene_punkte: offen },
    });
  } catch (e) {
    console.log(`${kopf}\n        FEHLER  ${(e as Error).message.slice(0, 200)}`);
    await log("write", "error", `Anschreiben fehlgeschlagen: ${job.title}`, {
      jobId: job.id,
      data: { fehler: (e as Error).message },
    });
  }
}

// ------------------------------------------------------------- Ergebnis
// if/else statt process.exit(0): Node stuerzt unter Windows gelegentlich ab,
// wenn der Prozess erzwungen beendet wird, waehrend eine offene
// Datenbankverbindung noch am Schliessen ist.
if (TROCKEN) {
  console.log(
    `\n${"=".repeat(72)}\n` +
      `Trockenlauf: ${ausgewaehlt.length} Anschreiben waeren entstanden, ` +
      `${uebersprungenFirma} hat die Firmensperre gestoppt.\n` +
      `Nichts gespeichert, nichts bezahlt.\n`,
  );
} else {
  await log("write", "info", `${geschrieben} Anschreiben geschrieben`, {
    costUsd: kostenGesamt,
    data: { uebersprungenFirma, autoAb, freigabeAb },
  });

  console.log(
    `${"=".repeat(72)}\n` +
      `${geschrieben} Anschreiben geschrieben, ${uebersprungenFirma} von der Firmensperre gestoppt.\n` +
      `Kosten dieses Laufs: ${(kostenGesamt * 100).toFixed(1)} US-Cent.\n\n` +
      `Alle stehen als Entwurf da - verschickt wurde nichts.\n` +
      `Ansehen mit:  npm run anschreiben\n`,
  );
}
