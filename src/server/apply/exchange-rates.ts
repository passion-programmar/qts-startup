// Currency rates for salary questions that ask in another currency than the candidate's
// expectation. The European Central Bank publishes reference rates once per working day (free, no
// key); they are kept in memory for 6 hours. Without them, the AI converts the currency instead.

export type ExchangeRates = {
  /** Every rate is the amount of that currency for 1 EUR. */
  base: "EUR";
  date: string;
  rates: Record<string, number>;
};

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const KEEP_MS = 6 * 60 * 60 * 1000;

let kept: { rates: ExchangeRates; at: number } | null = null;

/** The ECB daily file's rates, or null when it has none. */
export function parseEcbRates(xml: string): ExchangeRates | null {
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rates: Record<string, number> = { EUR: 1 };
  for (const [, currency, rate] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) {
    const value = Number(rate);
    if (value > 0) rates[currency] = value;
  }
  return date && Object.keys(rates).length > 1 ? { base: "EUR", date, rates } : null;
}

export async function loadExchangeRates(): Promise<ExchangeRates | null> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.rates;
  try {
    const response = await fetch(ECB_DAILY_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return kept?.rates ?? null;
    const rates = parseEcbRates(await response.text());
    if (rates) kept = { rates, at: Date.now() };
    return rates ?? kept?.rates ?? null;
  } catch (error) {
    console.warn("Could not load the ECB exchange rates.", error);
    return kept?.rates ?? null;
  }
}
