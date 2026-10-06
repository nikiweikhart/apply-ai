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
 * Vor jeder Mail (seit 2026-10-05, vor dem ersten echten Versand):
 *   - Firma auf `settings.exclusions.firmen`?           -> nicht schicken
 *   - Adresse gehoert dem Portal (info@studentjob.at)?   -> `needs_manual`
 *   - Anzeige noch online? (lib/anzeige.ts)              -> sonst `failed`
 *   - Anschreiben aufraeumen (lib/brief.ts)
 * Nach jeder echten Mail eine Telegram-Nachricht, damit Niki sieht, was
 * in seinem Namen rausging.
 *
 * Starten mit:
 *   npm run mail             alle freigegebenen, noch nicht verschickten
 *   npm run mail 1           nur eine (zum Ausprobieren)
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { env } from "../lib/env.ts";
import { verschicke } from "../lib/mailer.ts";
import { ladeLebenslauf } from "../lib/lebenslauf.ts";
import { briefAufraeumen, istPortalAdresse } from "../lib/brief.ts";
import { anzeigeNochAktiv } from "../lib/anzeige.ts";
import { browserStarten, cookiesAblehnen, warte } from "../lib/browser.ts";
import { sendeNachricht, telegramEingerichtet } from "../lib/telegram.ts";

if (!env.mailAddress || !env.mailPassword) {
  console.error(
    "X  [mail] MAIL_ADDRESS oder MAIL_APP_PASSWORD fehlt in der .env.\n" +
      "        -> Ohne die beiden kann Apply AI keine Mail verschicken.\n" +
      "        -> App-Passwort holen: myaccount.google.com -> Sicherheit -> App-Passwoerter.",
  );
  process.exit(1);
}

// Einmal vorab: ohne Lebenslauf gar nicht erst anfangen. Sonst landete jede
// Bewerbung dieses Laufs auf `failed`, obwohl nur der Anhang fehlte (z. B.
// CV_SCHLUESSEL nicht als GitHub-Secret eingetragen).
try {
  await ladeLebenslauf();
} catch (e) {
  console.error(`X  [mail] ${(e as Error).message}`);
  process.exit(1);
}

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const MAX = Number(argv.find((a) => /^\d+$/.test(a)) ?? 999);

const { data: bereite, error: ladeFehler } = await db
  .from("applications")
  .select("job_id, subject, cover_letter, jobs(title, company, contact_email, url)")
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

const { data: einstellungen } = await db.from("settings").select("exclusions, availability").eq("id", 1).single();
const ausgeschlosseneFirmen = (((einstellungen?.exclusions ?? {}) as { firmen?: string[] }).firmen ?? [])
  .map((f) => f.trim().toLowerCase())
  .filter(Boolean);
const name = ((einstellungen?.availability ?? {}) as { name?: string }).name ?? "";

let verschickt = 0;
let fehlgeschlagen = 0;
let abgelaufen = 0;
let ausgelassen = 0;

