/**
 * antwort - liest per IMAP im Bewerbungs-Postfach nach, ob eine Firma
 * geantwortet hat, und ordnet den Fund der richtigen Bewerbung zu.
 *
 * Letzter, bisher fehlender Teil von Phase 7 (siehe Bauplan: "Liest
 * zusaetzlich per IMAP das Bewerbungs-Postfach aus - nicht um Jobs zu
 * finden, sondern um Antworten von Firmen dem richtigen Job zuzuordnen").
 *
 * Nimmt alle Bewerbungen mit Status `sent` und noch leerem `reply_status`,
 * sucht im Posteingang nach Mails, die NACH dem eigenen Versand angekommen
 * sind und entweder von derselben Firmendomain stammen oder Firmenname/
 * Betreff wiedererkennen lassen. Haiku liest den Fund und ordnet ihn einer
 * von drei Kategorien zu: Einladung, Absage, Rueckfrage.
 *
 * Rein lesend: es wird nichts verschickt, nichts geloescht, nichts
 * verschoben. Einzige Nebenwirkung ist `applications.reply_status` in der
 * Datenbank plus - bei einem Fund - eine Telegram-Meldung (genau das "Telegram
 * informiert bei Einladung sofort" aus dem Bauplan).
 *
 * Starten mit:
 *   npm run antwort            alle offenen Bewerbungen pruefen
 *   npm run antwort trocken    nur zeigen, was gefunden wuerde - kein KI-Aufruf,
 *                              nichts gespeichert, keine Telegram-Nachricht
 */
import { Readable } from "node:stream";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { env, MODELS } from "../lib/env.ts";
import { claude, kosten } from "../lib/claude.ts";
import { sendeNachricht, telegramEingerichtet } from "../lib/telegram.ts";

if (!env.mailAddress || !env.mailPassword) {
  console.error(
    "X  [antwort] MAIL_ADDRESS oder MAIL_APP_PASSWORD fehlt in der .env.\n" +
      "        -> Dasselbe Konto, das agents/mail.ts zum Verschicken benutzt.",
  );
  process.exit(1);
}

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const TROCKEN = argv.includes("trocken");

// ------------------------------------------------------------- Klassifizierung
const FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    properties: {
      kategorie: {
        type: "string",
        description:
          "Genau eines: 'einladung' (Vorstellungsgespraech/Probearbeiten angeboten), " +
          "'absage' (Stelle ist vergeben oder er passt nicht), " +
          "'rueckfrage' (die Firma will etwas wissen, bevor es weitergeht), " +
          "oder 'sonstiges' (Automatische Eingangsbestaetigung, Werbung, unklar).",
      },
      begruendung: {
        type: "string",
        description: "Ein Satz auf Deutsch, direkt an Niki gerichtet, warum diese Kategorie.",
      },
    },
    required: ["kategorie", "begruendung"],
    additionalProperties: false,
  },
};

type Klassifizierung = { kategorie: string; begruendung: string };
const BEKANNTE_KATEGORIEN = ["einladung", "absage", "rueckfrage", "sonstiges"];

/** Vergleichbarer Firmenname fuer den Betreff-Abgleich: klein, ohne Rechtsform-Woerter. */
function normalisiereFirma(firma: string | null): string | null {
  if (!firma) return null;
  const erstesWort = firma
    .toLowerCase()
    .replace(/\b(gmbh|gesmbh|ges\.m\.b\.h\.?|kg|ohg|e\.?u\.?|ag|jobs?)\b/g, "")
    .trim()
    .split(/\s+/)[0];
  return erstesWort && erstesWort.length >= 4 ? erstesWort : null;
}

/** Sucht rekursiv den ersten Text-Teil einer Mail - erst text/plain, notfalls text/html. */
function findeTextTeil(struktur?: MessageStructureObject): MessageStructureObject | undefined {
  if (!struktur) return undefined;
  const alle: MessageStructureObject[] = [];
  const sammeln = (node: MessageStructureObject) => {
    alle.push(node);
    for (const kind of node.childNodes ?? []) sammeln(kind);
  };
  sammeln(struktur);
  return (
    alle.find((n) => n.type?.toLowerCase() === "text/plain") ??
    alle.find((n) => n.type?.toLowerCase() === "text/html")
  );
}

/** Liest einen Node-Stream vollstaendig als UTF-8-Text. */
async function liesStream(stream: Readable): Promise<string> {
  const teile: Buffer[] = [];
  for await (const teil of stream) teile.push(teil as Buffer);
  return Buffer.concat(teile).toString("utf-8");
}

type Anzeige = { title: string; company: string | null; contact_email: string | null };

