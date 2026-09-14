/**
 * Der Vertrag zwischen Scout und Portal-Adaptern.
 *
 * Jedes Portal bekommt eine eigene Datei in diesem Ordner. Nach aussen sieht
 * sie immer gleich aus: rein geht eine Browserseite und der Portal-Eintrag
 * aus der Datenbank, raus kommt eine Liste roher Anzeigen. Alles Weitere -
 * Doppelte aussortieren, speichern, protokollieren - macht der Scout.
 */
import type { Page } from "playwright";

/** Ein Portal-Eintrag, so wie er in der Tabelle `portals` steht. */
export type Portal = {
  id: string;
  display_name: string;
  search_url: string;
  filters: {
    ort?: string;
    anstellung?: string[];
    prio?: number;
    bot_risiko?: string;
    hinweis?: string;
  };
};

/** Eine Anzeige, wie der Adapter sie von der Seite liest. Noch ungeprueft. */
export type RohJob = {
  /** ID des Portals, falls die Seite eine hat (bei hokify die Zahl in der Adresse). */
  externalId?: string;
  url: string;
  title: string;
  company?: string;
  location?: string;
  /** geringfuegig / Teilzeit / Vollzeit - so wie das Portal es nennt. */
  employment?: string;
  /** Der volle Anzeigentext. Grundlage fuer die spaetere Bewertung. */
  description?: string;
  contactEmail?: string;
  /** ISO-Zeitstempel, wenn ableitbar. */
  postedAt?: string;
};

/**
 * Der Adapter darf entscheiden, welche Anzeigen er ueberhaupt aufmacht.
 * Damit er nicht jedes Mal alle Detailseiten laedt, fragt er ueber
 * `istNeu` beim Scout nach, ob eine Anzeige schon bekannt ist.
 */
export type AdapterKontext = {
  page: Page;
  portal: Portal;
  /** true, wenn diese Portal-ID noch nicht in der Datenbank steht. */
  istNeu: (externalId: string) => boolean;
  /** Obergrenze fuer Detailseiten in diesem Lauf. */
  maxNeueJobs: number;
  melde: (text: string) => Promise<void>;
};

export type Adapter = {
  id: string;
  suchen: (ctx: AdapterKontext) => Promise<RohJob[]>;
  /**
   * Die Adressen der Trefferlisten, die dieser Adapter aufruft - je Suchwort
   * die erste Seite.
   *
   * Nur fuer den Notfall gedacht: Scheitert `suchen`, weil das Portal
   * umgebaut hat, uebernimmt der Explorer (`agents/explorer.ts`) und braucht
   * einen Startpunkt. Die Suchadresse ueberlebt einen Umbau fast immer - die
   * Anhaltspunkte auf der Seite dagegen nicht.
   */
  suchadressen?: (portal: Portal) => string[];
};
