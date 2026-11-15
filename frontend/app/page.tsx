"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Boxes, Database, Download, FileText, Loader2, Percent, Rocket, Tag, Target, TrendingUp, Upload, X } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API, SECTORS, buildView, postAnalyze, type Api } from "@/lib/data";
import { printBrief } from "@/lib/brief";

const money = (n: number) => "$" + Math.round(n).toLocaleString();
const pct = (n: number) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "%";
const tone = (n: number) => (n >= 0 ? "text-good" : "text-bad");
const ICONS: Record<string, typeof Boxes> = { "Inventory Action": Boxes, "Pricing Strategy": Tag, "Product Focus": Target };
const card = "rounded-lg border border-line bg-card p-5";
const btn = "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold";
const field = "rounded-md border border-line bg-paper px-3 py-2 text-sm";
const tip = { background: "var(--card)", border: "1px solid var(--line)" };

type Toast = { id: number; kind: "error" | "warn"; msg: string };
const Skel = ({ className = "" }: { className?: string }) => <div className={`animate-pulse rounded-md bg-line motion-reduce:animate-none ${className}`} />;

function Skeleton() {
  return (
    <div role="status" aria-label="Running forecast and AI analysis">
      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={card}><Skel className="h-4 w-28" /><Skel className="mt-3 h-8 w-36" /><Skel className="mt-2 h-3 w-24" /></div>)}
      </section>
      <section className={`${card} mt-4`}><Skel className="h-5 w-48" /><Skel className="mt-2 h-4 w-80 max-w-full" /><Skel className="mt-4 h-80 w-full" /></section>
      <section className="mt-4 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className={card}><Skel className="h-4 w-32" /><Skel className="mt-4 h-6 w-full" /><Skel className="mt-3 h-3 w-full" /><Skel className="mt-2 h-3 w-5/6" /><Skel className="mt-2 h-3 w-2/3" /></div>)}
      </section>
      <p className="mt-3 text-center text-sm text-mute">Running the forecast model and drafting recommendations…</p>
    </div>
  );
}

