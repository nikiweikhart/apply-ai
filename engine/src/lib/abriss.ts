/**
 * Der Abriss - eine kurze, sachliche Beschreibung einer fremden Seite.
 *
 * Eine Trefferliste hat schnell 800.000 Zeichen Quelltext. Den kann man
 * Claude nicht vorlegen: es waere langsam, teuer und die Antwort waere
 * schlechter, weil das Wesentliche in Gestaltungscode ertrinkt.
 *
 * Deshalb wird hier im Browser selbst zusammengefasst, woran man sich auf
 * einer Seite festhalten kann:
 *
 *   - welche Links nach einzelnen Stellenanzeigen aussehen
 *   - welche Kaesten sich wiederholen und dabei je genau eine Anzeige
 *     umschliessen (das sind die Trefferkacheln)
 *   - welche Kennzeichnungen (data-testid, data-cy) es gibt
 *
 * Heraus kommen rund 2.000 Zeichen - ein Bruchteil eines Cents pro Aufruf.
 *
 * Diese Datei denkt nicht, sie zaehlt nur. Die Entscheidung, welcher der
 * Vorschlaege der richtige ist, faellt in `agents/explorer.ts`.
 */
import type { Page } from "playwright";

/** Ein Kasten, der als Trefferkachel infrage kommt. */
export type Kandidat = {
  /** Fertiger CSS-Ausdruck, so wie er spaeter benutzt wird. */
  auswahl: string;
  /** Wie oft er auf der Seite vorkommt. */
  anzahl: number;
  /** Wie viele davon genau eine Anzeige umschliessen. Je hoeher, desto besser. */
  mitAnzeige: number;
  /** Anfang des sichtbaren Textes im ersten Treffer - zum Gegenlesen. */
  probe: string;
};

export type Abriss = {
  url: string;
  titel: string;
  ueberschrift: string;
  /** Adressmuster der Anzeigenlinks, Ziffern durch # ersetzt. */
  linkMuster: { muster: string; anzahl: number; beispiel: string; text: string }[];
  kandidaten: Kandidat[];
  kennzeichen: { name: string; anzahl: number }[];
};

/**
 * Liest den Abriss aus der offenen Seite.
 *
 * Alles Zaehlen passiert in einem einzigen `evaluate` - jeder Sprung zwischen
 * Node und Browser kostet Zeit, und hier waeren es sonst hunderte.
 */
