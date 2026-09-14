/**
 * Zeigt die bewerteten Anzeigen, die besten zuerst.
 *
 * Das ist bis zur Oberfläche (Phase 5) die Trefferliste: was Apply AI
 * gefunden hat, wie es bewertet wurde und warum.
 *
 * Starten mit:
 *   npm run treffer          die besten 10
 *   npm run treffer 25       die besten 25
 *   npm run treffer alle     auch die aussortierten
 */
import { db } from "./lib/supabase.ts";

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const anzahl = Number(argv.find((a) => /^\d+$/.test(a)) ?? 10);
const auchAussortierte = argv.includes("alle");

const { data: einstellungen } = await db
  .from("settings")
  .select("auto_send_min, approval_min")
  .eq("id", 1)
  .single();
const autoAb = (einstellungen?.auto_send_min as number | null) ?? 70;
const freigabeAb = (einstellungen?.approval_min as number | null) ?? 60;

let abfrage = db
  .from("scores")
  .select("score, reasoning, kjbg_ok, kjbg_reason, hard_filtered, jobs(title, company, location, employment, url)")
  .order("score", { ascending: false })
  .limit(anzahl);

if (!auchAussortierte) abfrage = abfrage.eq("hard_filtered", false);

const { data, error } = await abfrage;

if (error) {
  console.error(`X  Trefferliste nicht ladbar: ${error.message}`);
  process.exit(1);
}

const { count: gesamt } = await db.from("scores").select("id", { count: "exact", head: true });
const { count: aussortiert } = await db
  .from("scores")
  .select("id", { count: "exact", head: true })
  .eq("hard_filtered", true);

console.log(
  `\n${gesamt ?? 0} Anzeigen bewertet, davon ${aussortiert ?? 0} im Vorfilter aussortiert.\n` +
    `Ab ${autoAb} Punkten würde Apply AI ohne Rückfrage bewerben, ab ${freigabeAb} nachfragen.\n` +
    `${"=".repeat(72)}\n`,
);

for (const s of data ?? []) {
  const job = s.jobs as unknown as {
    title: string;
    company: string | null;
    location: string | null;
    employment: string | null;
    url: string;
  } | null;
  if (!job) continue;

  const punkte = s.score as number;
  const balken = "#".repeat(Math.round(punkte / 5)).padEnd(20, ".");
  const marke =
    s.hard_filtered
      ? "aussortiert"
      : punkte >= autoAb
        ? "AUTOMATISCH"
        : punkte >= freigabeAb
          ? "Rückfrage"
          : "zu schwach";

  console.log(`${balken} ${String(punkte).padStart(3)}  [${marke}]  ${job.title}`);
  console.log(
    `                       ${job.company ?? "?"}  |  ${job.location ?? "?"}  |  ${job.employment ?? "?"}`,
  );
  console.log(`                       ${s.reasoning}`);
  if (s.kjbg_reason) console.log(`                       Jugendschutz: ${s.kjbg_reason}`);
  console.log(`                       ${job.url}\n`);
}