export default function Home() {
  const [csv, setCsv] = useState<{ blob: Blob; name: string } | null>(null);
  const [api, setApi] = useState<Api | null>(null);
  const [loadedName, setLoadedName] = useState("");
  const [loading, setLoading] = useState(false);
  const [sector, setSector] = useState("Retail - XRT");
  const [ticker, setTicker] = useState("XRT");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const a = useMemo(() => (api ? buildView(api) : null), [api]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((kind: Toast["kind"], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.filter((x) => x.msg !== msg).slice(-2), { id, kind, msg }]);
    if (kind === "warn") setTimeout(() => dismiss(id), 8000);
  }, [dismiss]);

  useEffect(() => {
    if (!csv || !ticker) return;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try { setApi(await postAnalyze(csv.blob, csv.name, ticker, ctrl.signal)); setLoadedName(csv.name); }
      catch (e: any) { if (e.name !== "AbortError") notify("error", e.message); }
      finally { if (!ctrl.signal.aborted) setLoading(false); }
    }, 400);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [csv, ticker, notify]);

  useEffect(() => {
    if (api?.market.warning) notify("warn", api.market.warning);
    if (api?.advice.warning) notify("warn", api.advice.warning);
  }, [api, notify]);

  function onSector(label: string) { setSector(label); setTicker(SECTORS.find((x) => x.label === label)!.ticker); }
  function onTicker(v: string) {
    const t = v.toUpperCase().replace(/[^A-Z.-]/g, "").slice(0, 8);
    setTicker(t);
    setSector(SECTORS.find((x) => x.ticker === t)?.label ?? "Custom Ticker");
  }
  function onFile(f?: File) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) { notify("error", "That file isn't a CSV. Upload a .csv file."); }
    else setCsv({ blob: f, name: f.name });
    if (fileRef.current) fileRef.current.value = "";
  }
  async function loadDemo() {
    try {
      const res = await fetch(`${API}/generate-sample-csv`);
      if (!res.ok) throw new Error();
      setCsv({ blob: await res.blob(), name: "Demo retail dataset.csv" });
      onSector("Retail - XRT");
    } catch { notify("error", `Can't reach the API at ${API}. Start it with: uvicorn main:app --reload --port 8000`); }
  }

  const kpis = a && [
    { icon: TrendingUp, label: "Next-month forecast", value: money(a.nextProj), sub: `${pct(a.forecastPct)} vs. current month`, subTone: tone(a.forecastPct), valueTone: "" },
    { icon: Activity, label: `${a.ticker} 30-day trend`, value: a.etfTrend === null ? "N/A" : pct(a.etfTrend), sub: a.etfTrend === null ? "Market data unavailable" : "Sector ETF price", subTone: "text-mute", valueTone: a.etfTrend === null ? "" : tone(a.etfTrend) },
    { icon: Rocket, label: "Top growth product", value: a.top.product, sub: `${pct(a.top.growth_pct)} quarter over quarter`, subTone: tone(a.top.growth_pct), valueTone: "" },
    { icon: Percent, label: "Highest margin category", value: a.best.category, sub: `${a.best.margin_pct.toFixed(1)}% gross margin`, subTone: "text-mute", valueTone: "" },
  ];

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Stratosh</h1>
        <p className="text-sm text-mute">{loading ? "Running analysis…" : loadedName ? `Data: ${loadedName}` : "No data loaded"}</p>
      </header>

      <section className={`${card} mt-5 flex flex-wrap items-end gap-4`} aria-label="Controls">
        <label className="flex flex-col gap-1 text-sm text-mute">Industry sector
          <select value={sector} onChange={(e) => onSector(e.target.value)} className={`${field} text-ink`}>
            {SECTORS.map((s) => <option key={s.label}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-mute">Ticker
          <input value={ticker} onChange={(e) => onTicker(e.target.value)} placeholder="e.g. WMT" className={`${field} w-32 text-ink`} />
        </label>
        <div className="ml-auto flex flex-wrap gap-3">
          <a href={`${API}/generate-sample-csv`} className={`${btn} border border-line`}><Download size={16} />Sample CSV</a>
          <label className={`${btn} cursor-pointer border border-line`}>
            <Upload size={16} />Upload CSV
            <input ref={fileRef} type="file" accept=".csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <button onClick={loadDemo} disabled={loading} className={`${btn} bg-accent text-paper disabled:opacity-60`}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}Load Demo Retail Dataset
          </button>
        </div>
      </section>

      {loading ? <Skeleton /> : !a || !kpis || !api ? (
        <section className={`${card} mt-4 py-16 text-center`}>
          <p className="font-semibold">No data yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-mute">Load the demo retail dataset, or upload a CSV with Date, Product_Name, Category, Units_Sold, Revenue and Unit_Cost columns.</p>
        </section>
      ) : (
        <>
          <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className={card}>
                <div className="flex items-center gap-2 text-sm text-mute"><k.icon size={16} />{k.label}</div>
                <p className={`mt-2 truncate text-2xl font-bold ${k.valueTone}`}>{k.value}</p>
                <p className={`mt-1 text-sm ${k.subTone}`}>{k.sub}</p>
              </div>
            ))}
          </section>

          <section className={`${card} mt-4`}>
            <h2 className="font-semibold">Sales vs. {a.ticker}</h2>
            <p className="text-sm text-mute">Monthly sales on the left axis, ETF price on the right. Dashed line is the 3-month forecast.</p>
            <p className="mt-1 text-sm text-mute">
              {a.ml.method === "random_forest" ? "Random forest forecast" : "Linear trend forecast (not enough history for the random forest)"}
              {a.ml.market_correlation ? `. ${a.ticker} drives ${Math.round(a.ml.market_correlation.score * 100)}% of the model's decisions${a.ml.market_correlation.pearson_r !== null ? `, and sales growth correlates ${a.ml.market_correlation.pearson_r.toFixed(2)} with its monthly return` : ""}.` : "."}
            </p>
            <div className="mt-4 h-80">
              <ResponsiveContainer>
                <ComposedChart data={a.chart} margin={{ right: 8 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--mute)" fontSize={12} />
                  <YAxis yAxisId="l" stroke="var(--mute)" fontSize={12} width={56} tickFormatter={(v) => "$" + Math.round(v / 1000) + "k"} />
                  <YAxis yAxisId="r" orientation="right" stroke="var(--mute)" fontSize={12} width={48} domain={["auto", "auto"]} tickFormatter={(v) => "$" + Math.round(v)} />
                  <Tooltip contentStyle={tip} formatter={(v: any, name: string) => (Array.isArray(v) ? `${money(v[0])} – ${money(v[1])}` : name === a.ticker ? "$" + v.toFixed(2) : money(v))} />
                  <Legend />
                  <Area yAxisId="l" dataKey="band" name="Forecast range" stroke="none" fill="var(--accent)" fillOpacity={0.14} connectNulls={false} legendType="square" />
                  <Line yAxisId="l" dataKey="sales" name="Company sales" stroke="var(--accent)" strokeWidth={2.5} dot={false} />
                  <Line yAxisId="l" dataKey="projection" name="Forecast" stroke="var(--accent)" strokeWidth={2.5} strokeDasharray="6 5" dot={false} connectNulls />
                  <Line yAxisId="r" dataKey="etf" name={a.ticker} stroke="var(--alt)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="mt-6" aria-label="AI decisions">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Recommended actions</h2>
                <p className="text-sm text-mute">{api.advice.source === "gemini" ? "Generated by Gemini 2.5 Flash from your data" : "Rule-based recommendations (AI unavailable)"}</p>
              </div>
              <button onClick={() => printBrief(api, loadedName)} className={`${btn} border border-line bg-card`}><FileText size={16} />Export Strategy Brief</button>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              {api.advice.decisions.map((c) => {
                const Icon = ICONS[c.category] ?? Target;
                return (
                  <article key={c.category} className={card}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-sm text-mute"><Icon size={16} />{c.category}</span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.priority === "High" ? "border-bad text-bad" : "border-alt text-alt"}`}>{c.priority}</span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold leading-snug">{c.headline}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-mute">{c.rationale}</p>
                    <p className="mt-3 border-t border-line pt-3 text-sm"><span className="font-semibold">Estimated impact: </span>{c.estimated_impact}</p>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}

      <div aria-live="assertive" className="fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="alert" className={`flex items-start gap-3 rounded-lg border bg-card p-3 text-sm shadow-lg ${t.kind === "error" ? "border-bad" : "border-alt"}`}>
            <p className={`flex-1 ${t.kind === "error" ? "text-bad" : "text-alt"}`}>{t.msg}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-mute"><X size={16} /></button>
          </div>
        ))}
      </div>
    </main>
  );
}
