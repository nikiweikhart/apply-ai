/**
 * Der Browser - das Herzstueck von Apply AI.
 *
 * Hier wird ein echter Chrome gestartet, der die Jobportale genauso besucht
 * wie ein Mensch. Mit HEADFUL=1 in der .env sieht man ihm dabei zu.
 *
 * Zwei Grundsaetze stecken fest im Code:
 *   1. Hoeflich sein - zwischen zwei Seitenaufrufen wird gewartet, nie im
 *      Sekundentakt geklickt.
 *   2. Nicht durchbrechen - erkennt der Browser eine Sperre oder ein CAPTCHA,
 *      bricht er ab und meldet sich. Er versucht nichts zu umgehen.
 */
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "./env.ts";

/** Wird geworfen, wenn ein Portal dichtmacht. Der Scout hoert damit auf. */
export class BlockadeFehler extends Error {
  portal: string;
  constructor(portal: string, message: string) {
    super(message);
    this.name = "BlockadeFehler";
    this.portal = portal;
  }
}

/** Wird geworfen, wenn die Seite anders aussieht als erwartet (Umbau). */
export class AdapterFehler extends Error {
  portal: string;
  constructor(portal: string, message: string) {
    super(message);
    this.name = "AdapterFehler";
    this.portal = portal;
  }
}

// fileURLToPath statt .pathname: im Pfad steht "Claude Code Projekte" mit
// Leerzeichen, und .pathname liefert daraus "Claude%20Code%20Projekte".
const SCREENSHOT_ORDNER = fileURLToPath(new URL("../../screenshots/", import.meta.url));
const AUTH_ORDNER = fileURLToPath(new URL("../../.auth/", import.meta.url));

/**
 * Ordner mit dem dauerhaften Chrome-Profil eines Portals. Entsteht durch
 * `npm run anmelden <portal>` und liegt in `.gitignore` - wer diesen Ordner
 * hat, ist auf dem Portal eingeloggt, genauso sensibel wie ein Passwort.
 */
export function profilPfad(portalId: string): string {
  return `${AUTH_ORDNER}profil-${portalId}`;
}

/** Ob fuer dieses Portal schon ein Profil mit gespeicherter Anmeldung existiert. */
export function eingeloggtBei(portalId: string): boolean {
  return existsSync(profilPfad(portalId));
}

