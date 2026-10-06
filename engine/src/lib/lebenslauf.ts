/**
 * Der Lebenslauf fuer den Mail-Anhang - lokal als PDF, in GitHub Actions
 * verschluesselt aus dem Repo.
 *
 * Seit 2026-10-06 verschickt auch der Motor in GitHub Actions Mail-Bewerbungen,
 * damit sie nicht davon abhaengen, dass Nikis PC an ist. Dort gibt es kein
 * `CV_PDF_PATH`. Das Repo ist oeffentlich, deshalb liegt der Lebenslauf darin
 * nur verschluesselt (`engine/lebenslauf.enc`, AES-256-GCM). Der Schluessel
 * steht als `CV_SCHLUESSEL` in der .env und als GitHub-Secret - nie im Repo.
 *
 * Aufbau der Datei: 12 Byte IV | 16 Byte Pruefsumme | verschluesselt(
 *   2 Byte Laenge des Dateinamens | Dateiname (UTF-8) | PDF ).
 * Der Dateiname steckt mit drin, weil er Nikis vollen Namen enthaelt.
 *
 * Neu verschluesseln (nach jeder Aenderung am Lebenslauf):
 *   npm run lebenslauf-verschluesseln
 */
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const VERSCHLUESSELT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "lebenslauf.enc");

export type Lebenslauf = { dateiname: string; inhalt: Buffer };

/** PDF unter CV_PDF_PATH, sonst die verschluesselte Fassung mit CV_SCHLUESSEL. */
export async function ladeLebenslauf(): Promise<Lebenslauf> {
  const pfad = process.env.CV_PDF_PATH;
  if (pfad) {
    const inhalt = await readFile(pfad).catch((e) => {
      throw new Error(`Lebenslauf nicht lesbar unter ${pfad}: ${(e as Error).message}`);
    });
    return { dateiname: basename(pfad), inhalt };
  }

  const schluessel = process.env.CV_SCHLUESSEL;
  if (!schluessel) {
    throw new Error("Weder CV_PDF_PATH noch CV_SCHLUESSEL gesetzt - kein Lebenslauf fuer den Anhang.");
  }
  return entschluesseln(await readFile(VERSCHLUESSELT), Buffer.from(schluessel, "base64"));
}

export function verschluesseln(lauf: Lebenslauf, schluessel: Buffer): Buffer {
  const name = Buffer.from(lauf.dateiname, "utf8");
  const laenge = Buffer.alloc(2);
  laenge.writeUInt16BE(name.length);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", schluessel, iv);
  const daten = Buffer.concat([c.update(Buffer.concat([laenge, name, lauf.inhalt])), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), daten]);
}

export function entschluesseln(datei: Buffer, schluessel: Buffer): Lebenslauf {
  const d = createDecipheriv("aes-256-gcm", schluessel, datei.subarray(0, 12));
  d.setAuthTag(datei.subarray(12, 28));
  let klar: Buffer;
  try {
    klar = Buffer.concat([d.update(datei.subarray(28)), d.final()]);
  } catch {
    throw new Error("Lebenslauf nicht entschluesselbar - CV_SCHLUESSEL passt nicht zu engine/lebenslauf.enc.");
  }
  const laenge = klar.readUInt16BE(0);
  return { dateiname: klar.subarray(2, 2 + laenge).toString("utf8"), inhalt: klar.subarray(2 + laenge) };
}
