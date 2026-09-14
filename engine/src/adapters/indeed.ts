/**
 * Indeed AT - das letzte und heikelste Portal.
 *
 * Der Bauplan rechnete damit, dass Indeed Automatisierung hart blockt. Am
 * 2026-08-25 war das nicht so: die Trefferliste kam mit Code 200, kein CAPTCHA,
 * kein Rauswurf. Aber es gibt eine echte Hürde:
 *
 *   **Die Detailseite `/viewjob?jk=...` antwortet mit 401 und schickt einen
 *   auf die Anmeldeseite.** Ohne Konto kein Anzeigentext.
 *
 * Apply AI legt keine Konten an. Der Weg drumherum ist keiner: Indeed zeigt
 * denselben Text auch in der Seitenansicht **der Trefferliste**, wenn man eine
 * Anzeige auswählt - dieselbe Seite, die auch ein Mensch ohne Anmeldung sieht.
 * Genau die liest der Adapter, über den Parameter `vjk`.
 *
 * Gespeichert wird trotzdem die `/viewjob`-Adresse: das ist der Link, den ein
 * Mensch aufmacht, und mit Nikis eigener Anmeldung funktioniert er.
 *
 * Weil Indeed empfindlicher ist als die anderen vier, wartet dieser Adapter
 * deutlich länger zwischen den Aufrufen.
 *
 * Geprüfte Anhaltspunkte (Stand 2026-08-25):
 *   Suchseite     at.indeed.com/jobs?q=<wort>&l=<ort>, Blättern über &start=10
 *   Trefferkachel [data-testid="slider_item"]
 *   Job-Nummer    jk=<16 Zeichen> im Kachel-Link
 *   Seitenansicht ?...&vjk=<nummer> öffnet die Anzeige rechts daneben
 *     Text        #jobDescriptionText
 *     Firma       [data-testid="inlineHeader-companyName"]
 *     Ort         [data-testid="inlineHeader-companyLocation"]
 */
import type { Page } from "playwright";
import type { Adapter, AdapterKontext, RohJob } from "./typen.ts";
import { AdapterFehler, blockadePruefen, cookiesAblehnen, seiteOeffnen, warte } from "../lib/browser.ts";
import { mailAusSeite } from "./hilfen.ts";

const BASIS = "https://at.indeed.com";

/** Suchworte, falls in der Portal-Einstellung keine stehen. */
const STANDARD_SUCHWORTE = ["geringfügig", "Samstag Aushilfe"];

/** Indeed ist empfindlicher als die anderen Portale - langsamer machen. */
const PAUSE_VON = 3000;
const PAUSE_BIS = 6000;

type Kachel = {
  externalId: string;
  url: string;
  title: string;
  company?: string;
  location?: string;
  suchUrl: string;
};

export const indeed: Adapter = {
  id: "indeed",

  suchadressen(portal) {
    const ort = portal.filters.ort ?? "Wien";
    const suchworte = (portal.filters as { suchworte?: string[] }).suchworte ?? STANDARD_SUCHWORTE;
    return suchworte.map((w) => sucheUrl(w, ort, 0));
  },

  async suchen(ctx: AdapterKontext): Promise<RohJob[]> {
    const ort = ctx.portal.filters.ort ?? "Wien";
    const suchworte =
      (ctx.portal.filters as { suchworte?: string[] }).suchworte ?? STANDARD_SUCHWORTE;

    const gesammelt = new Map<string, Kachel>();
    let suchenOk = 0;
    for (const wort of suchworte) {
      try {
        for (const k of await trefferlisteLesen(ctx, wort, ort)) {
          if (!gesammelt.has(k.externalId)) gesammelt.set(k.externalId, k);
        }
        suchenOk++;
      } catch (e) {
        // Eine Blockade betrifft das ganze Portal - die nicht verschlucken.
        if ((e as Error).name === "BlockadeFehler") throw e;
        await ctx.melde(`Suchwort "${wort}" uebersprungen: ${(e as Error).message}`);
      }
      await warte(PAUSE_VON, PAUSE_BIS);
    }
    if (suchenOk === 0) throw new AdapterFehler("indeed", "Keines der Suchworte hat funktioniert.");

    const alle = [...gesammelt.values()];
    const neue = alle.filter((k) => ctx.istNeu(k.externalId)).slice(0, ctx.maxNeueJobs);
    await ctx.melde(
      `${alle.length} Treffer insgesamt, davon ${neue.length} neu - die werden jetzt aufgemacht.`,
    );

    const jobs: RohJob[] = [];
    for (const [i, kachel] of neue.entries()) {
      try {
        jobs.push(await detailLesen(ctx.page, kachel));
        await ctx.melde(`  ${i + 1}/${neue.length}  ${kachel.title.slice(0, 60)}`);
      } catch (e) {
        if ((e as Error).name === "BlockadeFehler") throw e;
        await ctx.melde(`  ${i + 1}/${neue.length}  uebersprungen: ${(e as Error).message}`);
      }
      await warte(PAUSE_VON, PAUSE_BIS);
    }
    return jobs;
  },
};