// `if/else` statt eines fruehen process.exit(0): Node stuerzt unter Windows
// gelegentlich ab ("Assertion failed ... UV_HANDLE_CLOSING"), wenn der
// Prozess erzwungen beendet wird, waehrend eine offene Datenbankverbindung
// noch am Schliessen ist. Den leeren Fall stattdessen einfach ueberspringen
// laesst Node sich selbst und seine Verbindungen sauber aufraeumen.
if (!bereite || bereite.length === 0) {
  console.log("Nichts zu verschicken.\n");
} else {
  // Ein Browser fuer die Gueltigkeitspruefung aller Anzeigen dieses Laufs.
  const { page, schliessen } = await browserStarten();
  try {
    for (const a of bereite) {
      const job = a.jobs as unknown as {
        title: string;
        company: string | null;
        contact_email: string | null;
        url: string;
      } | null;

      if (!job?.contact_email) {
        console.log(`    UEBERSPRUNGEN (keine Mailadresse): ${job?.title ?? a.job_id}`);
        continue;
      }

      console.log(`    ${job.title} (${job.company ?? "?"})`);

      const firma = (job.company ?? "").toLowerCase();
      const gesperrt = ausgeschlosseneFirmen.find((f) => firma.includes(f));
      if (gesperrt) {
        ausgelassen++;
        console.log(`        AUSGELASSEN - Firma ausgeschlossen (${gesperrt})\n`);
        continue;
      }

      if (istPortalAdresse(job.contact_email)) {
        ausgelassen++;
        const grund = `${job.contact_email} gehoert dem Portal, nicht der Firma - Bewerbung nur ueber das Portal moeglich.`;
        console.log(`        AUSGELASSEN - ${grund}\n`);
        if (!env.dryRun) {
          await db.from("applications").update({ status: "needs_manual", channel: "portal", error: grund }).eq("job_id", a.job_id);
        }
        continue;
      }

      // Zwischen Fund und Versand liegen leicht drei Wochen - eine Bewerbung
      // auf eine laengst vergebene Stelle soll nicht rausgehen.
      let aktiv: { aktiv: boolean; grund: string };
      try {
        aktiv = await anzeigeNochAktiv(page, job.url);
        await cookiesAblehnen(page);
      } catch (e) {
        // Netzwerkfehler heisst nicht "weg" - diesmal liegen lassen, naechster Lauf.
        ausgelassen++;
        console.log(`        AUSGELASSEN - Anzeige gerade nicht pruefbar: ${(e as Error).message.slice(0, 120)}\n`);
        continue;
      }
      if (!aktiv.aktiv) {
        abgelaufen++;
        const fehlertext = `Anzeige ist nicht mehr verfuegbar (${aktiv.grund}).`;
        console.log(`        ABGELAUFEN - ${aktiv.grund}\n`);
        if (!env.dryRun) {
          await db.from("applications").update({ status: "failed", error: fehlertext }).eq("job_id", a.job_id);
          await log("mail", "warn", `Anzeige abgelaufen: ${job.title}`, { jobId: a.job_id as string, data: { url: job.url } });
        }
        await warte(800, 1500);
        continue;
      }

      const empfaenger = env.mailTestMode ? env.mailAddress! : job.contact_email;
      const betreff = env.mailTestMode
        ? `[TEST - ginge an ${job.contact_email}] ${a.subject}`
        : a.subject ?? "Bewerbung";
      const text = briefAufraeumen(a.cover_letter ?? "", name);

      console.log(`        an: ${empfaenger}`);

      if (env.dryRun) {
        console.log(`        DRY_RUN - nicht wirklich verschickt.\n`);
        continue;
      }

      // Seit 2026-10-06 verschicken zwei Stellen: der Motor in GitHub Actions
      // und versand.ps1 auf Nikis PC. Laufen beide gleichzeitig (der PC holt
      // einen verpassten Lauf nach), duerfte keine Bewerbung doppelt rausgehen.
      // Deshalb erst `approved` -> `sending` umstellen - nur wer das schafft,
      // schickt. Bricht ein Lauf genau hier ab, bleibt `sending` stehen und
      // wird nie automatisch wiederholt (lieber einmal zu wenig als doppelt).
      const { data: geholt } = await db
        .from("applications")
        .update({ status: "sending", updated_at: new Date().toISOString() })
        .eq("job_id", a.job_id)
        .eq("status", "approved")
        .select("job_id");
      if (!geholt?.length) {
        ausgelassen++;
        console.log(`        AUSGELASSEN - schickt gerade ein anderer Lauf.\n`);
        continue;
      }

      try {
        const messageId = await verschicke({ an: empfaenger, betreff, text });
        verschickt++;
        console.log(`        verschickt (${messageId})\n`);

        // Im Testmodus ging die Mail an Niki selbst - die Bewerbung bleibt
        // also `approved`, sonst waere sie "verbraucht", ohne dass die
        // Firma je etwas bekommen hat (Fehler bis 2026-10-05).
        if (!env.mailTestMode) {
          await db
            .from("applications")
            .update({ status: "sent", sent_at: new Date().toISOString(), cover_letter: text, error: null })
            .eq("job_id", a.job_id);
          await telegram(`✅ per Mail abgeschickt\n${job.company ?? "?"}\n${job.title}\nan: ${empfaenger}\n\n${job.url}`);
        } else {
          await db.from("applications").update({ status: "approved" }).eq("job_id", a.job_id);
        }

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
      // Hoeflicher Abstand zwischen zwei Mails - Gmail mag keine Salven.
      await warte(4000, 7000);
    }
  } finally {
    await schliessen();
  }
}

console.log(
  `${"=".repeat(60)}\n` +
    (env.dryRun
      ? `Trockenlauf: ${bereite?.length ?? 0} Bewerbung(en) waeren dran gewesen, ${abgelaufen} davon abgelaufen, ` +
        `${ausgelassen} ausgelassen. Nichts verschickt.\n`
      : `${verschickt} verschickt${env.mailTestMode ? " (TESTMODUS - an dich selbst)" : ""}, ` +
        `${fehlgeschlagen} fehlgeschlagen, ${abgelaufen} abgelaufen, ${ausgelassen} ausgelassen.\n`),
);

/** Telegram-Nachricht an Niki - ein Fehler dabei bricht den Lauf nicht ab. */
async function telegram(text: string): Promise<void> {
  if (!telegramEingerichtet()) return;
  try {
    await sendeNachricht(text);
  } catch (e) {
    console.log(`        Telegram-Meldung fehlgeschlagen: ${(e as Error).message.slice(0, 150)}`);
  }
}
