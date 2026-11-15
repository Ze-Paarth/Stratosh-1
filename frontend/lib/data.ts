export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const SECTORS = [
  { label: "Retail - XRT", ticker: "XRT" },
  { label: "Tech - XLK", ticker: "XLK" },
  { label: "Industrials - XLI", ticker: "XLI" },
  { label: "Healthcare - XLV", ticker: "XLV" },
  { label: "Custom Ticker", ticker: "" },
];

export type Decision = { category: string; priority: "High" | "Medium"; headline: string; rationale: string; estimated_impact: string };

export type Api = {
  rows: number; months: number;
  timeseries: { month: string; revenue: number; units: number; profit: number; margin_pct: number | null; etf_close: number | null }[];
  forecast: { month: string; revenue: number; low: number | null; high: number | null }[];
  ml: { method: "random_forest" | "linear_trend"; train_rows: number; features_used: string[]; market_correlation: { score: number; pearson_r: number | null; importances: Record<string, number> } | null };
  products: { product: string; category: string; revenue: number; growth_pct: number; margin_pct: number | null; trend_pct_per_month: number; status: "accelerating" | "declining" | "stable" }[];
  categories: { category: string; margin_pct: number }[];
  market: { ticker: string; available: boolean; warning: string | null; trend_30d_pct: number | null; trend_90d_pct: number | null };
  advice: { decisions: Decision[]; source: "gemini" | "rules"; warning: string | null };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const label = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

export async function postAnalyze(blob: Blob, name: string, ticker: string, signal: AbortSignal): Promise<Api> {
  const fd = new FormData();
  fd.append("file", blob, name.endsWith(".csv") ? name : "data.csv");
  fd.append("ticker", ticker);
  let res: Response;
  try { res = await fetch(`${API}/analyze`, { method: "POST", body: fd, signal }); }
  catch (e: any) {
    if (e.name === "AbortError") throw e;
    throw new Error(`Can't reach the API at ${API}. Start it with: uvicorn main:app --reload --port 8000`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Analysis failed.");
  return body;
}

export function buildView(api: Api) {
  const last12 = api.timeseries.slice(-12);
  const chart = [
    ...last12.map((r, i) => ({ month: label(r.month), sales: r.revenue, projection: i === last12.length - 1 ? r.revenue : null, etf: r.etf_close, band: null as number[] | null })),
    ...api.forecast.map((f) => ({ month: label(f.month), sales: null, projection: f.revenue, etf: null, band: f.low !== null && f.high !== null ? [f.low, f.high] : null })),
  ];
  const current = api.timeseries[api.timeseries.length - 1].revenue;
  const nextProj = api.forecast[0].revenue;
  const sorted = [...api.products].sort((a, b) => b.growth_pct - a.growth_pct);
  return {
    chart, ml: api.ml, nextProj, forecastPct: (nextProj / current - 1) * 100,
    etfTrend: api.market.trend_30d_pct, top: sorted[0], best: api.categories[0], ticker: api.market.ticker,
  };
}
