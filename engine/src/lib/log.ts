import { db } from "./supabase.ts";

type Level = "info" | "warn" | "error";
type Agent = "scout" | "score" | "write" | "freigabe" | "mail" | "antwort" | "browser" | "check";

type Extra = {
  jobId?: string;
  data?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  runMinutes?: number;
};

const SYMBOL: Record<Level, string> = { info: "  ", warn: "! ", error: "X " };

/**
 * Schreibt eine Zeile ins Protokoll - einmal auf den Bildschirm (damit man
 * live zuschauen kann) und einmal in die Datenbank (damit man morgens
 * nachlesen kann, was nachts passiert ist).
 */
export async function log(
  agent: Agent,
  level: Level,
  message: string,
  extra: Extra = {},
): Promise<void> {
  console.log(`${SYMBOL[level]}[${agent}] ${message}`);

  const { error } = await db.from("events").insert({
    agent,
    level,
    message,
    job_id: extra.jobId ?? null,
    data: extra.data ?? null,
    input_tokens: extra.inputTokens ?? null,
    output_tokens: extra.outputTokens ?? null,
    cost_usd: extra.costUsd ?? null,
    run_minutes: extra.runMinutes ?? null,
  });

  // Ein kaputtes Protokoll darf den Agenten nicht stoppen.
  if (error) console.error(`X  [log] Protokoll nicht gespeichert: ${error.message}`);
}
