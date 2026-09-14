/**
 * freigabe - die Telegram-Seite der Bewerbungen.
 *
 * Zwei Aufgaben, in dieser Reihenfolge:
 *
 *   1. Nachholen: Entwuerfe, die noch als "draft" dastehen (Telegram war beim
 *      Schreiben nicht eingerichtet, oder der Versand ist damals
 *      fehlgeschlagen), werden jetzt alsdoch geschickt. Im Normalfall
 *      passiert das schon direkt in `agents/write.ts` - das hier ist nur das
 *      Netz darunter.
 *   2. Zuhoeren: Knopfdruecke von Telegram abholen ("Freigeben" / "Ablehnen")
 *      und in der Datenbank eintragen. Freigegebene Anschreiben bekommen den
 *      Status `approved` - was damit passiert, entscheidet Phase 7 (Mail-
 *      Versand). Dieses Skript verschickt selbst nichts.
 *
 * Es gibt (noch) keinen Zeitplan, der das automatisch aufruft - Vercel ist
 * noch nicht da (Phase 5) und ein Telegram-Webhook braucht eine oeffentliche
 * Adresse. Bis dahin: nach dem Draufdruecken auf dem Handy hier Bescheid
 * sagen, dann laeuft's.
 *
 * Starten mit:  npm run freigabe
 */
import { db } from "../lib/supabase.ts";
import { log } from "../lib/log.ts";
import { sendeNachricht, holeUpdates, beantworteKnopf, telegramEingerichtet } from "../lib/telegram.ts";

if (!telegramEingerichtet()) {
  console.error(
    "X  [freigabe] TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID fehlt in der .env.\n" +
      "        -> Ohne die beiden kann Apply AI nicht auf Telegram schreiben.",
  );
  process.exit(1);
}

console.log(`\nApply AI - Freigabe\n${"=".repeat(60)}`);

// ------------------------------------------------------------- 1. Nachholen
const { data: nachzuholen, error: ladeFehler } = await db
  .from("applications")
  .select("job_id, subject, cover_letter, error, jobs(id, title, company, location, url)")
  .eq("status", "draft");

if (ladeFehler) {
  console.error(`X  [freigabe] Entwuerfe nicht ladbar: ${ladeFehler.message}`);
  process.exit(1);
}

let nachgeholt = 0;
for (const a of nachzuholen ?? []) {
  const job = a.jobs as unknown as {
    id: string;
    title: string;
    company: string | null;
    location: string | null;
    url: string;
  } | null;
  if (!job) continue;

  try {
    await sendeNachricht(
      `Anschreiben (nachgeholt)\n` +
        `${job.title}\n${job.company ?? "?"}  |  ${job.location ?? "?"}\n\n` +
        `Betreff: ${a.subject ?? "-"}\n\n${a.cover_letter ?? "(kein Text)"}\n\n${job.url}`,
      [
        { text: "Freigeben", callback_data: `appr:${job.id}` },
        { text: "Ablehnen", callback_data: `rej:${job.id}` },
      ],
    );
    await db.from("applications").update({ status: "pending_approval" }).eq("job_id", job.id);
    nachgeholt++;
    console.log(`    nachgeholt: ${job.title}`);
  } catch (e) {
    console.log(`    FEHLER beim Nachholen (${job.title}): ${(e as Error).message.slice(0, 150)}`);
  }
}

console.log(
  nachgeholt > 0
    ? `${nachgeholt} liegengebliebene Entwuerfe nachgeschickt.\n`
    : "Nichts nachzuholen - alle Entwuerfe waren schon unterwegs.\n",
);

// ------------------------------------------------------------- 2. Zuhoeren
const updates = await holeUpdates();

// Kein fruehes process.exit(0) bei leeren Updates: Node stuerzt unter
// Windows gelegentlich ab, wenn der Prozess erzwungen beendet wird, waehrend
// eine offene Datenbank-/HTTP-Verbindung noch am Schliessen ist. Eine leere
// `updates`-Liste durchlaeuft die folgenden Schritte ohnehin folgenlos - die
// Schlusszeile ganz unten meldet dann "0 Knopfdruecke verarbeitet".

// Alle offenen Bewerbungen auf einmal laden, statt pro Knopfdruck einzeln
// nachzufragen.
const jobIds = updates
  .map((u) => u.callback_query?.data)
  .filter((d): d is string => Boolean(d))
  .map((d) => d.split(":")[1])
  .filter((id): id is string => Boolean(id));

const { data: offene } = await db
  .from("applications")
  .select("job_id, status, jobs(title, company)")
  .in("job_id", jobIds.length > 0 ? jobIds : ["-"])
  .eq("status", "pending_approval");

const offeneNachJobId = new Map((offene ?? []).map((a) => [a.job_id as string, a]));

let bearbeitet = 0;
let hoechsteUpdateId = 0;

for (const u of updates) {
  hoechsteUpdateId = Math.max(hoechsteUpdateId, u.update_id);
  const cq = u.callback_query;
  if (!cq?.data) continue;

  const [aktion, jobId] = cq.data.split(":");
  if (!jobId) continue;
  const eintrag = offeneNachJobId.get(jobId);

  if (!eintrag) {
    // Schon bearbeitet (z.B. beim letzten Lauf) oder unbekannte Anzeige -
    // dem Knopf trotzdem Bescheid geben, damit das Ladesymbol verschwindet.
    await beantworteKnopf(cq.id, "Schon bearbeitet.");
    continue;
  }

  const job = eintrag.jobs as unknown as { title: string; company: string | null } | null;
  const neuerStatus = aktion === "appr" ? "approved" : aktion === "rej" ? "rejected" : null;
  if (!neuerStatus) {
    await beantworteKnopf(cq.id);
    continue;
  }

  await db.from("applications").update({ status: neuerStatus }).eq("job_id", jobId);
  await beantworteKnopf(cq.id, neuerStatus === "approved" ? "Freigegeben ✅" : "Abgelehnt ❌");
  await sendeNachricht(
    `${neuerStatus === "approved" ? "✅ Freigegeben" : "❌ Abgelehnt"}: ` +
      `${job?.title ?? jobId} (${job?.company ?? "?"})`,
  );
  bearbeitet++;
  console.log(`    ${neuerStatus}: ${job?.title ?? jobId}`);

  await log("freigabe", "info", `Telegram-Freigabe: ${neuerStatus}`, {
    jobId,
    data: { firma: job?.company },
  });
}

// Verarbeitete Updates bei Telegram als erledigt markieren, sonst kommen sie
// beim naechsten Lauf wieder.
if (hoechsteUpdateId > 0) await holeUpdates(hoechsteUpdateId + 1);

console.log(
  `\n${"=".repeat(60)}\n${bearbeitet} Knopfdruecke verarbeitet, ${updates.length - bearbeitet} uebersprungen (schon erledigt oder ohne Knopf).\n`,
);
