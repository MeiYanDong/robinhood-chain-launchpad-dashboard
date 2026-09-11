from __future__ import annotations

import datetime as dt
import os
from pathlib import Path
from typing import Any, Dict, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from daily_report import DailyReportSettings, build_report_service
from sentinel import Settings, _parse_iso, build_service


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
SETTINGS = Settings()
SERVICE = build_service(SETTINGS)
REPORT_SETTINGS = DailyReportSettings()
REPORT_SERVICE = build_report_service(
    SERVICE.store,
    SETTINGS,
    notifier=SERVICE.notifier,
    settings=REPORT_SETTINGS,
)
SCHEDULER = BackgroundScheduler(timezone="UTC", daemon=True)

app = FastAPI(
    title="Cash Cat Sentinel",
    description="Read-only Robinhood Chain thesis monitor. Financial execution is disabled.",
    version="0.3.0",
)


def _enabled(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _health() -> Dict[str, Any]:
    latest = SERVICE.store.latest()
    observed = _parse_iso((latest or {}).get("observed_at"))
    age_seconds = (
        (dt.datetime.now(dt.timezone.utc) - observed).total_seconds() if observed else None
    )
    stale_after = SETTINGS.poll_seconds * 2.5
    twitter = (latest or {}).get("twitter") or {}
    twitter_observed = _parse_iso(twitter.get("observed_at"))
    twitter_age_seconds = (
        (dt.datetime.now(dt.timezone.utc) - twitter_observed).total_seconds()
        if twitter_observed
        else None
    )
    twitter_status = twitter.get("status") or "STARTING"
    liquidity_crosscheck = (
        ((latest or {}).get("collection") or {}).get("liquidity_crosscheck") or {}
    )
    if latest is None:
        status = "STARTING"
    elif age_seconds is None or age_seconds > stale_after:
        status = "STALE"
    elif ((latest.get("collection") or {}).get("data_health")) != "OK":
        status = "ERROR"
    elif twitter_status != "OK":
        status = "DEGRADED"
    else:
        status = "OK"
    job = SCHEDULER.get_job("cashcat-monitor") if SCHEDULER.running else None
    report_job = SCHEDULER.get_job("cashcat-daily-report") if SCHEDULER.running else None
    try:
        live_report = REPORT_SERVICE.archive.load("live")
    except FileNotFoundError:
        live_report = {}
    return {
        "status": status,
        "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
        "stale_after_seconds": stale_after,
        "poll_seconds": SETTINGS.poll_seconds,
        "scheduler_running": SCHEDULER.running,
        "next_run_at": job.next_run_time.isoformat() if job and job.next_run_time else None,
        "daily_report": {
            "timezone": REPORT_SETTINGS.timezone_name,
            "cutoff_hour": REPORT_SETTINGS.cutoff_hour,
            "schedule_minute": REPORT_SETTINGS.schedule_minute,
            "next_run_at": report_job.next_run_time.isoformat()
            if report_job and report_job.next_run_time
            else None,
            "live_generated_at": live_report.get("generated_at"),
            "live_evidence_status": (live_report.get("coverage") or {}).get("status"),
        },
        "financial_execution": "DISABLED",
        "data_sources": {
            "onchain": {
                "name": "GMGN",
                "mode": "LIVE",
                "status": ((latest or {}).get("collection") or {}).get("data_health") or "STARTING",
                "observed_at": (latest or {}).get("observed_at"),
                "age_seconds": round(age_seconds, 1) if age_seconds is not None else None,
            },
            "twitter": {
                "name": "TwitterAPI.io",
                "mode": "LIVE",
                "status": twitter_status,
                "observed_at": twitter.get("observed_at"),
                "age_seconds": round(twitter_age_seconds, 1)
                if twitter_age_seconds is not None
                else None,
                "configured": bool(twitter.get("configured")),
            },
            "liquidity_crosscheck": {
                "name": "DEX Screener",
                "mode": "LIVE",
                "status": liquidity_crosscheck.get("status") or "STARTING",
                "observed_at": liquidity_crosscheck.get("observed_at"),
                "pool_count": int(liquidity_crosscheck.get("pool_count") or 0),
            },
        },
    }


def _run_cycle() -> Dict[str, Any]:
    """Collect one live receipt and atomically rebuild the current report."""
    snapshot = SERVICE.run_once()
    if snapshot.get("skipped"):
        return snapshot
    try:
        # The live share card is overwritten in place, so every successful five-minute
        # receipt keeps the downloadable image aligned with the report JSON.
        report = REPORT_SERVICE.generate_live(export_png=REPORT_SETTINGS.export_png)
        snapshot["live_report"] = {
            "report_id": report.get("report_id"),
            "generated_at": report.get("generated_at"),
            "coverage": (report.get("coverage") or {}).get("status"),
            "verdict": (report.get("verdict") or {}).get("action"),
        }
    except Exception as exc:
        snapshot["live_report"] = {
            "report_id": "live",
            "error": f"{type(exc).__name__}: {exc}",
        }
    return snapshot


@app.on_event("startup")
def start_worker() -> None:
    if not _enabled("CASHCAT_AUTOSTART", False) or SCHEDULER.running:
        return
    SCHEDULER.add_job(
        _run_cycle,
        "interval",
        seconds=SETTINGS.poll_seconds,
        id="cashcat-monitor",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=max(30, SETTINGS.poll_seconds),
        next_run_time=dt.datetime.now(dt.timezone.utc),
    )
    SCHEDULER.add_job(
        REPORT_SERVICE.generate_scheduled,
        "cron",
        hour=REPORT_SETTINGS.cutoff_hour,
        minute=REPORT_SETTINGS.schedule_minute,
        timezone=REPORT_SETTINGS.timezone,
        id="cashcat-daily-report",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=1800,
    )
    # Rebuild the current report immediately from the latest persisted evidence. The first
    # scheduled collection replaces it again as soon as fresh GMGN and X receipts arrive.
    REPORT_SERVICE.generate_live(export_png=False)
    SCHEDULER.start()


@app.on_event("shutdown")
def stop_worker() -> None:
    if SCHEDULER.running:
        SCHEDULER.shutdown(wait=False)


@app.get("/api/health")
def api_health() -> Dict[str, Any]:
    return _health()


@app.get("/api/status")
def api_status() -> Dict[str, Any]:
    return {"health": _health(), "latest": SERVICE.store.latest()}


@app.post("/api/run")
def api_run() -> Dict[str, Any]:
    return _run_cycle()


@app.get("/api/history")
def api_history(limit: int = Query(100, ge=1, le=1000)) -> Dict[str, Any]:
    return {"snapshots": SERVICE.store.history(limit)}


@app.get("/api/events")
def api_events(limit: int = Query(100, ge=1, le=1000)) -> Dict[str, Any]:
    return {"events": SERVICE.store.events(limit)}


@app.get("/api/narrative")
def api_get_narrative() -> Dict[str, Any]:
    return SERVICE.narrative_store.load()


@app.post("/api/narrative")
def api_save_narrative(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    try:
        saved = SERVICE.narrative_store.save(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"saved": saved, "note": "Saved locally; the next monitor cycle will evaluate it."}


@app.get("/api/config")
def api_config() -> Dict[str, Any]:
    return {
        "target_address": SETTINGS.target_address,
        "target_symbol": SETTINGS.target_symbol,
        "chain": SETTINGS.chain,
        "poll_seconds": SETTINGS.poll_seconds,
        "rank_limit": SETTINGS.rank_limit,
        "cliff_thresholds": {
            "market_cap": SETTINGS.market_cap_cliff,
            "liquidity": SETTINGS.liquidity_cliff,
            "holder_count": SETTINGS.holders_cliff,
            "multi_window_volume": SETTINGS.volume_cliff,
        },
        "minimum_volume_lead_windows": SETTINGS.minimum_volume_lead_windows,
        "baseline_points": SETTINGS.baseline_points,
        "twitter": {
            "enabled": True,
            "source": "TwitterAPI.io",
            "mode": "LIVE",
            "minimum_request_interval_seconds": SETTINGS.twitter_min_request_interval_seconds,
        },
        "retention_days": SETTINGS.retention_days,
        "financial_execution": "DISABLED",
        "daily_report": {
            "timezone": REPORT_SETTINGS.timezone_name,
            "window": f"前一日 {REPORT_SETTINGS.cutoff_hour:02d}:00 至当日 {REPORT_SETTINGS.cutoff_hour:02d}:00",
            "generate_at": f"{REPORT_SETTINGS.cutoff_hour:02d}:{REPORT_SETTINGS.schedule_minute:02d}",
            "minimum_coverage": REPORT_SETTINGS.minimum_coverage,
            "share_card": "1080x1350",
            "export_png": REPORT_SETTINGS.export_png,
        },
    }


@app.get("/api/reports")
def api_reports() -> Dict[str, Any]:
    return {"reports": REPORT_SERVICE.archive.list()}


@app.get("/api/reports/latest")
def api_latest_report() -> Dict[str, Any]:
    try:
        return REPORT_SERVICE.archive.latest()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="No report has been generated yet.") from exc


@app.post("/api/reports/generate")
def api_generate_report(
    mode: str = Query("live", pattern="^(live|preview|daily)$"),
    report_date: Optional[str] = Query(None, description="Daily report cutoff date, YYYY-MM-DD"),
    export_png: bool = Query(True),
) -> Dict[str, Any]:
    if mode == "live":
        return REPORT_SERVICE.generate_live(export_png=export_png)
    if mode == "preview":
        return REPORT_SERVICE.generate_preview(export_png=export_png)
    chosen_date: Optional[dt.date] = None
    if report_date:
        try:
            chosen_date = dt.date.fromisoformat(report_date)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="report_date must be YYYY-MM-DD") from exc
    return REPORT_SERVICE.generate_daily(chosen_date, export_png=export_png, notify=False)


@app.get("/api/reports/{report_id}/card.png")
def api_report_card_png(report_id: str):
    try:
        path = REPORT_SERVICE.archive.png_path(report_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="Card image has not been exported")
    return FileResponse(str(path), media_type="image/png", filename=f"cashcat-{report_id}.png")


@app.get("/api/reports/{report_id}")
def api_report(report_id: str) -> Dict[str, Any]:
    try:
        return REPORT_SERVICE.archive.load(report_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc


@app.get("/reports/latest")
def latest_report_page():
    return FileResponse(str(STATIC_DIR / "report.html"))


@app.get("/reports/{report_id}/card")
def report_card_page(report_id: str):
    try:
        REPORT_SERVICE.archive.load(report_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc
    return FileResponse(str(STATIC_DIR / "report-card.html"))


@app.get("/reports/{report_id}")
def report_page(report_id: str):
    try:
        REPORT_SERVICE.archive.load(report_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail="Report not found") from exc
    return FileResponse(str(STATIC_DIR / "report.html"))


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index():
    return FileResponse(str(STATIC_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8010, workers=1)
