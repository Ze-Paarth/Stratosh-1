import io, re, time
import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
import advisor
import ml_engine

load_dotenv()  # GEMINI_API_KEY lives in backend/.env (for the AI advisor endpoints)
app = FastAPI(title="Stratosh API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])

COLS = ["Date", "Product_Name", "Category", "Units_Sold", "Revenue", "Unit_Cost"]
MAX_BYTES = 5 * 1024 * 1024

# ---------- 1. Sample CSV ----------
# name, category, base units/month, unit price, unit cost, monthly growth
CATALOG = [
    ("Trail Runner Shoes", "Footwear", 1150, 89.0, 52.0, 0.030),
    ("Classic Denim Jacket", "Apparel", 640, 72.0, 37.5, -0.010),
    ("Smart Fitness Watch", "Electronics", 420, 199.0, 151.0, 0.016),
    ("Eco Yoga Mat", "Fitness", 780, 38.0, 21.5, 0.040),
    ("Home Decor Starter Kit", "Home", 540, 64.0, 41.0, 0.006),
    ("Hydrating Skincare Set", "Beauty", 610, 54.0, 20.5, 0.021),
]
SEASON = [0.95, 0.86, 0.88, 0.92, 0.97, 1.0, 1.02, 1.04, 1.05, 1.08, 1.2, 1.35]  # by calendar month


@app.get("/generate-sample-csv")
def generate_sample_csv():
    rng = np.random.default_rng(42)
    end = pd.Timestamp.today().to_period("M") - 1  # last full month, so it overlaps the ETF window
    rows = []
    for i, p in enumerate(pd.period_range(end=end, periods=24, freq="M")):
        for name, cat, base, price, cost, g in CATALOG:
            units = int(base * (1 + g) ** i * SEASON[p.month - 1] * rng.uniform(0.93, 1.07))
            rows.append([p.start_time.date().isoformat(), name, cat, units,
                         round(units * price * rng.uniform(0.97, 1.03), 2), round(cost * rng.uniform(0.98, 1.02), 2)])
    csv = pd.DataFrame(rows, columns=COLS).to_csv(index=False)
    return Response(csv, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=stratosh_sample.csv"})


# ---------- 2. Market data (yfinance with fallbacks) ----------
_CACHE: dict[str, tuple[float, pd.Series]] = {}
TTL = 3600


def _is_limited(e: Exception) -> bool:
    s = str(e).lower()
    return "rate" in s or "too many" in s


def _close(df) -> pd.Series | None:
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):  # newer yfinance returns (Price, Ticker) columns
        df = df.copy()
        df.columns = df.columns.get_level_values(0)
    if "Close" not in df.columns:
        return None
    c = df["Close"]
    if isinstance(c, pd.DataFrame):
        c = c.iloc[:, 0]
    c = c.dropna().astype(float)
    if c.empty:
        return None
    c.index = pd.to_datetime(c.index).tz_localize(None)
    return c


def _download(ticker: str) -> pd.Series | None:
    try:
        c = _close(yf.download(ticker, period="2y", interval="1d", auto_adjust=True, progress=False, threads=False))
        if c is not None:
            return c
    except Exception as e:
        if _is_limited(e):
            raise
    return _close(yf.Ticker(ticker).history(period="2y", interval="1d", auto_adjust=True))  # second route


def fetch_prices(ticker: str) -> tuple[pd.Series | None, str | None]:
    """Returns (daily closes, warning). Never raises: the dashboard still works without market data."""
    hit = _CACHE.get(ticker)
    if hit and time.time() - hit[0] < TTL:
        return hit[1], None
    err = "No price data found for this ticker."
    for attempt in range(2):
        try:
            c = _download(ticker)
            if c is not None:
                _CACHE[ticker] = (time.time(), c)
                return c, None
            break
        except Exception as e:
            limited = _is_limited(e)
            err = "Yahoo Finance is rate-limiting requests. Try again in a minute." if limited else "Couldn't reach Yahoo Finance. Showing sales without market data."
            if limited and attempt == 0:
                time.sleep(1.5)
                continue
            break
    if hit:  # stale data beats no data
        return hit[1], f"{err} Showing cached prices from earlier."
    return None, err


# ---------- 3. Analyze ----------
def _num(x):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), 2)


