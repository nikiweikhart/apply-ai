import Anthropic from "@anthropic-ai/sdk";
import { env, PREISE } from "./env.ts";

export const claude = new Anthropic({ apiKey: env.anthropicKey });

/** Rechnet aus, was ein einzelner Aufruf gekostet hat. */
export function kosten(model: string, einTokens: number, ausTokens: number): number {
  const p = PREISE[model];
  if (!p) return 0;
  return (einTokens / 1_000_000) * p.ein + (ausTokens / 1_000_000) * p.aus;
}
