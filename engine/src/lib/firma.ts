/**
 * Erkennt, ob zwei Anzeigen von derselben Firma stammen.
 *
 * Warum es das braucht: seit die Schwelle fuer die Vollautomatik auf 70 steht,
 * liegen sechs McDonald's-Anzeigen von sechs verschiedenen Standorten im
 * automatischen Bereich. Der Fingerabdruck in `jobs` trennt sie zu Recht - es
 * sind ja verschiedene Anzeigen - aber sechs Bewerbungen an dieselbe Kette
 * waeren peinlich. Deshalb diese zweite, gruebere Klammer eine Ebene darueber:
 * pro Firma hoechstens eine Bewerbung innerhalb der Sperrfrist.
 *
 * Der Vergleich ist absichtlich eher grosszuegig (blockt im Zweifel), denn die
 * beiden Fehler sind nicht gleich schlimm:
 *   - zu viel geblockt  -> eine Anzeige wird uebersprungen, sie bleibt liegen
 *   - zu wenig geblockt -> sechs Briefe an dieselbe Firma, nicht rueckholbar
 */

/** Rechtsformen, Orte und Fuellwoerter, die keine Firma unterscheiden. */
const FUELLWOERTER = new Set([
  "gmbh", "gesmbh", "gesellschaft", "mbh", "ag", "kg", "og", "eu", "ohg", "se",
  "ltd", "limited", "inc", "co", "cokg", "holding", "gruppe", "group",
  "austria", "osterreich", "international", "wien", "vienna", "niederosterreich",
  "filiale", "standort", "zentrale", "betrieb", "betriebs", "handel", "handels",
  "warenhandel", "warenhandels", "vertrieb", "vertriebs", "service", "services",
  "gastronomie", "gastro", "restaurant", "markt", "market", "store", "shop",
  "und", "the", "der", "die", "das", "fur", "am", "im", "an",
  // Branchenwoerter, mit denen in Wien halbe Strassenzuege anfangen. Ohne sie
  // wuerde die Sperre "Cafe Central" und "Cafe Ritter" fuer dieselbe Firma halten.
  "cafe", "kaffee", "kaffeehaus", "bistro", "bar", "beisl", "imbiss", "pizzeria",
  "gasthaus", "gasthof", "wirtshaus", "hotel", "pension", "baeckerei", "backerei",
  "konditorei", "fleischerei", "apotheke", "trafik", "tankstelle", "autohaus",
  "friseur", "salon", "studio", "fitness", "boutique", "agentur", "kanzlei", "praxis",
  "verein", "stiftung", "zentrum", "haus",
]);

/**
 * Macht aus einem Firmennamen eine Liste vergleichbarer Woerter:
 * Kleinbuchstaben, Umlaute aufgeloest, Satzzeichen weg, Fuellwoerter weg.
 *
 *   "McDonald's Restaurant Wien 21"  ->  ["mcdonalds"]
 *   "McDonald's Osterreich GmbH"     ->  ["mcdonalds"]
 *   "WEIN & CO Handelsges.m.b.H."    ->  ["wein"]
 */
export function firmenWoerter(name: string | null | undefined): string[] {
  if (!name) return [];
  return name
    .toLowerCase()
    .replace(/ß/g, "ss")
    // Zerlegt Buchstaben mit Zeichen darueber und wirft das Zeichen weg:
    // aus "ü" wird "u", aus "é" wird "e". Sonst wuerde "Café" zu "caf e"
    // zerfallen und zwei verschiedene Cafés saehen gleich aus.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1 && !FUELLWOERTER.has(w) && !/^\d+$/.test(w));
}

/** Kurzform zum Anzeigen und Protokollieren. */
export function firmenSchluessel(name: string | null | undefined): string {
  return firmenWoerter(name).slice(0, 2).join(" ");
}

/**
 * Sind das zwei Anzeigen derselben Firma?
 *
 * Zwei Wege fuehren zu "ja":
 *   1. die aufgeraeumten Namen sind gleich, oder
 *   2. das erste tragende Wort ist gleich und lang genug (ab 4 Zeichen),
 *      damit nicht jedes kurze Allerweltswort zwei Firmen zusammenwirft.
 *
 * Ohne brauchbaren Namen (Anzeige ohne Firma) gibt es kein "ja" - sonst
 * wuerden alle namenlosen Anzeigen einander gegenseitig blockieren.
 */
export function gleicheFirma(a: string | null | undefined, b: string | null | undefined): boolean {
  const wa = firmenWoerter(a);
  const wb = firmenWoerter(b);
  if (wa.length === 0 || wb.length === 0) return false;
  if (wa.join(" ") === wb.join(" ")) return true;
  return wa[0] === wb[0] && (wa[0]?.length ?? 0) >= 4;
}

/** Wie lange eine Firma nach einer Bewerbung gesperrt bleibt. */
export const SPERRFRIST_TAGE = 30;

/** Liegt der Zeitpunkt noch innerhalb der Sperrfrist? */
export function innerhalbSperrfrist(zeitpunkt: string | null | undefined): boolean {
  if (!zeitpunkt) return true; // ohne Datum lieber sperren
  const alterTage = (Date.now() - new Date(zeitpunkt).getTime()) / 86_400_000;
  return alterTage < SPERRFRIST_TAGE;
}
