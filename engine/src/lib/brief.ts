/**
 * Alles, was ein Anschreiben oder eine Adresse pruefen muss, bevor es
 * wirklich rausgeht - reine Textarbeit, ohne Internet und ohne Datenbank,
 * damit `npm test` es pruefen kann.
 *
 * Entstanden am 2026-10-05 beim Durchsehen aller 37 freigegebenen
 * Bewerbungen vor dem ersten echten Versand:
 *
 *   - Drei Anschreiben enthielten mitten im Text drei Backticks ("```") -
 *     ein Rest aus der Modellantwort, der in einer echten Bewerbung peinlich
 *     waere.
 *   - Vier Anschreiben endeten nur mit dem Namen, ohne Grussformel.
 *   - Fuenf StudentJob-Anzeigen hatten als "Firmenmail" info@studentjob.at -
 *     die Adresse des Portals selbst, die auf jeder Seite unten steht. Eine
 *     Bewerbung dorthin landet beim Portal-Support, nicht beim Arbeitgeber.
 */

/**
 * Domains der Jobportale selbst. Eine Adresse dort ist nie die des
 * Arbeitgebers. Dazu gehoert auch hokifys Bewerbungsadresse
 * apply.job.<nr>@hokifyjob.com: am 2026-10-05 echt ausprobiert, sie leitet
 * NICHT an die Firma weiter, sondern antwortet nur mit "bewirb dich hier
 * ueber hokify.at/apply/<nr>" - solche Anzeigen laufen deshalb ueber den
 * hokify-Adapter (Weg portal), der wirklich abschickt.
 */
export const PORTAL_DOMAINS = [
  "studentjob.at",
  "studentjob.de",
  "willhaben.at",
  "karriere.at",
  "hokify.at",
  "hokify.com",
  "hokifyjob.com",
  "indeed.com",
  "indeed.at",
  "ams.at",
];

/** true, wenn die Adresse zum Portal gehoert und nicht zur Firma. */
export function istPortalAdresse(mail: string): boolean {
  const domain = mail.trim().toLowerCase().split("@")[1] ?? "";
  return PORTAL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

const GRUSS = /(mit\s+)?(freundlichen|besten|herzlichen|lieben)\s+gr(ü|ue)(ß|ss)(en|e)|^\s*(liebe|viele)\s+gr(ü|ue)(ß|ss)e/im;

/**
 * Raeumt ein Anschreiben auf: Backtick-Reste weg, ueberzaehlige Leerzeilen
 * weg, und eine Grussformel vor dem Namen, falls das Modell sie vergessen
 * hat. Veraendert sonst kein einziges Wort.
 */
export function briefAufraeumen(text: string, name: string): string {
  let t = text
    .replace(/`{3,}[a-z]*/gi, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (name && !GRUSS.test(t)) {
    const zeilen = t.split("\n");
    const letzte = zeilen[zeilen.length - 1]?.trim() ?? "";
    if (letzte === name.trim()) {
      zeilen.splice(zeilen.length - 1, 0, "Mit freundlichen Grüßen");
      t = zeilen.join("\n").replace(/\n{3,}Mit freundlichen/, "\n\nMit freundlichen");
    } else {
      t = `${t}\n\nMit freundlichen Grüßen\n${name.trim()}`;
    }
  }
  return t;
}
