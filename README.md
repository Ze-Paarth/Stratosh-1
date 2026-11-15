# Stratosh

## Run
Backend (http://localhost:8000):

    cd backend && python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # GEMINI_API_KEY (needed for the AI advisor, not for /analyze)
    uvicorn main:app --reload --port 8000

Frontend (http://localhost:3000):

    cd frontend && cp .env.local.example .env.local
    npm install && npm run dev

Click "Load Demo Retail Dataset" to fetch a sample CSV, analyze it against live ETF prices, and update the chart.

## API
- GET  /generate-sample-csv  24-month CSV (Date, Product_Name, Category, Units_Sold, Revenue, Unit_Cost)
- POST /analyze              multipart: file (CSV) + ticker (e.g. XRT) -> merged sales/ETF time series, forecast, product summaries
