/**
 * Schreibt Nikis Profil und seine Regeln in die Tabelle `settings`.
 *
 * Die eigentlichen Daten (Name, Adresse, Schule, Geburtsdatum, Lebenslauf-
 * Text) stehen bewusst NICHT hier, sondern in profil-daten.ts - die Datei ist
 * ungetrackt (siehe .gitignore), weil das Repo oeffentlich werden soll.
 * Vorlage zum Ausfuellen: profil-daten.example.ts.
 *
 * Ab Phase 5 ändert Niki das in der Oberfläche - bis dahin hier.
 *
 * Starten mit:  npm run profil
 */
import { db } from "./lib/supabase.ts";
import { env } from "./lib/env.ts";
import { AUSSCHLUESSE, AUTO_AB, GEBURTSDATUM, NAME, PROFIL, RUECKFRAGE_AB, VERFUEGBARKEIT } from "./profil-daten.ts";

const { error } = await db
  .from("settings")
  .update({
    profile_text: PROFIL,
    availability: { ...VERFUEGBARKEIT, geburtsdatum: GEBURTSDATUM, name: NAME },
    exclusions: AUSSCHLUESSE,
    // Nikis Entscheidung am 2026-08-30: von 80 auf 70 gesenkt. Bei 80 blieb
    // wochenlang genau eine einzige Anzeige uebrig - der Bot haette so gut wie
    // nie von selbst geschrieben. Die Zahl steht in der Datenbank, hier steht
    // nur der Ausgangswert: `npm run profil` setzt sie zurueck auf diesen Stand.
    auto_send_min: AUTO_AB,
    approval_min: RUECKFRAGE_AB,
    cv_storage_path: env.cvPath,
    updated_at: new Date().toISOString(),
  })
  .eq("id", 1);

if (error) {
  console.error(`X  Profil nicht gespeichert: ${error.message}`);
  process.exit(1);
}

console.log(`
Profil gespeichert.

  Profiltext        ${PROFIL.length} Zeichen
  Verfügbarkeit     ${VERFUEGBARKEIT.tage.join(" / ")}, ${VERFUEGBARKEIT.stunden_pro_tag} Stunden
  Ausschlussliste   ${AUSSCHLUESSE.taetigkeiten.length} Stichworte, ${AUSSCHLUESSE.firmen.length} Firma(en)
  Geburtsdatum      ${GEBURTSDATUM ?? "nicht hinterlegt -> Filter rechnet mit unter 18"}
  Vollautomatik ab  ${AUTO_AB} Punkten, Rückfrage ab ${RUECKFRAGE_AB}
`);
