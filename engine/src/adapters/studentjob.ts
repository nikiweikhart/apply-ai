/**
 * StudentJob.at - Portal Nummer drei (AMS wurde übersprungen).
 *
 * Das einfachste Portal von allen, und inhaltlich das am besten passende:
 * es hat fertige Kategorieseiten wie `/samstagsjob/wien`, auf denen von
 * vornherein nur steht, was Niki sucht. Kein Filter-Gebastel nötig.
 *
 * Dafür gibt es kaum Struktur zum Festhalten: keine `data-testid`, keine
 * Firmenangabe auf der Anzeige. Was hier zählt, ist der Anzeigentext - und
 * den bekommt die Bewertung ohnehin vollständig.
 *
 * Geprüfte Anhaltspunkte (Stand 2026-08-25):
 *   Kategorieseite  /samstagsjob/wien, Blättern über /samstagsjob/wien/2
 *   Anzeigenlink    a[href^="/stellenangebote/<nummer>-<name>"]
 *   Cookie-Banner   Knopf "ALLE ABLEHNEN"
 *   Titel           h1
 *   Stundenzahl     im Text, Form "32 Arbeitsstunden pro Woche"
 */
import type { Page } from "playwright";
import type { Adapter, AdapterKontext, RohJob } from "./typen.ts";
import { AdapterFehler, blockadePruefen, cookiesAblehnen, seiteOeffnen, warte } from "../lib/browser.ts";
import { mailAusSeite, textAufraeumen } from "./hilfen.ts";

const BASIS = "https://www.studentjob.at";

/** Kategorien, falls in der Portal-Einstellung keine stehen. */
// "wochenendjob" gibt es bei StudentJob nicht - am 2026-08-25 geprueft.
const STANDARD_KATEGORIEN = ["samstagsjob", "nebenjob", "ferialjob"];

type Kachel = { externalId: string; url: string; title: string };

/** Die Adresse einer Kategorieseite - StudentJob braucht keine Suchparameter. */
function sucheUrl(kategorie: string, ort: string, seite: number): string {
  return `${BASIS}/${kategorie}/${ort}${seite > 1 ? `/${seite}` : ""}`;
}

export const studentjob: Adapter = {
  id: "studentjob",

  suchadressen(portal) {
    const ort = (portal.filters.ort ?? "Wien").toLowerCase();
    const kategorien =
      (portal.filters as { kategorien?: string[] }).kategorien ?? STANDARD_KATEGORIEN;
    return kategorien.map((k) => sucheUrl(k, ort, 1));
  },

  async suchen(ctx: AdapterKontext): Promise<RohJob[]> {
    const ort = (ctx.portal.filters.ort ?? "Wien").toLowerCase();
    const kategorien =
      (ctx.portal.filters as { kategorien?: string[] }).kategorien ?? STANDARD_KATEGORIEN;

    const gesammelt = new Map<string, Kachel>();
    let kategorienOk = 0;
    for (const kategorie of kategorien) {
      // Eine Kategorie, die es nicht (mehr) gibt, darf nicht das ganze Portal
      // lahmlegen - StudentJob hat z.B. kein "/wochenendjob".
      try {
        for (const k of await trefferlisteLesen(ctx, kategorie, ort)) {
          if (!gesammelt.has(k.externalId)) gesammelt.set(k.externalId, k);
        }
        kategorienOk++;
      } catch (e) {
        await ctx.melde(`Kategorie "${kategorie}" uebersprungen: ${(e as Error).message}`);
      }
      await warte();
    }
    if (kategorienOk === 0) {
      throw new AdapterFehler(
        "studentjob",
        `Keine einzige Kategorie hat funktioniert (${kategorien.join(", ")}).`,
      );
    }

    const alle = [...gesammelt.values()];
    const neue = alle.filter((k) => ctx.istNeu(k.externalId)).slice(0, ctx.maxNeueJobs);
    await ctx.melde(
      `${alle.length} Treffer insgesamt, davon ${neue.length} neu - die werden jetzt aufgemacht.`,
    );

    const jobs: RohJob[] = [];
    for (const [i, kachel] of neue.entries()) {
      try {
        jobs.push(await detailLesen(ctx.page, kachel, ort));
        await ctx.melde(`  ${i + 1}/${neue.length}  ${kachel.title.slice(0, 60)}`);
      } catch (e) {
        await ctx.melde(`  ${i + 1}/${neue.length}  uebersprungen: ${(e as Error).message}`);
      }
      await warte();
    }
    return jobs;
  },
};

