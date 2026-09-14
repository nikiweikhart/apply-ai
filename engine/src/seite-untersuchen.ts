/**
 * Werkzeug zum Bauen neuer Portal-Adapter.
 *
 * Öffnet eine Seite mit genau dem Browser, den der Scout später benutzt, und
 * schreibt auf, woran man sich festhalten kann: Überschrift, Anzahl der
 * Treffer, verwertbare Kennzeichnungen (data-testid, data-cy), Links, die nach
 * Stellenanzeigen aussehen, und die auffälligsten wiederholten Kacheln.
 *
 * Warum nicht einfach im normalen Browser nachschauen: weil dort andere Dinge
 * stehen können als in unserem. Cookie-Banner, Anmeldezwang, andere Fassung
 * der Seite für Automatisierung - all das sieht man nur, wenn man mit dem
 * echten Werkzeug hinschaut.
 *
 * Starten mit:
 *   npm run untersuchen "https://www.willhaben.at/jobs/suche?location=Wien"
 *   npm run untersuchen "<adresse>" text     zusätzlich den Seitentext
 */
import { browserStarten, cookiesAblehnen, screenshot, warte } from "./lib/browser.ts";

const argv = process.argv.slice(2);
const url = argv.find((a) => a.startsWith("http"));
const mitText = argv.includes("text");

if (!url) {
  console.error('Aufruf:  npm run untersuchen "https://..."');
  process.exit(1);
}

const { page, schliessen } = await browserStarten();

try {
  const antwort = await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log(`\nAntwort-Code: ${antwort?.status()}`);

  const abgelehnt = await cookiesAblehnen(page);
  console.log(`Cookie-Banner: ${abgelehnt ? "gefunden und abgelehnt" : "keines gefunden"}`);
  await warte(1500, 2500);

  console.log(`Adresse:      ${page.url()}`);
  console.log(`Titel:        ${await page.title()}`);
  console.log(
    `Überschrift:  ${(await page.locator("h1").first().innerText().catch(() => "-")).trim()}`,
  );

  // Welche Kennzeichnungen gibt es? Die sind stabiler als Gestaltungs-Klassen.
  const kennzeichen = await page.evaluate(() => {
    const zaehler: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll("[data-testid],[data-cy]"))) {
      const k = el.getAttribute("data-testid") ?? el.getAttribute("data-cy") ?? "";
      // Laufende Nummern zusammenfassen: "job-3" und "job-4" sind dasselbe Muster.
      const muster = k.replace(/\d+/g, "#");
      zaehler[muster] = (zaehler[muster] ?? 0) + 1;
    }
    return Object.entries(zaehler)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
  });
  console.log("\nKennzeichnungen (data-testid / data-cy), häufigste zuerst:");
  for (const [name, anzahl] of kennzeichen) console.log(`  ${String(anzahl).padStart(4)}x  ${name}`);

  // Links, die nach einzelnen Stellenanzeigen aussehen.
  const links = await page.evaluate(() => {
    const alle = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => /job|stelle|position|anzeige|iad/i.test(h));
    const muster: Record<string, string[]> = {};
    for (const h of alle) {
      const m = h.replace(/\d+/g, "#").replace(/\/[^/]{25,}/g, "/...");
      (muster[m] ??= []).push(h);
    }
    return Object.entries(muster)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([m, hs]) => ({ muster: m, anzahl: hs.length, beispiel: hs[0] }));
  });
  console.log("\nLinks, die nach Anzeigen aussehen:");
  for (const l of links) {
    console.log(`  ${String(l.anzahl).padStart(4)}x  ${l.muster}`);
    console.log(`          Beispiel: ${l.beispiel}`);
  }

  if (mitText) {
    const text = await page.locator("body").innerText();
    console.log(`\nSeitentext (erste 2500 Zeichen):\n${"-".repeat(60)}`);
    console.log(text.replace(/\n{3,}/g, "\n\n").slice(0, 2500));
  }

  const bild = await screenshot(page, "untersuchung");
  console.log(`\nBildschirmfoto: ${bild}\n`);
} finally {
  await schliessen();
}
