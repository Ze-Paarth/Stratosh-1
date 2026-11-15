import { label, type Api } from "./data";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n: number | null) => (n === null ? "n/a" : (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%");

// Builds a clean standalone report and opens the print dialog (Save as PDF works from there).
export function printBrief(api: Api, source: string) {
  const cur = api.timeseries[api.timeseries.length - 1];
  const next = api.forecast[0];
  const { market, advice, ml } = api;
  const rows = [...api.products].sort((a, b) => b.growth_pct - a.growth_pct)
    .map((p) => `<tr><td>${esc(p.product)}</td><td>${esc(p.category)}</td><td>${pct(p.growth_pct)}</td><td>${p.margin_pct?.toFixed(1) ?? "n/a"}%</td><td>${esc(p.status)}</td></tr>`).join("");
  const cards = advice.decisions.map((d) => `
    <section class="d"><div class="h"><span>${esc(d.category)}</span><b class="${d.priority === "High" ? "hi" : "md"}">${esc(d.priority)} priority</b></div>
    <h3>${esc(d.headline)}</h3><p>${esc(d.rationale)}</p><p class="i"><b>Estimated impact:</b> ${esc(d.estimated_impact)}</p></section>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Stratosh strategy brief</title><style>
    @page{margin:18mm} body{font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#16202C;max-width:760px;margin:0 auto}
    h1{font-size:24px;margin:0} h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #ccd3db;padding-bottom:4px} h3{font-size:16px;margin:6px 0 4px}
    .m{color:#5E6B7A;font-size:12px;margin-top:4px} .k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .k div{border:1px solid #ccd3db;border-radius:6px;padding:8px 10px} .k small{display:block;color:#5E6B7A;font-size:11px} .k b{font-size:16px}
    .d{border:1px solid #ccd3db;border-radius:6px;padding:12px 14px;margin:10px 0;break-inside:avoid} .h{display:flex;justify-content:space-between;color:#5E6B7A;font-size:12px}
    .hi{color:#B4443C} .md{color:#9A6410} p{margin:4px 0} .i{color:#33414f}
    table{width:100%;border-collapse:collapse;font-size:12.5px} th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e1e6ec} th{color:#5E6B7A;font-weight:600}
    .f{margin-top:24px;color:#5E6B7A;font-size:11px}</style></head><body>
    <h1>Stratosh strategy brief</h1>
    <p class="m">${esc(new Date().toLocaleDateString("en-US", { dateStyle: "long" }))} · Data: ${esc(source)} · Sector ETF: ${esc(market.ticker)}</p>
    <h2>Snapshot</h2><div class="k">
      <div><small>Forecast, ${esc(label(next.month))}</small><b>${money(next.revenue)}</b></div>
      <div><small>Latest month, ${esc(label(cur.month))}</small><b>${money(cur.revenue)}</b></div>
      <div><small>${esc(market.ticker)} 30-day</small><b>${pct(market.trend_30d_pct)}</b></div>
      <div><small>${esc(market.ticker)} 90-day</small><b>${pct(market.trend_90d_pct)}</b></div></div>
    <h2>Recommended actions</h2>${cards}
    <h2>Product performance (last 90 days vs. prior 90)</h2>
    <table><tr><th>Product</th><th>Category</th><th>Growth</th><th>Margin</th><th>Trend</th></tr>${rows}</table>
    <p class="f">${ml.method === "random_forest" ? "Forecast from a random forest model" : "Forecast from a linear trend (limited history)"}. Recommendations by ${advice.source === "gemini" ? "Gemini 2.5 Flash" : "rule-based logic"}. Impact figures are estimates, not guarantees.</p>
    </body></html>`;
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open(); d.write(html); d.close();
  f.contentWindow!.focus(); f.contentWindow!.print();
  setTimeout(() => f.remove(), 60000);
}
