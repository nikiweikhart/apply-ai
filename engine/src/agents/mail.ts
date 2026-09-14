/**
 * mail - verschickt freigegebene Bewerbungen per Mail.
 *
 * Nimmt alle Bewerbungen mit Status `approved` und Weg `mail` (also: hat eine
 * Mailadresse gefunden, keine Portal-Bewerbung), haengt den Lebenslauf an und
 * schickt sie ab. Zwei Sicherheitsnetze, in dieser Reihenfolge:
 *
 *   1. `DRY_RUN` (Standard: an). Solange das steht, wird NICHTS verschickt -
 *      dieses Skript zeigt nur, was passieren wuerde. Erst `DRY_RUN=0` in der
 *      .env schaltet den echten Versand frei.
 *   2. `MAIL_TEST_MODE` (Standard: an, auch bei DRY_RUN=0). Die Testwoche aus
 *      dem Bauplan: solange das steht, geht jede Mail an Nikis EIGENE Adresse
 *      statt an die Firma - der Betreff bekommt einen Hinweis, an wen es in
 *      echt gegangen waere. Erst wenn eine Woche lang alles richtig ankommt,
 *      `MAIL_TEST_MODE=0` setzen.
 *
 * Beide Schalter muessen also bewusst umgelegt werden, bevor eine einzige
 * Mail wirklich bei einer Firma ankommt.
 *
 * Starten mit:
 *   npm run mail             alle freigegebenen, noch nicht verschickten
 *   npm run mail 1           nur eine (zum Ausprobieren)
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { env } from "../lib/env.ts";
import { verschicke } from "../lib/mailer.ts";

if (!env.mailAddress || !env.mailPassword) {
  console.error(
    "X  [mail] MAIL_ADDRESS oder MAIL_APP_PASSWORD fehlt in der .env.\n" +
      "        -> Ohne die beiden kann Apply AI keine Mail verschicken.\n" +
      "        -> App-Passwort holen: myaccount.google.com -> Sicherheit -> App-Passwoerter.",
  );
  process.exit(1);
}

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const MAX = Number(argv.find((a) => /^\d+$/.test(a)) ?? 999);

const { data: bereite, error: ladeFehler } = await db
  .from("applications")
  .select("job_id, subject, cover_letter, jobs(title, company, contact_email)")
  .eq("status", "approved")
  .eq("channel", "mail")
  .limit(MAX);

if (ladeFehler) {
  console.error(`X  [mail] Bewerbungen nicht ladbar: ${ladeFehler.message}`);
  process.exit(1);
}

console.log(
  `\nApply AI - Mail\n${"=".repeat(60)}\n` +
    `${bereite?.length ?? 0} freigegebene Bewerbung(en) per Mail\n` +
    `DRY_RUN: ${env.dryRun ? "AN - es wird nichts verschickt" : "AUS - es wird wirklich verschickt"}\n` +
    `Testwoche: ${env.mailTestMode ? `AN - alles geht an ${env.mailAddress}` : "AUS - geht an die echte Firmenadresse"}\n`,
);

let verschickt = 0;
let fehlgeschlagen = 0;

// `if/else` statt eines fruehen process.exit(0): Node stuerzt unter Windows
// gelegentlich ab ("Assertion failed ... UV_HANDLE_CLOSING"), wenn der
// Prozess erzwungen beendet wird, waehrend eine offene Datenbankverbindung
// noch am Schliessen ist. Den leeren Fall stattdessen einfach ueberspringen
// laesst Node sich selbst und seine Verbindungen sauber aufraeumen.
if (!bereite || bereite.length === 0) {
  console.log("Nichts zu verschicken.\n");
} else {
  for (const a of bereite) {
    const job = a.jobs as unknown as {
      title: string;
      company: string | null;
      contact_email: string | null;
    } | null;

    if (!job?.contact_email) {
      console.log(`    UEBERSPRUNGEN (keine Mailadresse): ${job?.title ?? a.job_id}`);
      continue;
    }

    const empfaenger = env.mailTestMode ? env.mailAddress! : job.contact_email;
    const betreff = env.mailTestMode
      ? `[TEST - ginge an ${job.contact_email}] ${a.subject}`
      : a.subject ?? "Bewerbung";

    console.log(`    ${job.title} (${job.company ?? "?"})\n        an: ${empfaenger}`);

    if (env.dryRun) {
      console.log(`        DRY_RUN - nicht wirklich verschickt.\n`);
      continue;
    }

    try {
      const messageId = await verschicke({
        an: empfaenger,
        betreff,
        text: a.cover_letter ?? "(kein Text)",
      });

      await db
        .from("applications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("job_id", a.job_id);

      verschickt++;
      console.log(`        verschickt (${messageId})\n`);

      await log("mail", "info", `Bewerbung verschickt: ${job.title}`, {
        jobId: a.job_id as string,
        data: { firma: job.company, testModus: env.mailTestMode, empfaenger },
      });
    } catch (e) {
      fehlgeschlagen++;
      const fehlertext = (e as Error).message;
      console.log(`        FEHLER: ${fehlertext.slice(0, 200)}\n`);

      await db.from("applications").update({ status: "failed", error: fehlertext }).eq("job_id", a.job_id);
      await log("mail", "error", `Versand fehlgeschlagen: ${job.title}`, {
        jobId: a.job_id as string,
        data: { fehler: fehlertext },
      });
    }
  }
}

console.log(
  `${"=".repeat(60)}\n` +
    (env.dryRun
      ? `Trockenlauf: ${bereite?.length ?? 0} Bewerbung(en) waeren dran gewesen. Nichts verschickt.\n`
      : `${verschickt} verschickt, ${fehlgeschlagen} fehlgeschlagen.\n`),
);
