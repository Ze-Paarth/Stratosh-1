"""Forecasting for Stratosh: feature engineering, random forest, product trends."""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression

FEATURES = ["Month", "Lag_1_Sales", "Lag_2_Sales", "Sector_Return_1M", "Sector_Volatility"]
SECTOR_FEATURES = ["Sector_Return_1M", "Sector_Volatility"]
MIN_TRAIN_ROWS = 8      # below this a forest is noise, so fall back to a linear trend
MIN_SECTOR_COVERAGE = 0.7
HORIZON = 3


def _num(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def engineer_features(co: pd.DataFrame) -> pd.DataFrame:
    """co: monthly frame indexed by Period('M') with Revenue and ETF (month-end close, may be NaN)."""
    etf = co["ETF"].ffill().bfill()
    ret = (etf / etf.shift(1) - 1) * 100  # monthly % change
    f = pd.DataFrame(index=co.index)
    f["Revenue"] = co["Revenue"]
    f["Month"] = co.index.month
    f["Lag_1_Sales"] = co["Revenue"].shift(1)
    f["Lag_2_Sales"] = co["Revenue"].shift(2)
    f["Sector_Return_1M"] = ret
    # rolling 3-month std of the ticker's monthly returns (price std would depend on the ticker's price level)
    f["Sector_Volatility"] = ret.rolling(3).std()
    return f


def _linear_forecast(co: pd.DataFrame) -> list[dict]:
    y = co["Revenue"].values
    model = LinearRegression().fit(np.arange(len(y)).reshape(-1, 1), y)
    preds = model.predict(np.arange(len(y), len(y) + HORIZON).reshape(-1, 1))
    return [{"month": str(co.index[-1] + k), "revenue": _num(max(p, 0)), "low": None, "high": None}
            for k, p in enumerate(preds, start=1)]


def run(co: pd.DataFrame) -> dict:
    """Train on history, forecast 3 months ahead, and score how much the sector ticker matters."""
    has_sector = co["ETF"].notna().mean() >= MIN_SECTOR_COVERAGE and co["ETF"].notna().sum() >= 6
    cols = FEATURES if has_sector else [c for c in FEATURES if c not in SECTOR_FEATURES]
    feats = engineer_features(co)
    train = feats.dropna(subset=cols + ["Revenue"])

    if len(train) < MIN_TRAIN_ROWS:
        return {"method": "linear_trend", "train_rows": len(train), "features_used": [],
                "forecast": _linear_forecast(co), "market_correlation": None}

    model = RandomForestRegressor(n_estimators=300, max_depth=4, min_samples_leaf=2, random_state=42)
    model.fit(train[cols], train["Revenue"])

    # Iterative forecast: feed each prediction back in as next month's lag.
    # Sector momentum holds: the ticker keeps compounding at its trailing 3-month average return.
    hist = list(co["Revenue"].values)
    rets = list(feats["Sector_Return_1M"].dropna().values) if has_sector else []
    momentum = float(np.mean(rets[-3:])) if rets else 0.0
    forecast = []
    for k in range(1, HORIZON + 1):
        period = co.index[-1] + k
        row = {"Month": period.month, "Lag_1_Sales": hist[-1], "Lag_2_Sales": hist[-2]}
        if has_sector:
            rets.append(momentum)
            row["Sector_Return_1M"] = momentum
            row["Sector_Volatility"] = float(pd.Series(rets[-3:]).std())
        X = pd.DataFrame([row])[cols]
        pred = float(model.predict(X)[0])
        per_tree = np.array([t.predict(X.values)[0] for t in model.estimators_])
        forecast.append({"month": str(period), "revenue": _num(pred),
                         "low": _num(np.percentile(per_tree, 10)), "high": _num(np.percentile(per_tree, 90))})
        hist.append(pred)

    importances = {c: _num(v, 4) for c, v in zip(cols, model.feature_importances_)}
    market = None
    if has_sector:
        pair = pd.concat([co["Revenue"].pct_change(), feats["Sector_Return_1M"]], axis=1).dropna()
        r = pair.corr().iloc[0, 1] if len(pair) >= 4 else None
        market = {
            "score": _num(sum(importances[c] for c in SECTOR_FEATURES), 3),  # 0-1: share of the model's decisions driven by the ticker
            "pearson_r": _num(r, 2) if r is not None else None,               # revenue growth vs sector return
            "importances": importances,
            "assumed_monthly_momentum_pct": _num(momentum),
        }
    return {"method": "random_forest", "train_rows": len(train), "features_used": cols,
            "forecast": forecast, "market_correlation": market}


def product_trends(df: pd.DataFrame) -> dict[str, dict]:
    """df has Month (Period), Product_Name, Revenue. Looks at the last 90 days (3 months) per product."""
    months = sorted(df["Month"].unique())
    recent, prior = months[-3:], months[-6:-3]
    out = {}
    for name, g in df.groupby("Product_Name"):
        m = g.groupby("Month")["Revenue"].sum().reindex(recent).fillna(0.0)
        slope = np.polyfit(np.arange(len(m)), m.values, 1)[0] if len(m) >= 2 else 0.0
        trend = slope / m.mean() * 100 if m.mean() else 0.0
        a, b = m.sum(), g.loc[g["Month"].isin(prior), "Revenue"].sum()
        out[name] = {
            "growth_pct": _num((a / b - 1) * 100) if b else 0.0,   # last 90 days vs the 90 before
            "trend_pct_per_month": _num(trend),                    # slope across the last 3 months
            "status": "accelerating" if trend > 2 else "declining" if trend < -2 else "stable",
        }
    return out