function sucheUrl(suchwort: string, ort: string, start: number): string {
  const teile = [
    `q=${encodeURIComponent(suchwort)}`,
    `l=${encodeURIComponent(ort)}`,
    start > 0 ? `start=${start}` : "",
  ].filter(Boolean);
  return `${BASIS}/jobs?${teile.join("&")}`;
}

async function trefferlisteLesen(
  ctx: AdapterKontext,
  suchwort: string,
  ort: string,
): Promise<Kachel[]> {
  const { page } = ctx;
  const ergebnis = new Map<string, Kachel>();

  for (let seite = 0; seite < 3; seite++) {
    const url = sucheUrl(suchwort, ort, seite * 10);
    await seiteOeffnen(page, url, "indeed");
    if (seite === 0) await cookiesAblehnen(page);
    await page.waitForTimeout(2500);
    await blockadePruefen(page, "indeed");

    const karten = await page.locator('[data-testid="slider_item"]').evaluateAll((knoten) =>
      knoten.map((k) => {
        const a = k.querySelector('a[href*="jk="]');
        return {
          href: a?.getAttribute("href") ?? "",
          title: (k.querySelector("h2")?.textContent ?? a?.textContent ?? "").trim(),
          company: (k.querySelector('[data-testid="company-name"]')?.textContent ?? "").trim(),
          location: (k.querySelector('[data-testid="text-location"]')?.textContent ?? "").trim(),
        };
      }),
    );

    if (seite === 0 && karten.length === 0) {
      throw new AdapterFehler(
        "indeed",
        `Keine Trefferkacheln auf ${url} - Seite umgebaut oder Suche leer.`,
      );
    }
    if (seite === 0) {
      const ueberschrift = (await page.locator("h1").first().innerText().catch(() => "")).trim();
      await ctx.melde(`Suche "${suchwort}" in ${ort}: ${ueberschrift || `${karten.length} Kacheln`}`);
    }

    const vorher = ergebnis.size;
    for (const k of karten) {
      const id = k.href.match(/[?&]jk=([0-9a-f]+)/i)?.[1];
      if (!id || !k.title) continue;
      ergebnis.set(id, {
        externalId: id,
        url: `${BASIS}/viewjob?jk=${id}`,
        title: k.title,
        company: k.company || undefined,
        location: k.location || undefined,
        // Die Seitenansicht gehoert zu genau dieser Suche.
        suchUrl: sucheUrl(suchwort, ort, seite * 10),
      });
    }

    if (ergebnis.size === vorher) break;
    if (ergebnis.size >= ctx.maxNeueJobs * 2) break;
    await warte(PAUSE_VON, PAUSE_BIS);
  }

  return [...ergebnis.values()];
}

/**
 * Liest den Anzeigentext aus der Seitenansicht. `/viewjob` direkt aufzurufen
 * ginge nicht - das verlangt eine Anmeldung.
 */
async function detailLesen(page: Page, kachel: Kachel): Promise<RohJob> {
  const trenner = kachel.suchUrl.includes("?") ? "&" : "?";
  await seiteOeffnen(page, `${kachel.suchUrl}${trenner}vjk=${kachel.externalId}`, "indeed");
  await page.waitForTimeout(2500);

  const text = await page
    .locator("#jobDescriptionText")
    .first()
    .innerText()
    .catch(() => "");
  if (!text.trim()) {
    throw new AdapterFehler(
      "indeed",
      `Kein Anzeigentext in der Seitenansicht fuer ${kachel.externalId}.`,
    );
  }

  const ausPanel = async (auswahl: string) =>
    (await page.locator(auswahl).first().innerText().catch(() => "")).trim() || undefined;

  const titel =
    (await ausPanel('[data-testid="jobsearch-JobInfoHeader-title"]'))
      ?.replace(/\n-?\s*job post\s*$/i, "")
      .trim() || kachel.title;

  return {
    externalId: kachel.externalId,
    url: kachel.url,
    title: titel,
    company: (await ausPanel('[data-testid="inlineHeader-companyName"]')) ?? kachel.company,
    location: (await ausPanel('[data-testid="inlineHeader-companyLocation"]')) ?? kachel.location,
    // Indeed nennt die Anstellungsart nicht als eigenes Feld - der Bewerter
    // liest sie aus dem Text.
    employment: undefined,
    description: text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 20_000),
    contactEmail: await mailAusSeite(page, "#jobDescriptionText"),
    postedAt: undefined,
  };
}