async function lauf(offen: { jobId: string; sentAt: string; job: Anzeige }[]): Promise<void> {
  const client = new ImapFlow({
    host: env.mailImapHost,
    port: 993,
    secure: true,
    auth: { user: env.mailAddress!, pass: env.mailPassword! },
    logger: false,
  });

  await client.connect();
  let gefunden = 0;
  let kostenGesamt = 0;

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const k of offen) {
        const kopf = `${k.job.title.slice(0, 50)}  (${k.job.company ?? "?"})`;
        const seit = new Date(k.sentAt);

        const uids = await client.search({ since: seit }, { uid: true });
        if (!uids || uids.length === 0) {
          console.log(`${kopf}\n    keine Post seit dem Versand`);
          continue;
        }

        const domain = k.job.contact_email?.split("@")[1]?.trim().toLowerCase() || null;
        const firmenfragment = normalisiereFirma(k.job.company);

        let treffer: FetchMessageObject | undefined;
        for await (const msg of client.fetch(
          uids,
          { uid: true, envelope: true, internalDate: true, bodyStructure: true },
          { uid: true },
        )) {
          const absender = (msg.envelope?.from?.[0]?.address ?? "").toLowerCase();
          const betreff = (msg.envelope?.subject ?? "").toLowerCase();
          const passtDomain = Boolean(domain && absender.endsWith(`@${domain}`));
          const passtFirma = Boolean(firmenfragment && betreff.includes(firmenfragment));
          if (passtDomain || passtFirma) {
            treffer = msg;
            break; // client.fetch liefert chronologisch - der erste Treffer ist die frueheste Antwort.
          }
        }

        if (!treffer) {
          console.log(`${kopf}\n    ${uids.length} neue Mail(s) seither, keine passt zur Firma`);
          continue;
        }

        const textTeil = findeTextTeil(treffer.bodyStructure);
        let text = "";
        if (textTeil?.part) {
          const { content } = await client.download(String(treffer.uid), textTeil.part, { uid: true });
          text = await liesStream(content);
        }

        console.log(
          `${kopf}\n    Antwort gefunden: von ${treffer.envelope?.from?.[0]?.address ?? "?"}, ` +
            `Betreff "${treffer.envelope?.subject ?? "?"}"`,
        );

        if (TROCKEN) {
          console.log(`    TROCKENLAUF - wuerde jetzt klassifizieren, nichts gespeichert.`);
          continue;
        }

        const antwort = await claude.messages.create({
          model: MODELS.fast,
          max_tokens: 300,
          system: [
            {
              type: "text",
              text:
                "Du liest die Antwort einer Firma auf eine Bewerbung fuer einen Wochenendjob " +
                "und ordnest sie einer Kategorie zu.",
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content: `Betreff: ${treffer.envelope?.subject ?? "?"}\n\n${text.slice(0, 4000) || "(kein Text gefunden)"}`,
            },
          ],
          output_config: { format: FORMAT },
        });

        const roh = antwort.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        const geparst = JSON.parse(roh) as Klassifizierung;
        const kategorie = BEKANNTE_KATEGORIEN.includes(geparst.kategorie) ? geparst.kategorie : "sonstiges";
        const c = kosten(MODELS.fast, antwort.usage.input_tokens, antwort.usage.output_tokens);
        kostenGesamt += c;
        gefunden++;

        const zeitpunkt = (treffer.envelope?.date ? new Date(treffer.envelope.date) : new Date()).toISOString();

        await db
          .from("applications")
          .update({ reply_status: kategorie, reply_at: zeitpunkt })
          .eq("job_id", k.jobId);

        console.log(`    ${kategorie.toUpperCase()}: ${geparst.begruendung}`);

        await log("antwort", "info", `Antwort erkannt: ${k.job.title} - ${kategorie}`, {
          jobId: k.jobId,
          costUsd: c,
          data: { firma: k.job.company, kategorie, begruendung: geparst.begruendung },
        });

        if (telegramEingerichtet()) {
          const symbol = kategorie === "einladung" ? "🎉" : kategorie === "absage" ? "📪" : "✉️";
          try {
            await sendeNachricht(
              `${symbol} Antwort von ${k.job.company ?? "einer Firma"}\n${k.job.title}\n\n` +
                `${kategorie.toUpperCase()}: ${geparst.begruendung}\n\n` +
                `Betreff der Mail: ${treffer.envelope?.subject ?? "?"}`,
            );
          } catch (e) {
            console.log(`    Telegram-Meldung fehlgeschlagen: ${(e as Error).message.slice(0, 150)}`);
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  console.log(
    `${"=".repeat(60)}\n` +
      (TROCKEN
        ? "Trockenlauf beendet.\n"
        : `${gefunden} Antwort(en) erkannt und eingetragen. Kosten: ${(kostenGesamt * 100).toFixed(2)} US-Cent.\n`),
  );
}

// ------------------------------------------------------------- Kandidaten
// Nur echt VERSCHICKTE Bewerbungen - bei einer Testmail (MAIL_TEST_MODE) geht
// ohnehin alles an Niki selbst, eine "Antwort der Firma" gibt es dort nicht.
const { data: kandidaten, error } = await db
  .from("applications")
  .select("job_id, subject, sent_at, jobs(title, company, contact_email)")
  .eq("status", "sent")
  .is("reply_status", null);

if (error) {
  console.error(`X  [antwort] Bewerbungen nicht ladbar: ${error.message}`);
  process.exit(1);
}

const offen = (kandidaten ?? [])
  .map((k) => ({ jobId: k.job_id as string, sentAt: k.sent_at as string | null, job: k.jobs as unknown as Anzeige | null }))
  .filter((k): k is typeof k & { job: Anzeige; sentAt: string } => k.job !== null && k.sentAt !== null);

console.log(
  `\nApply AI - Antwort-Erkennung\n${"=".repeat(60)}\n` +
    `${offen.length} verschickte Bewerbung(en) ohne bekannte Antwort\n` +
    (TROCKEN ? "TROCKENLAUF - kein KI-Aufruf, keine Kosten, nichts wird gespeichert\n" : ""),
);

// Kein frueher process.exit(0): eine leere Liste durchlaeuft den Rest
// folgenlos (siehe die anderen Agenten - fruehe Ausstiege direkt nach einer
// Supabase-Abfrage stuerzen unter Windows gelegentlich ab).
if (offen.length === 0) {
  console.log("Nichts zu pruefen.\n");
} else {
  await lauf(offen);
}
