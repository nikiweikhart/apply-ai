/**
 * Zeigt die zuletzt gefundenen Anzeigen im Terminal.
 *
 * Bis die Oberflaeche steht (Phase 5) ist das der schnellste Blick darauf,
 * was der Scout eingesammelt hat - ohne Umweg ueber die Supabase-Seite.
 *
 * Starten mit:
 *   npm run jobs           die letzten 10
 *   npm run jobs 30        die letzten 30
 *   npm run jobs 5 lang    mit den ersten Zeilen des Anzeigentexts
 */
import { db } from "./lib/supabase.ts";

const argv = process.argv.slice(2);
const anzahl = Number(argv.find((a) => /^\d+$/.test(a)) ?? 10);
const ausfuehrlich = argv.includes("lang");

const { data, error } = await db
  .from("jobs")
  .select("portal_id, title, company, location, employment, contact_email, url, description, found_at")
  .order("found_at", { ascending: false })
  .limit(anzahl);

if (error) {
  console.error(`X  Anzeigen nicht ladbar: ${error.message}`);
  process.exit(1);
}

const { count } = await db.from("jobs").select("id", { count: "exact", head: true });

console.log(`\n${count ?? 0} Anzeigen in der Datenbank, die letzten ${data?.length ?? 0}:\n`);

for (const j of data ?? []) {
  const wann = new Date(j.found_at as string).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`${j.title}`);
  console.log(
    `   ${j.company ?? "Firma unbekannt"}  |  ${j.location ?? "Ort unbekannt"}  |  ` +
      `${j.employment ?? "Anstellung unbekannt"}`,
  );
  console.log(`   ${j.contact_email ?? "keine Mailadresse in der Anzeige"}`);
  console.log(`   ${j.url}   (${j.portal_id}, gefunden ${wann})`);
  if (ausfuehrlich) {
    const text = (j.description as string | null) ?? "";
    console.log(
      text
        .split("\n")
        .filter((z) => z.trim())
        .slice(0, 8)
        .map((z) => `      ${z.trim().slice(0, 90)}`)
        .join("\n"),
    );
  }
  console.log("");
}