export async function abrissLesen(page: Page): Promise<Abriss> {
  const roh = await page.evaluate(() => {
    // ---- Was sieht nach einer Stellenanzeige aus?
    const ANZEIGE = /(^|\/)(job|jobs|stelle|stellen|stellenangebote|position|anzeige|viewjob|offer)([\/?#]|$)/i;
    const alleLinks = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
    const anzeigenLinks = alleLinks.filter((a) => {
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return false;
      return ANZEIGE.test(href);
    });

    // ---- Adressmuster: "/job/#" statt 40x derselben Sache mit anderer Nummer
    const musterZaehler: Record<string, { anzahl: number; beispiel: string; text: string }> = {};
    for (const a of anzeigenLinks) {
      const href = a.getAttribute("href") ?? "";
      const muster = href
        .replace(/[?#].*$/, "")
        .replace(/\d+/g, "#")
        .replace(/\/[^/]{30,}/g, "/...");
      const e = (musterZaehler[muster] ??= {
        anzahl: 0,
        beispiel: href.slice(0, 120),
        text: (a.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
      });
      e.anzahl++;
    }

    // ---- Kennzeichnungen, die ein Adapter benutzen koennte
    const kennzeichenZaehler: Record<string, number> = {};
    for (const el of Array.from(document.querySelectorAll("[data-testid],[data-cy]"))) {
      const k = el.getAttribute("data-testid") ?? el.getAttribute("data-cy") ?? "";
      const muster = k.replace(/\d+/g, "#");
      if (muster) kennzeichenZaehler[muster] = (kennzeichenZaehler[muster] ?? 0) + 1;
    }

    // ---- Kachelsuche: von jedem Anzeigenlink nach oben gehen und aufschreiben,
    //      an welchen Kaesten man vorbeikommt. Ein Kasten, an dem viele
    //      verschiedene Anzeigen vorbeikommen, ist die gesuchte Kachel.
    const HASH = /\d/; // Klassen mit Ziffern sind meist maschinell erzeugt (css-1a2b3c)
    function auswahlAusdruecke(el: Element): string[] {
      const raus: string[] = [];
      const testid = el.getAttribute("data-testid");
      const cy = el.getAttribute("data-cy");
      if (testid && !HASH.test(testid)) raus.push(`[data-testid="${testid}"]`);
      if (cy && !HASH.test(cy)) raus.push(`[data-cy="${cy}"]`);
      const tag = el.tagName.toLowerCase();
      const klassen = (typeof el.className === "string" ? el.className : "")
        .trim()
        .split(/\s+/)
        .filter((c) => c.length >= 3 && c.length <= 40 && !HASH.test(c));
      for (const k of klassen.slice(0, 4)) raus.push(`${tag}.${CSS.escape(k)}`);
      return raus;
    }

    const treffer: Record<string, number> = {};
    for (const a of anzeigenLinks) {
      const gesehen = new Set<string>();
      let el: Element | null = a.parentElement;
      for (let stufe = 0; stufe < 5 && el && el.tagName !== "BODY"; stufe++) {
        for (const ausdruck of auswahlAusdruecke(el)) {
          if (gesehen.has(ausdruck)) continue;
          gesehen.add(ausdruck);
          treffer[ausdruck] = (treffer[ausdruck] ?? 0) + 1;
        }
        el = el.parentElement;
      }
    }

    const kandidaten = Object.entries(treffer)
      .map(([auswahl, mitAnzeige]) => {
        let knoten: Element[] = [];
        try {
          knoten = Array.from(document.querySelectorAll(auswahl));
        } catch {
          return null;
        }
        const erster = knoten[0];
        return {
          auswahl,
          anzahl: knoten.length,
          mitAnzeige,
          probe: ((erster as HTMLElement | undefined)?.innerText ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 140),
        };
      })
      .filter((k): k is Kandidat => k !== null && k.anzahl >= 2)
      // Der beste Kandidat umschliesst moeglichst viele Anzeigen und ist dabei
      // moeglichst wenig groesser als noetig - ein <body> umschliesst auch alle.
      .sort((a, b) => b.mitAnzeige - a.mitAnzeige || a.anzahl - b.anzahl)
      .slice(0, 10);

    return {
      url: location.href,
      titel: document.title,
      ueberschrift: (document.querySelector("h1") as HTMLElement | null)?.innerText?.trim() ?? "",
      linkMuster: Object.entries(musterZaehler)
        .sort((a, b) => b[1].anzahl - a[1].anzahl)
        .slice(0, 10)
        .map(([muster, e]) => ({ muster, ...e })),
      kandidaten,
      kennzeichen: Object.entries(kennzeichenZaehler)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([name, anzahl]) => ({ name, anzahl })),
    };
  });

  return roh as Abriss;
}

/** Schreibt den Abriss so auf, wie Claude ihn vorgelegt bekommt. */
export function abrissAlsText(a: Abriss): string {
  const zeilen: string[] = [
    `Adresse: ${a.url}`,
    `Seitentitel: ${a.titel}`,
    `Ueberschrift: ${a.ueberschrift || "(keine)"}`,
    "",
    "Adressmuster der Links, die nach Stellenanzeigen aussehen:",
  ];

  if (a.linkMuster.length === 0) zeilen.push("  (keine gefunden)");
  for (const l of a.linkMuster) {
    zeilen.push(`  ${String(l.anzahl).padStart(3)}x  ${l.muster}`);
    zeilen.push(`        Beispiel: ${l.beispiel}   Linktext: "${l.text}"`);
  }

  zeilen.push("", "Kaesten, die als Trefferkachel infrage kommen:");
  if (a.kandidaten.length === 0) zeilen.push("  (keine gefunden)");
  for (const k of a.kandidaten) {
    zeilen.push(
      `  ${k.auswahl}  -  ${k.anzahl}x auf der Seite, davon ${k.mitAnzeige} mit Anzeigenlink`,
    );
    if (k.probe) zeilen.push(`        Text darin: "${k.probe}"`);
  }

  zeilen.push("", "Vorhandene Kennzeichnungen (data-testid / data-cy):");
  if (a.kennzeichen.length === 0) zeilen.push("  (keine)");
  for (const k of a.kennzeichen) zeilen.push(`  ${String(k.anzahl).padStart(3)}x  ${k.name}`);

  return zeilen.join("\n");
}
