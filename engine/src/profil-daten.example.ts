/**
 * Vorlage fuer profil-daten.ts - die echten persoenlichen Daten (Name,
 * Adresse, Schule, Geburtsdatum, Lebenslauf-Text). Diese Datei hier ist nur
 * das Muster und enthaelt Platzhalter.
 *
 * Einrichtung:  Kopieren als profil-daten.ts (bleibt ungetrackt, siehe
 * .gitignore) und mit den eigenen Daten ausfuellen. Danach: npm run profil
 */

export const NAME = "Vorname Nachname";

/**
 * Dieser Text geht bei JEDER Bewertung als fester Vorspann an Claude und wird
 * zwischengespeichert (cache_control). Deshalb: knapp halten, aber alles
 * hineinschreiben, was für ein Urteil "passt / passt nicht" nötig ist.
 */
export const PROFIL = `
Vorname Nachname, wohnhaft Musterstraße 1, 1010 Wien. Kurzbeschreibung von
Schule/Ausbildung und Stand (z. B. "8. Klasse, Matura voraussichtlich 2027").
Sucht einen Wochenendjob neben der Schule.

Verfügbarkeit: z. B. Samstag oder Sonntag ganztags, 8 bis 10 Stunden.

Führerschein/Mobilität, falls vorhanden.

Erfahrung: bisherige Jobs, Praktika, ehrenamtliche Taetigkeiten.

Kenntnisse: Sprachen, Software, sonstige Faehigkeiten.

Eigenschaften: was einen als Bewerber ausmacht.

Interessen und Berufsziel: worauf die Jobsuche hinarbeitet.
`.trim();

export const VERFUEGBARKEIT = {
  tage: ["Samstag", "Sonntag"],
  stunden_pro_tag: "8-10",
  feiertage: "nach Möglichkeit",
  wochentags: false,
  hinweis: "Unter der Woche Schule - nur Wochenende.",
};

export const AUSSCHLUESSE = {
  // Stichworte im ANZEIGENTITEL, die sofort aussortieren.
  taetigkeiten: ["Babysitt", "Lagerarbeit"],
  // Ganze Firmen, unabhaengig vom Anzeigentitel.
  firmen: [],
  hinweis:
    "taetigkeiten: Stichworte im ANZEIGENTITEL, die sofort aussortieren. " +
    "firmen: ganze Arbeitgeber, unabhaengig vom Titel. Beides erweiterbar, ohne Code anzufassen.",
};

/**
 * Geburtsdatum steuert den Jugendschutz-Filter: unter 18 gelten strengere
 * Regeln (keine Nachtarbeit, kein Sicherheitsdienst, Sonntag eingeschränkt).
 * null, falls nicht bekannt - der Filter rechnet dann sicherheitshalber mit
 * unter 18.
 */
export const GEBURTSDATUM: string | null = null;

/** Ab wie vielen Punkten Apply AI ohne Rueckfrage schreibt - und ab wann er nachfragt. */
export const AUTO_AB = 70;
export const RUECKFRAGE_AB = 60;