/** Zufaellige Pause in Millisekunden - damit die Abstaende nicht maschinell gleich sind. */
export function warte(vonMs = 1500, bisMs = 3500): Promise<void> {
  const ms = vonMs + Math.random() * (bisMs - vonMs);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Startet den Browser. Rueckgabe enthaelt alles, was ein Adapter braucht,
 * plus ein `schliessen`, das am Ende immer aufgerufen werden muss.
 */
export async function browserStarten(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  schliessen: () => Promise<void>;
}> {
  const browser = await chromium.launch({
    headless: !env.headful,
    // Langsamer klicken, wenn man zuschaut - sonst ist es nur ein Flackern.
    slowMo: env.headful ? 250 : 0,
  });

  const context = await browser.newContext({
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
    viewport: { width: 1366, height: 900 },
    // Ohne das steht "HeadlessChrome" in der Kennung und manche Seiten
    // liefern dann eine kaputte Fassung aus. Wir geben uns als normaler
    // Chrome aus - mehr nicht, es wird keine Sperre umgangen.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    schliessen: async () => {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/**
 * Startet ECHTES, lokal installiertes Chrome (nicht die Playwright-Testfassung
 * "Chrome for Testing") mit einem eigenen, dauerhaften Profil pro Portal.
 *
 * Grund: hokify, willhaben und karriere.at laufen bei Niki ueber "Mit Google
 * anmelden" - und Google lehnt eine Anmeldung aus der Playwright-Testfassung
 * ausdruecklich als unsicher ab ("Dieser Browser oder diese App ist unter
 * Umstaenden nicht sicher"), erprobt am 2026-09-13. Das ist Googles eigene
 * Bot-Sperre - die wird hier nicht umgangen, sondern schlicht der Browser
 * benutzt, den Niki sowieso hat.
 *
 * Ein dauerhaftes Profil (statt `storageState`) merkt sich die Anmeldung
 * zwischen Aufrufen von selbst - `npm run anmelden <portal>` legt es einmal
 * an, jeder spaetere Aufruf mit derselben `portalId` ist automatisch noch
 * eingeloggt, solange die Sitzung nicht abgelaufen ist.
 *
 * Braucht ein installiertes Chrome auf dem Rechner. Fehlt es, meldet
 * Playwright das mit einem klaren Hinweis zum Nachinstallieren.
 */
export async function browserMitProfilStarten(
  portalId: string,
  optionen?: { headfulErzwingen?: boolean },
): Promise<{ context: BrowserContext; page: Page; schliessen: () => Promise<void> }> {
  const ordner = profilPfad(portalId);
  mkdirSync(ordner, { recursive: true });
  const sichtbar = optionen?.headfulErzwingen || env.headful;

  const context = await chromium.launchPersistentContext(ordner, {
    channel: "chrome",
    headless: !sichtbar,
    slowMo: sichtbar ? 250 : 0,
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
    viewport: { width: 1366, height: 900 },
  });
  context.setDefaultTimeout(20_000);
  context.setDefaultNavigationTimeout(45_000);

  const page = context.pages()[0] ?? (await context.newPage());

  return {
    context,
    page,
    schliessen: async () => {
      await context.close().catch(() => {});
    },
  };
}

/**
 * Seite aufrufen und dabei pruefen, ob wir ueberhaupt willkommen sind.
 * Wirft BlockadeFehler bei 403/429 oder wenn die Seite nach Sperre riecht.
 */
export async function seiteOeffnen(page: Page, url: string, portal: string): Promise<void> {
  const antwort = await page.goto(url, { waitUntil: "domcontentloaded" });
  const status = antwort?.status() ?? 0;

  if (status === 403 || status === 429) {
    throw new BlockadeFehler(portal, `Portal antwortet mit Code ${status} (Zugriff verweigert).`);
  }
  await blockadePruefen(page, portal);

  if (env.schritteFotografieren) {
    // Kurz warten, sonst ist das Bild weiss: nach "domcontentloaded" steht
    // der Text zwar im Speicher, gezeichnet ist die Seite aber noch nicht.
    await page.waitForLoadState("load").catch(() => {});
    await warte(700, 1000);
    schrittZaehler++;
    await screenshot(page, `${portal}-schritt-${String(schrittZaehler).padStart(2, "0")}`);
  }
}

/** Laufende Nummer fuer die Schritt-Fotos, damit die Reihenfolge stimmt. */
let schrittZaehler = 0;

const SPERR_WOERTER = [
  "captcha",
  "sind sie ein mensch",
  "are you a human",
  "unusual traffic",
  "ungewoehnliche aktivit",
  "zugriff verweigert",
  "access denied",
  "bot detected",
];

/** Schaut in den sichtbaren Text, ob dort eine Sperre steht. */
export async function blockadePruefen(page: Page, portal: string): Promise<void> {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase().slice(0, 4000);
  const treffer = SPERR_WOERTER.find((w) => text.includes(w));
  if (treffer) {
    await screenshot(page, `${portal}-blockade`);
    throw new BlockadeFehler(portal, `Seite spricht von "${treffer}" - vermutlich eine Bot-Sperre.`);
  }
}

/**
 * Cookie-Banner wegklicken - und zwar mit der datensparsamsten Antwort.
 * Findet sich kein Banner, passiert einfach nichts.
 */
export async function cookiesAblehnen(page: Page): Promise<boolean> {
  // Der Banner erscheint oft erst kurz nach dem Seitenaufbau - sonst suchen
  // wir nach etwas, das es noch gar nicht gibt.
  await warte(800, 1400);

  // Didomi ist die haeufigste Banner-Software in Oesterreich und hat eine
  // feste Kennung. Wenn die da ist, geht es ohne Textsuche.
  const didomi = page.locator("#didomi-notice-disagree-button");
  if (await didomi.isVisible({ timeout: 1500 }).catch(() => false)) {
    await didomi.click().catch(() => {});
    await warte(400, 900);
    return true;
  }

  const knoepfe = [
    /nur (technisch )?notwendige/i,
    /alle ablehnen/i,
    /ablehnen und schlie(ss|ß)en/i,   // willhaben
    /nicht einverstanden/i,           // AMS
    /^ablehnen$/i,
    /reject all/i,
    /nicht akzeptieren/i,
  ];
  for (const muster of knoepfe) {
    const knopf = page.getByRole("button", { name: muster }).first();
    if (await knopf.isVisible({ timeout: 1200 }).catch(() => false)) {
      await knopf.click().catch(() => {});
      await warte(400, 900);
      return true;
    }
  }
  return false;
}

/** Bildschirmfoto in engine/screenshots/ - liegt im .gitignore. */
export async function screenshot(page: Page, name: string): Promise<string | undefined> {
  try {
    mkdirSync(SCREENSHOT_ORDNER, { recursive: true });
    const stempel = new Date().toISOString().replace(/[:.]/g, "-");
    const pfad = `${SCREENSHOT_ORDNER}${name}-${stempel}.png`;
    await page.screenshot({ path: pfad, fullPage: false });
    return pfad;
  } catch {
    return undefined;
  }
}
