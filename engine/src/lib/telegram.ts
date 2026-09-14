/**
 * Duenne Huelle um die Telegram-Bot-API - nur die drei Aufrufe, die Apply AI
 * braucht: eine Nachricht schicken (mit Knoepfen), auf Knopfdruecke warten,
 * und dem Knopf Bescheid geben, dass er verarbeitet ist.
 *
 * Bewusst ohne SDK: Telegrams HTTP-API ist simpel genug, dass ein eigenes
 * Paket dafuer nur Ballast waere.
 */
import { env } from "./env.ts";

const BASIS = "https://api.telegram.org/bot";

function bereit(): boolean {
  return Boolean(env.telegramToken && env.telegramChatId);
}

/** Wirft eine verstaendliche Fehlermeldung, wenn Telegram nicht eingerichtet ist. */
function pruefeEingerichtet() {
  if (!bereit()) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID fehlt in der .env - " +
        "ohne die beiden kann Apply AI nicht auf Telegram schreiben.",
    );
  }
}

type Knopf = { text: string; callback_data: string };

/**
 * Schickt eine Textnachricht, wahlweise mit einer Reihe Knoepfen darunter.
 * Gibt die Nachrichten-ID zurueck (aktuell ungenutzt, aber nuetzlich falls
 * spaeter mal die Nachricht selbst bearbeitet werden soll statt eine neue
 * hinterherzuschicken).
 */
export async function sendeNachricht(text: string, knoepfe?: Knopf[]): Promise<number | null> {
  pruefeEingerichtet();
  const antwort = await fetch(`${BASIS}${env.telegramToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.telegramChatId,
      // Telegram-Nachrichten sind auf 4096 Zeichen begrenzt - ein Anschreiben
      // ist nie so lang, aber sicher ist sicher.
      text: text.slice(0, 4090),
      ...(knoepfe ? { reply_markup: { inline_keyboard: [knoepfe] } } : {}),
    }),
  });
  const daten = (await antwort.json()) as {
    ok: boolean;
    description?: string;
    result?: { message_id: number };
  };
  if (!daten.ok) throw new Error(`Telegram sendMessage: ${daten.description ?? antwort.status}`);
  return daten.result?.message_id ?? null;
}

export type TelegramUpdate = {
  update_id: number;
  callback_query?: { id: string; data?: string };
};

/**
 * Holt anstehende Updates (Knopfdruecke). Ohne `abBietet` liefert Telegram
 * alles Unbestaetigte der letzten 24 Stunden - mit `abBietet` werden aeltere
 * Updates als erledigt markiert und tauchen danach nicht mehr auf.
 */
export async function holeUpdates(abBietet?: number): Promise<TelegramUpdate[]> {
  pruefeEingerichtet();
  const url = new URL(`${BASIS}${env.telegramToken}/getUpdates`);
  url.searchParams.set("timeout", "0");
  if (abBietet !== undefined) url.searchParams.set("offset", String(abBietet));
  const antwort = await fetch(url);
  const daten = (await antwort.json()) as {
    ok: boolean;
    description?: string;
    result?: TelegramUpdate[];
  };
  if (!daten.ok) throw new Error(`Telegram getUpdates: ${daten.description ?? antwort.status}`);
  return daten.result ?? [];
}

/**
 * Nimmt dem gedrueckten Knopf das Drehen ab (das kleine Ladesymbol auf dem
 * Handy) und zeigt optional eine kurze Meldung an - unauffaellig oben am
 * Bildschirm, nicht als eigene Nachricht im Chat.
 */
export async function beantworteKnopf(callbackQueryId: string, text?: string): Promise<void> {
  pruefeEingerichtet();
  await fetch(`${BASIS}${env.telegramToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => {
    // Eine nicht beantwortete Callback-Query ist hoechstens ein Ladesymbol,
    // das zu lang haengen bleibt - kein Grund, den Lauf abzubrechen.
  });
}

export { bereit as telegramEingerichtet };
