/**
 * Zeigt die fertigen Anschreiben, so wie sie in der Datenbank stehen.
 *
 * Das ist bis zur Oberflaeche (Phase 5) und bis zur Telegram-Freigabe der Weg,
 * auf dem Niki liest, was der Bot geschrieben hat - bevor irgendetwas
 * verschickt wird.
 *
 * Starten mit:
 *   npm run anschreiben          alle Entwuerfe, neueste zuerst
 *   npm run anschreiben 1        nur den neuesten
 *   npm run anschreiben kurz     nur die Liste, ohne die Brieftexte
 */
import { db } from "./lib/supabase.ts";

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const anzahl = Number(argv.find((a) => /^\d+$/.test(a)) ?? 20);
const KURZ = argv.includes("kurz");

const { data, error } = await db
  .from("applications")
  .select(
    "status, channel, subject, cover_letter, created_at, jobs(title, company, location, url, contact_email)",
  )
  .order("created_at", { ascending: false })
  .limit(anzahl);

if (error) {
  console.error(`X  Anschreiben nicht ladbar: ${error.message}`);
  process.exit(1);
}

// Markierter Block statt fruehem process.exit(0): Node stuerzt unter Windows
// gelegentlich ab, wenn der Prozess erzwungen beendet wird, waehrend eine
// offene Datenbankverbindung noch am Schliessen ist. `break liste` ueberspringt
// die ganze Liste (Kopfzeile, Schleife, Fusszeile) und laesst Node danach
// sauber von selbst enden - anders als bei process.exit() muss das Label
// deshalb den kompletten Rest der Datei umschliessen, nicht nur die Pruefung.
liste: {
if ((data ?? []).length === 0) {
  console.log(
    "\nNoch keine Anschreiben da.\n" +
      "Eines schreiben lassen:  npm run write 1   (kostet ungefaehr 1 US-Cent)\n",
  );
  break liste;
}

console.log(
  `\n${(data ?? []).length} Anschreiben, neueste zuerst. ` +
    `Status "draft" heisst: liegt da, nichts verschickt.\n${"=".repeat(72)}`,
);

for (const a of data ?? []) {
  const job = a.jobs as unknown as {
    title: string;
    company: string | null;
    location: string | null;
    url: string;
    contact_email: string | null;
  } | null;

  const datum = new Date(a.created_at as string).toLocaleDateString("de-AT");

  console.log(
    `\n[${a.status}]  ${job?.title ?? "?"}\n` +
      `   ${job?.company ?? "?"}  |  ${job?.location ?? "?"}  |  ${datum}  |  ` +
      `Weg: ${a.channel ?? "?"}${job?.contact_email ? ` (${job.contact_email})` : ""}\n` +
      `   ${job?.url ?? ""}\n` +
      `   Betreff: ${a.subject ?? "-"}`,
  );

  if (!KURZ) {
    console.log(`   ${"-".repeat(69)}`);
    for (const zeile of ((a.cover_letter as string | null) ?? "(kein Text)").split("\n")) {
      console.log(`   ${zeile}`);
    }
  }
}

console.log(
  `\n${"=".repeat(72)}\n` +
    `Passt etwas nicht? 'npm run write nochmal 1' schreibt das beste neu.\n`,
);
} // Ende "liste:"
