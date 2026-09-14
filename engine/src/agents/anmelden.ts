/**
 * anmelden - oeffnet ein ganz normales, NICHT automatisiertes Chrome-Fenster
 * zum Einloggen, damit apply-browser die dabei entstehende Sitzung spaeter
 * wiederverwenden kann.
 *
 * Hokify, willhaben und karriere.at verlangen fuer die Bewerbung ein eigenes
 * Konto - bei Niki laeuft die Anmeldung dort ueber "Mit Google anmelden", es
 * gibt also gar kein eigenes Passwort, das in der .env stehen koennte.
 *
 * Zwei Versuche sind am 2026-09-13 gescheitert, beide aus demselben Grund:
 *   1. Playwrights eigene Chrome-Testfassung ("Chrome for Testing") -
 *      Google lehnt das sofort ab: "Dieser Browser oder diese App ist unter
 *      Umstaenden nicht sicher".
 *   2. Echtes, lokal installiertes Chrome, aber ueber Playwright gestartet
 *      (`channel: "chrome"`) - dieselbe Ablehnung, weil Chrome dabei per
 *      CDP (Ferngesteuert-Protokoll) laeuft und im Fenster sogar ausdruecklich
 *      vor dem Flag "--no-sandbox" warnt. Google blockiert die Anmeldung bei
 *      JEDEM ferngesteuerten Browser, unabhaengig davon, welches Chrome es
 *      im Hintergrund ist - das ist Googles eigene Bot-Sperre gegen genau
 *      diese Art von Automatisierung.
 *
 * Diese beiden Wege werden hier bewusst NICHT weiterverfolgt - das waere
 * genau die Sorte Sperre, an die sich dieses Projekt nirgends herantraut
 * (siehe `lib/browser.ts`: "nicht durchbrechen, wenn eine Seite eine Sperre
 * zeigt").
 *
 * Der Weg, der bleibt: ein KOMPLETT NORMALER Chrome-Prozess, gestartet wie
 * ein Doppelklick auf die Chrome-Verknuepfung - nur mit einem eigenen
 * Profil-Ordner (`--user-data-dir`), damit die Sitzung hinterher wiederfindbar
 * ist. Kein Playwright, kein CDP, keine Fernsteuerung - Google sieht einen
 * Nutzer wie jeden anderen. Niki loggt sich darin komplett selbst ein -
 * Google, Passwort, Zwei-Faktor, alles wie gewohnt. Apply AI sieht dabei
 * nichts von seinem Passwort.
 *
 * Der Profil-Ordner (`engine/.auth/profil-<portal>/`, `.gitignore`, niemals
 * einchecken - so sensibel wie ein Passwort) merkt sich die Anmeldung von
 * selbst. `apply-browser.ts` startet spaeter Playwright MIT genau diesem
 * Ordner (`browserMitProfilStarten`), aber nur gegen die Portal-Seiten
 * selbst, nie gegen Googles Login-Seite - deshalb greift die Sperre dort
 * nicht mehr.
 *
 * Starten mit:
 *   npm run anmelden hokify
 *   npm run anmelden willhaben
 *   npm run anmelden karriere
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { profilPfad } from "../lib/browser.ts";

const START_URL: Record<string, string> = {
  hokify: "https://hokify.at/",
  willhaben: "https://www.willhaben.at/jobs/",
  karriere: "https://www.karriere.at/",
};

const CHROME_PFADE = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];

const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const portal = argv.find((a) => a in START_URL);

if (!portal) {
  console.error(
    `Aufruf:  npm run anmelden <portal>\n` + `Bekannte Portale: ${Object.keys(START_URL).join(", ")}`,
  );
  process.exit(1);
}
const PORTAL: string = portal;

const chromePfad = CHROME_PFADE.find((p) => existsSync(p));
if (!chromePfad) {
  console.error(
    "X  [anmelden] Kein installiertes Chrome gefunden (gesucht unter Program Files).\n" +
      "        -> Chrome installieren: google.com/chrome",
  );
  process.exit(1);
}

const ordner = profilPfad(PORTAL);

console.log(
  `\nApply AI - Anmelden bei ${PORTAL}\n${"=".repeat(60)}\n` +
    `Ein ganz normales Chrome-Fenster oeffnet sich jetzt - EIN EIGENES Profil,\n` +
    `nur fuer Apply AI, komplett getrennt von deinem sonstigen Chrome. So geht's:\n\n` +
    `  1. Oben rechts "Anmelden" bzw. "Login" anklicken.\n` +
    `  2. "Mit Google anmelden" waehlen und wie gewohnt einloggen.\n` +
    `  3. Warten, bis du wieder auf der Portalseite bist, jetzt eingeloggt\n` +
    `     (dein Name oder Profilbild steht dann oben).\n` +
    `  4. Das Fenster danach wieder SCHLIESSEN und mir kurz Bescheid geben -\n` +
    `     erst dann kann ich pruefen, ob's geklappt hat (Chrome laesst ein\n` +
    `     Profil immer nur von einem Fenster gleichzeitig benutzen).\n`,
);

const kind = spawn(
  chromePfad,
  [`--user-data-dir=${ordner}`, "--no-first-run", "--no-default-browser-check", START_URL[PORTAL]!],
  { detached: true, stdio: "ignore" },
);
kind.unref();

console.log("Chrome-Fenster gestartet. Sag Bescheid, wenn du fertig bist und es geschlossen hast.\n");
process.exit(0);