async function trefferlisteLesen(
  ctx: AdapterKontext,
  kategorie: string,
  ort: string,
): Promise<Kachel[]> {
  const { page } = ctx;
  const links = 'a[href^="/stellenangebote/"]';
  const ergebnis = new Map<string, Kachel>();

  for (let seite = 1; seite <= 3; seite++) {
    const url = sucheUrl(kategorie, ort, seite);
    const antwortOk = await seiteOeffnen(page, url, "studentjob")
      .then(() => true)
      .catch((e) => {
        if (seite === 1) throw e;
        return false;
      });
    if (!antwortOk) break;

    if (seite === 1) await cookiesAblehnen(page);

    const ueberschrift = (await page.locator("h1").first().innerText().catch(() => "")).trim();
    if (seite === 1) {
      if (!(await page.locator(links).first().isVisible({ timeout: 8000 }).catch(() => false))) {
        throw new AdapterFehler(
          "studentjob",
          `Keine Anzeigenlinks auf ${url} - Kategorie geändert oder Seite umgebaut.`,
        );
      }
      await ctx.melde(`Kategorie "${kategorie}" in ${ort}: ${ueberschrift || "Liste offen"}`);
      await blockadePruefen(page, "studentjob");
    }

    const treffer = await page.locator(links).evaluateAll((knoten) =>
      knoten.map((a) => ({
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").trim(),
      })),
    );

    const vorher = ergebnis.size;
    for (const t of treffer) {
      const id = t.href.match(/\/stellenangebote\/(\d+)-/)?.[1];
      if (!id) continue;
      // Links auf das Bewerbungsformular derselben Anzeige mitzunehmen
      // waere doppelt gemoppelt.
      if (/\/bewerbungen\//.test(t.href)) continue;
      const vorhanden = ergebnis.get(id);
      if (!vorhanden || t.text.length > vorhanden.title.length) {
        ergebnis.set(id, { externalId: id, url: `${BASIS}${t.href}`, title: t.text });
      }
    }

    if (ergebnis.size === vorher) break;
    if (ergebnis.size >= ctx.maxNeueJobs * 2) break;
    await warte(1200, 2200);
  }

  return [...ergebnis.values()];
}

async function detailLesen(page: Page, kachel: Kachel, ort: string): Promise<RohJob> {
  await seiteOeffnen(page, kachel.url, "studentjob");

  const titel =
    (await page.locator("h1").first().innerText().catch(() => "")).trim() || kachel.title;

  const text = (await page.locator("body").first().innerText().catch(() => "")).trim();
  if (!text) {
    throw new AdapterFehler("studentjob", `Anzeige ${kachel.url} hat keinen lesbaren Text.`);
  }

  // StudentJob nennt keine Firma auf der Anzeige und keinen genauen Ort -
  // die Kategorieseite ist bereits nach Stadt sortiert, also nehmen wir die.
  const stunden = text.match(/(\d+)\s*Arbeitsstunden\s*pro\s*Woche/i)?.[1];

  return {
    externalId: kachel.externalId,
    url: kachel.url,
    title: titel,
    company: undefined,
    location: ort.charAt(0).toUpperCase() + ort.slice(1),
    employment: stunden ? `${stunden} Stunden pro Woche` : undefined,
    description: textAufraeumen(text, "LOGIN"),
    contactEmail: await mailAusSeite(page, "body"),
    postedAt: undefined,
  };
}
