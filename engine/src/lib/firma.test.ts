/**
 * Pruefstuecke fuer die Firmensperre.
 *
 * Die Sperre entscheidet, ob zwei Anzeigen von derselben Firma stammen - und
 * damit, ob ein zweiter Brief an dieselbe Kette rausgeht. Das laesst sich
 * schlecht "mal eben ansehen", deshalb steht hier eine Liste echter Wiener
 * Firmennamen mit dem erwarteten Urteil.
 *
 * Starten mit:  npm test
 * (braucht weder Internet noch Datenbank noch KI - laeuft in einer Sekunde)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gleicheFirma, firmenWoerter } from "./firma.ts";

const GLEICH: [string, string][] = [
  // Der Anlassfall: sechs Standorte derselben Kette in der Vollautomatik.
  ["McDonald's Restaurant Wien 21", "McDonald's Osterreich GmbH"],
  ["McDonald's Franchise Wien 10", "McDonald's Wien Floridsdorf"],
  ["WEIN & CO Handelsges.m.b.H.", "WEIN & CO"],
  ["SPAR Osterreichische Warenhandels-AG", "SPAR Wien 23"],
  ["XXXLutz KG", "XXXLutz Wien Nord"],
  ["Hofer KG", "HOFER Filiale 1230 Wien"],
  // Akzente duerfen keinen Unterschied machen.
  ["Café Central", "Café Central Wien"],
];

const VERSCHIEDEN: [string | null, string][] = [
  ["BILLA AG", "SPAR Wien"],
  // Branchenwoerter am Anfang duerfen nicht zusammenwerfen, was nicht
  // zusammengehoert - davon gibt es in Wien ganze Strassenzuege.
  ["Cafe Central", "Cafe Ritter"],
  ["Bäckerei Felber", "Bäckerei Ströck"],
  ["Interspar", "Spar"],
  // Ohne Firmennamen wird nie gesperrt, sonst blockieren sich alle
  // namenlosen Anzeigen gegenseitig.
  [null, "BILLA"],
  ["Restaurant Wien GmbH", "Markt Wien GmbH"],
];

test("dieselbe Firma wird erkannt", () => {
  for (const [a, b] of GLEICH) {
    assert.equal(gleicheFirma(a, b), true, `${a} sollte gleich ${b} sein`);
  }
});

test("verschiedene Firmen bleiben verschieden", () => {
  for (const [a, b] of VERSCHIEDEN) {
    assert.equal(gleicheFirma(a, b), false, `${a} sollte nicht gleich ${b} sein`);
  }
});

test("Rechtsform, Ort und Hausnummer fallen weg", () => {
  assert.deepEqual(firmenWoerter("BILLA AG, Filiale Wien 1100"), ["billa"]);
  assert.deepEqual(firmenWoerter("Restaurant GmbH"), []);
});
