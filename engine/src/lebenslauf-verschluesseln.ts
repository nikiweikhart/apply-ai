/**
 * Legt den Lebenslauf verschluesselt als engine/lebenslauf.enc ab - fuer den
 * Mail-Versand in GitHub Actions (siehe lib/lebenslauf.ts).
 *
 * Gibt es in der .env noch keinen CV_SCHLUESSEL, wird einer erzeugt und
 * unten an die .env angehaengt. Er wird absichtlich NICHT ausgegeben: Niki
 * kopiert ihn selbst aus der .env in das GitHub-Secret CV_SCHLUESSEL.
 *
 *   npm run lebenslauf-verschluesseln
 */
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { env } from "./lib/env.ts";
import { VERSCHLUESSELT, entschluesseln, ladeLebenslauf, verschluesseln } from "./lib/lebenslauf.ts";

const ENV_DATEI = join(import.meta.dirname, "..", "..", ".env");

let roh = process.env.CV_SCHLUESSEL;
if (!roh) {
  roh = randomBytes(32).toString("base64");
  await appendFile(
    ENV_DATEI,
    `\n# Schluessel fuer engine/lebenslauf.enc - genau so auch als GitHub-Secret CV_SCHLUESSEL\nCV_SCHLUESSEL=${roh}\n`,
  );
  console.log("Neuer Schluessel erzeugt und als CV_SCHLUESSEL in die .env geschrieben.");
}
const schluessel = Buffer.from(roh, "base64");

// Bewusst aus CV_PDF_PATH, nicht aus einer alten .enc.
const lauf = await ladeLebenslauf();
const datei = verschluesseln(lauf, schluessel);

// Gegenprobe, bevor die Datei ueberschrieben wird.
const zurueck = entschluesseln(datei, schluessel);
if (!zurueck.inhalt.equals(lauf.inhalt) || zurueck.dateiname !== lauf.dateiname) {
  throw new Error("Gegenprobe fehlgeschlagen - nichts geschrieben.");
}

await writeFile(VERSCHLUESSELT, datei);
console.log(`${env.cvPath} -> engine/lebenslauf.enc (${datei.length} Byte), Gegenprobe ok.`);