@app.post("/analyze")
async def analyze(file: UploadFile = File(...), ticker: str = Form("XRT")):
    ticker = ticker.strip().upper()
    if not re.fullmatch(r"[A-Z.\-^]{1,10}", ticker):
        raise HTTPException(400, "Enter a valid ticker, such as XRT.")
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "CSV is larger than 5 MB.")
    try:
        df = pd.read_csv(io.BytesIO(raw))
        df.columns = [c.strip() for c in df.columns]
        lower = {c.lower(): c for c in df.columns}
        missing = [c for c in COLS if c.lower() not in lower]
        if missing:
            raise ValueError("Missing columns: " + ", ".join(missing) + ".")
        df = df.rename(columns={lower[c.lower()]: c for c in COLS})[COLS]
        df["Date"] = pd.to_datetime(df["Date"])
        for c in ("Units_Sold", "Revenue", "Unit_Cost"):
            df[c] = pd.to_numeric(df[c])
        df = df.dropna()
    except Exception as e:
        raise HTTPException(400, f"Couldn't read this CSV. {e}")

    df["Month"] = df["Date"].dt.to_period("M")
    df["Cost"] = df["Units_Sold"] * df["Unit_Cost"]
    if df["Month"].nunique() < 4:
        raise HTTPException(400, "Need at least 4 months of data.")

    # monthly per product: revenue, units, profit margin = (Revenue - Units * Unit_Cost) / Revenue
    pm = df.groupby(["Month", "Product_Name", "Category"], as_index=False).agg(
        Revenue=("Revenue", "sum"), Units=("Units_Sold", "sum"), Cost=("Cost", "sum"))
    pm["Margin"] = np.where(pm["Revenue"] > 0, (pm["Revenue"] - pm["Cost"]) / pm["Revenue"], np.nan)
    product_monthly = [
        {"month": str(r.Month), "product": r.Product_Name, "category": r.Category, "revenue": _num(r.Revenue),
         "units": int(r.Units), "profit_margin_pct": _num(r.Margin * 100)}
        for r in pm.itertuples()
    ]

    # company monthly + ETF merge
    co = df.groupby("Month").agg(Revenue=("Revenue", "sum"), Units=("Units_Sold", "sum"), Cost=("Cost", "sum"))
    co["Profit"] = co["Revenue"] - co["Cost"]
    prices, warning = await run_in_threadpool(fetch_prices, ticker)
    trend = trend90 = None
    if prices is not None:
        monthly_px = prices.groupby(prices.index.to_period("M")).last()
        co["ETF"] = monthly_px.reindex(co.index)
        last = prices.index[-1]
        trend = (prices.iloc[-1] / prices.asof(last - pd.Timedelta(days=30)) - 1) * 100
        trend90 = (prices.iloc[-1] / prices.asof(last - pd.Timedelta(days=90)) - 1) * 100
        if co["ETF"].notna().sum() == 0:
            warning = "Your data and the price history do not overlap. Use dates from the last 2 years."
    else:
        co["ETF"] = np.nan
    timeseries = [
        {"month": str(m), "revenue": _num(r.Revenue), "units": int(r.Units), "profit": _num(r.Profit),
         "margin_pct": _num(r.Profit / r.Revenue * 100) if r.Revenue else None, "etf_close": _num(r.ETF)}
        for m, r in co.iterrows()
    ]

    # ML: random forest forecast, market link, and 90-day product trends
    ml = ml_engine.run(co)
    trends = ml_engine.product_trends(df)
    products = []
    for (name, cat), g in df.groupby(["Product_Name", "Category"]):
        rev = g["Revenue"].sum()
        products.append({"product": name, "category": cat, "revenue": _num(rev),
                         "margin_pct": _num((rev - g["Cost"].sum()) / rev * 100) if rev else None, **trends[name]})
    cats = df.groupby("Category").agg(Revenue=("Revenue", "sum"), Cost=("Cost", "sum"))
    categories = sorted(
        ({"category": c, "margin_pct": _num((r.Revenue - r.Cost) / r.Revenue * 100)} for c, r in cats.iterrows() if r.Revenue),
        key=lambda d: -d["margin_pct"])

    result = {
        "rows": len(df), "months": len(co),
        "timeseries": timeseries, "forecast": ml["forecast"],
        "ml": {k: ml[k] for k in ("method", "train_rows", "features_used", "market_correlation")},
        "product_monthly": product_monthly, "products": products, "categories": categories,
        "market": {"ticker": ticker, "available": prices is not None, "warning": warning, "trend_30d_pct": _num(trend), "trend_90d_pct": _num(trend90)},
    }
    result["advice"] = await run_in_threadpool(advisor.generate, advisor.build_summary(result))
    return result
