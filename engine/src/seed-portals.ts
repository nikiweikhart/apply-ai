/**
 * Traegt die Portalliste in die Datenbank ein bzw. bringt sie auf Stand.
 * Kann beliebig oft laufen - bestehende Eintraege werden aktualisiert,
 * der Zustand (status, last_run_at) bleibt erhalten.
 *
 * prio       = Reihenfolge, in der die Adapter gebaut werden
 * bot_risiko = wie wahrscheinlich das Portal Automatisierung blockt
 *
 * Starten mit:  npm run seed
 */
import { db } from "./lib/supabase.ts";

const PORTALE = [
  {
    id: "hokify",
    display_name: "hokify",
    search_url: "https://hokify.at/jobs",
    filters: {
      ort: "Wien",
      anstellung: ["geringfuegig", "Teilzeit"],
      prio: 1,
      bot_risiko: "niedrig",
      hinweis: "Gebaut fuer Aushilfsjobs, Bewerbung ohne Anschreiben moeglich",
    },
  },
  {
    id: "willhaben",
    display_name: "willhaben Jobs",
    search_url: "https://www.willhaben.at/jobs/",
    filters: {
      ort: "Wien",
      anstellung: ["geringfuegig", "Teilzeit"],
      prio: 2,
      bot_risiko: "niedrig",
      hinweis: "Groesstes Volumen, stark bei Handel und Gastro",
    },
  },
  {
    id: "ams",
    display_name: "AMS alle jobs",
    search_url: "https://jobs.ams.at/public/emps/jobs",
    filters: {
      ort: "Wien",
      prio: 3,
      bot_risiko: "niedrig",
      hinweis: "Staatlich, kein Login noetig, rechtlich am saubersten zu durchsuchen",
    },
  },
  {
    id: "studentjob",
    display_name: "StudentJob.at",
    search_url: "https://www.studentjob.at/samstagsjob/wien",
    filters: {
      ort: "Wien",
      prio: 4,
      bot_risiko: "niedrig",
      hinweis: "Eigene Kategorie Samstagsjob Wien, Arbeitgeber erwarten Schueler",
    },
  },
  {
    id: "karriere",
    display_name: "karriere.at",
    search_url: "https://www.karriere.at/jobs",
    filters: {
      ort: "Wien",
      anstellung: ["geringfuegig", "Teilzeit"],
      prio: 5,
      bot_risiko: "mittel",
      hinweis: "Dort posten die grossen Ketten",
    },
  },
  {
    id: "indeed",
    display_name: "Indeed AT",
    search_url: "https://at.indeed.com/jobs",
    filters: {
      ort: "Wien",
      anstellung: ["geringfuegig", "Teilzeit"],
      prio: 6,
      bot_risiko: "hoch",
      hinweis: "Blockt Automatisierung stark - bei Sperre auf manuell umstellen",
    },
  },
];

const { error } = await db
  .from("portals")
  .upsert(PORTALE, { onConflict: "id", ignoreDuplicates: false });

if (error) {
  console.error(`X  Fehlgeschlagen: ${error.message}`);
  process.exit(1);
}

const { data } = await db.from("portals").select("id, display_name, filters, status");
const sortiert = (data ?? []).sort(
  (a, b) =>
    ((a.filters as { prio?: number }).prio ?? 99) - ((b.filters as { prio?: number }).prio ?? 99),
);

console.log(`\n${sortiert.length} Portale in der Datenbank:\n`);
for (const p of sortiert) {
  const f = p.filters as { prio?: number; bot_risiko?: string };
  console.log(
    `  ${f.prio ?? "?"}. ${p.display_name.padEnd(16)} ` +
      `Bot-Risiko: ${(f.bot_risiko ?? "?").padEnd(8)} Zustand: ${p.status}`,
  );
}
console.log("");
