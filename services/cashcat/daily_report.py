from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote
from zoneinfo import ZoneInfo


APP_DIR = Path(__file__).resolve().parent
REPORT_ID_PATTERN = re.compile(r"^[0-9A-Za-z_-]+$")
VOLUME_WINDOWS = ("5m", "1h", "6h", "24h")


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def _parse_iso(value: Any) -> Optional[dt.datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _number(value: Any) -> Optional[float]:
    try:
        if value in (None, ""):
            return None
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _round(value: Any, digits: int = 4) -> Optional[float]:
    number = _number(value)
    return round(number, digits) if number is not None else None


def _percent_change(start: Any, end: Any) -> Optional[float]:
    start_number = _number(start)
    end_number = _number(end)
    if start_number in (None, 0) or end_number is None:
        return None
    return round((end_number / start_number - 1) * 100, 2)


def _compact_text(value: Any, limit: int = 280) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _nested(data: Dict[str, Any], *keys: str, default: Any = None) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return default if current is None else current


@dataclass(frozen=True)
class DailyReportSettings:
    timezone_name: str = os.getenv("CASHCAT_REPORT_TIMEZONE", "Asia/Shanghai")
    cutoff_hour: int = _env_int("CASHCAT_REPORT_CUTOFF_HOUR", 8)
    schedule_minute: int = _env_int("CASHCAT_REPORT_SCHEDULE_MINUTE", 10)
    minimum_coverage: float = _env_float("CASHCAT_REPORT_MINIMUM_COVERAGE", 0.90)
    report_dir: Path = Path(
        os.getenv("CASHCAT_REPORT_DIR", str(APP_DIR / "outputs" / "reports"))
    )
    base_url: str = os.getenv("CASHCAT_REPORT_BASE_URL", "http://127.0.0.1:8010")
    export_png: bool = _env_bool("CASHCAT_REPORT_EXPORT_PNG", True)
    chrome_bin: str = os.getenv("CASHCAT_CHROME_BIN", "")

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)


ACTION_LABELS = {
    "HOLD": "继续持有",
    "WATCH": "继续观察",
    "EXIT_CANDIDATE": "准备离场",
    "EXIT": "清仓离场",
    "UNKNOWN": "暂停判断",
    "PAUSE": "暂停判断",
}

ACTION_TONES = {
    "HOLD": "positive",
    "WATCH": "watch",
    "EXIT_CANDIDATE": "warning",
    "EXIT": "danger",
    "UNKNOWN": "muted",
    "PAUSE": "muted",
}

LEADER_LABELS = {
    "FOUR_CLIFFS": "四项断崖领先",
    "LEADER_NOT_CLIFF": "龙头，但未四项断崖",
    "CHALLENGED": "龙头地位受挑战",
    "UNKNOWN": "数据不足",
}

ATTENTION_LABELS = {
    "STABLE": "链上热度稳定",
    "WARMING_UP": "基线积累中",
    "WEAKENING": "链上活跃度转弱",
    "DIVERSION_CANDIDATE": "出现分流迹象",
    "DIVERTED": "关注与资金已分流",
    "UNKNOWN": "热度数据不足",
}

NARRATIVE_LABELS = {
    "CONFIRMED": "叙事仍获支持",
    "WATCH": "叙事需要观察",
    "EXIT_CANDIDATE": "叙事出现风险",
    "EXIT": "叙事前提破坏",
    "UNKNOWN": "舆情证据不足",
}


class DailyReportBuilder:
    """Translate immutable monitor snapshots into a deterministic daily fact package."""

    def __init__(self, store: Any, monitor_settings: Any, settings: DailyReportSettings):
        self.store = store
        self.monitor_settings = monitor_settings
        self.settings = settings

    def daily_window(
        self,
        report_date: Optional[dt.date] = None,
        now: Optional[dt.datetime] = None,
    ) -> Tuple[dt.date, dt.datetime, dt.datetime]:
        local_now = (now or _now_utc()).astimezone(self.settings.timezone)
        cutoff_today = local_now.replace(
            hour=self.settings.cutoff_hour, minute=0, second=0, microsecond=0
        )
        chosen_date = report_date
        if chosen_date is None:
            chosen_date = local_now.date() if local_now >= cutoff_today else local_now.date() - dt.timedelta(days=1)
        end_local = dt.datetime.combine(
            chosen_date,
            dt.time(hour=self.settings.cutoff_hour),
            tzinfo=self.settings.timezone,
        )
        start_local = end_local - dt.timedelta(days=1)
        return chosen_date, start_local.astimezone(dt.timezone.utc), end_local.astimezone(dt.timezone.utc)

    def build_daily(
        self,
        report_date: Optional[dt.date] = None,
        now: Optional[dt.datetime] = None,
    ) -> Dict[str, Any]:
        chosen_date, start, end = self.daily_window(report_date, now)
        return self.build_window(chosen_date.isoformat(), start, end, "daily", now=now)

    def build_preview(self, now: Optional[dt.datetime] = None) -> Dict[str, Any]:
        latest = self.store.latest()
        end = _parse_iso((latest or {}).get("observed_at")) or (now or _now_utc())
        start = end - dt.timedelta(days=1)
        return self.build_window("preview", start, end, "preview", now=now)

    def build_live(self, now: Optional[dt.datetime] = None) -> Dict[str, Any]:
        """Build a current decision report from the latest complete evidence receipt.

        A live report answers "is the current evidence complete?" It deliberately does
        not pretend that missing historical five-minute samples can be reconstructed.
        """
        latest = self.store.latest()
        end = _parse_iso((latest or {}).get("observed_at")) or (now or _now_utc())
        start = end - dt.timedelta(days=1)
        return self.build_window("live", start, end, "live", now=now)

    def build_window(
        self,
        report_id: str,
        start: dt.datetime,
        end: dt.datetime,
        kind: str,
        now: Optional[dt.datetime] = None,
    ) -> Dict[str, Any]:
        snapshots = self.store.between(_iso(start), _iso(end), limit=50_000)
        snapshots = sorted(
            snapshots,
            key=lambda item: _parse_iso(item.get("observed_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),
        )
        events: List[Dict[str, Any]] = []
        if hasattr(self.store, "events_between"):
            events = self.store.events_between(_iso(start), _iso(end), limit=20_000)

        generated = now or _now_utc()
        local_start = start.astimezone(self.settings.timezone)
        local_end = end.astimezone(self.settings.timezone)
        history_continuity = self._history_coverage(snapshots, start, end)
        latest = snapshots[-1] if snapshots else None
        first = snapshots[0] if snapshots else None
        coverage = (
            self._live_evidence_coverage(latest, end, history_continuity)
            if kind == "live"
            else history_continuity
        )
        raw_action = _nested(latest or {}, "analysis", "action", default="UNKNOWN")
        published_action = self._published_action(raw_action, coverage, latest)
        target = self._target_summary(first, latest, snapshots)
        cliffs = self._cliff_summary(latest)
        attention = self._attention_summary(first, latest, snapshots)
        narrative = self._narrative_summary(first, latest)
        state_summary = self._state_summary(snapshots, events)
        changes = self._material_changes(
            first,
            latest,
            target,
            cliffs,
            attention,
            narrative,
            coverage,
        )
        watchlist = self._watchlist(coverage, cliffs, attention, narrative)
        posts = self._live_posts(latest)
        sources = self._sources(latest)
        headline = self._headline(published_action, coverage, cliffs, attention, narrative)

        return {
            "schema_version": 2,
            "report_id": report_id,
            "kind": kind,
            "title": "Cash Cat 投资判断日报",
            "subtitle": "只看投资前提是否成立，不看浮盈浮亏",
            "generated_at": _iso(generated),
            "window": {
                "timezone": self.settings.timezone_name,
                "start_at": _iso(start),
                "end_at": _iso(end),
                "start_label": local_start.strftime("%m月%d日 %H:%M"),
                "end_label": local_end.strftime("%m月%d日 %H:%M"),
                "date_label": local_end.strftime("%Y年%m月%d日"),
            },
            "verdict": {
                "action": published_action,
                "label": ACTION_LABELS.get(published_action, "暂停判断"),
                "tone": ACTION_TONES.get(published_action, "muted"),
                "raw_monitor_action": raw_action,
                "headline": headline,
                "financial_execution": "DISABLED",
            },
            "coverage": coverage,
            "history_continuity": history_continuity,
            "target": target,
            "four_cliffs": cliffs,
            "attention": attention,
            "narrative": narrative,
            "state_summary": state_summary,
            "top_changes": changes,
            "watchlist": watchlist,
            "live_posts": posts,
            "sources": sources,
            "artifacts": {
                "evidence_url": f"/reports/{quote(report_id)}",
                "card_url": f"/reports/{quote(report_id)}/card",
                "api_url": f"/api/reports/{quote(report_id)}",
                "png": {"status": "PENDING"},
            },
            "disclaimer": "本报告只做实盘事实整理与条件判断，不构成投资建议，也不会自动交易。",
        }

    def _history_coverage(
        self,
        snapshots: Sequence[Dict[str, Any]],
        start: dt.datetime,
        end: dt.datetime,
    ) -> Dict[str, Any]:
        poll_seconds = max(1, int(getattr(self.monitor_settings, "poll_seconds", 300)))
        seconds = max(1.0, (end - start).total_seconds())
        expected_points = max(1, math.ceil(seconds / poll_seconds))
        observed_points = len(snapshots)
        point_ratio = min(1.0, observed_points / expected_points)
        onchain_ok = sum(
            1 for item in snapshots if _nested(item, "collection", "data_health") == "OK"
        )
        twitter_ok = sum(
            1 for item in snapshots if _nested(item, "twitter", "status") == "OK"
        )
        onchain_ratio = onchain_ok / observed_points if observed_points else 0.0
        twitter_ratio = twitter_ok / observed_points if observed_points else 0.0
        latest_at = _parse_iso((snapshots[-1] if snapshots else {}).get("observed_at"))
        latest_age = (end - latest_at).total_seconds() if latest_at else None
        fresh = latest_age is not None and -poll_seconds <= latest_age <= poll_seconds * 2.5

        timestamps = [
            parsed
            for parsed in (_parse_iso(item.get("observed_at")) for item in snapshots)
            if parsed is not None
        ]
        boundaries = [start, *timestamps, end]
        largest_gap = max(
            ((right - left).total_seconds() for left, right in zip(boundaries, boundaries[1:])),
            default=seconds,
        )
        reasons: List[str] = []
        minimum = self.settings.minimum_coverage
        if point_ratio < minimum:
            reasons.append("24小时实盘覆盖不足")
        if onchain_ratio < minimum:
            reasons.append("链上数据存在缺口")
        if twitter_ratio < minimum:
            reasons.append("X 实时数据存在缺口")
        if not fresh:
            reasons.append("窗口结束时数据不新鲜")
        complete = not reasons
        return {
            "contract": "history_continuity",
            "status": "COMPLETE" if complete else ("EMPTY" if not snapshots else "PARTIAL"),
            "label": "覆盖完整" if complete else ("暂无数据" if not snapshots else "覆盖不足"),
            "complete": complete,
            "minimum_ratio": minimum,
            "expected_points": expected_points,
            "observed_points": observed_points,
            "ratio": round(point_ratio, 4),
            "onchain_ok_ratio": round(onchain_ratio, 4),
            "twitter_ok_ratio": round(twitter_ratio, 4),
            "latest_fresh": fresh,
            "latest_observed_at": _iso(latest_at) if latest_at else None,
            "largest_gap_minutes": round(largest_gap / 60, 1),
            "reasons": reasons,
        }

    def _live_evidence_coverage(
        self,
        latest: Optional[Dict[str, Any]],
        end: dt.datetime,
        history_continuity: Dict[str, Any],
    ) -> Dict[str, Any]:
        poll_seconds = max(1, int(getattr(self.monitor_settings, "poll_seconds", 300)))
        latest_at = _parse_iso((latest or {}).get("observed_at"))
        latest_age = (end - latest_at).total_seconds() if latest_at else None
        fresh = latest_age is not None and -poll_seconds <= latest_age <= poll_seconds * 2.5
        collection = (latest or {}).get("collection") or {}
        target = collection.get("target") or {}
        volumes = target.get("volumes") or {}
        leader = _nested(latest or {}, "analysis", "leader", default={}) or {}
        dimensions = leader.get("dimensions") or {}
        attention = _nested(latest or {}, "analysis", "attention", default={}) or {}
        robinhood_share = _nested(
            attention, "chain_shares", "robinhood", default={}
        ) or {}
        twitter = (latest or {}).get("twitter") or {}
        feeds = twitter.get("feeds") or {}
        narrative = _nested(latest or {}, "analysis", "narrative", default={}) or {}
        narrative_evidence = narrative.get("evidence") or {}
        price_history = collection.get("price_history_24h") or {}
        liquidity_scope = target.get("liquidity_scope") or {}
        liquidity_crosscheck = (
            target.get("liquidity_crosscheck")
            or collection.get("liquidity_crosscheck")
            or {}
        )

        current_market_complete = all(
            [
                collection.get("data_health") == "OK",
                fresh,
                (_number(target.get("price")) or 0) > 0,
                (_number(target.get("market_cap")) or 0) > 0,
                (_number(target.get("liquidity")) or 0) > 0,
                (_number(target.get("holder_count")) or 0) > 0,
                all((_number(volumes.get(window)) or 0) > 0 for window in VOLUME_WINDOWS),
            ]
        )
        kline_complete = all(
            [
                int(price_history.get("candle_count") or 0) >= 20,
                (_number(price_history.get("open")) or 0) > 0,
                (_number(price_history.get("close")) or 0) > 0,
                (_number(price_history.get("high")) or 0) > 0,
                (_number(price_history.get("low")) or 0) > 0,
                (_number(price_history.get("total_volume_usd")) or 0) > 0,
            ]
        )
        liquidity_scope_complete = all(
            [
                liquidity_scope.get("label") == "GMGN 最大主池",
                bool(liquidity_scope.get("pool_address")),
                liquidity_crosscheck.get("status") == "OK",
                int(liquidity_crosscheck.get("pool_count") or 0) > 0,
                (_number(liquidity_crosscheck.get("top5_liquidity_usd")) or 0) > 0,
                (_number(liquidity_crosscheck.get("all_pools_liquidity_usd")) or 0) > 0,
            ]
        )

        def comparable_dimension(key: str) -> bool:
            item = dimensions.get(key) or {}
            peer = item.get("peer") or {}
            return all(
                [
                    item.get("state") not in (None, "UNKNOWN"),
                    item.get("rank") is not None,
                    _number(item.get("ratio")) is not None,
                    (_number(item.get("target_value")) or 0) > 0,
                    bool(peer.get("symbol")),
                    (_number(peer.get("value")) or 0) > 0,
                ]
            )

        volume_dimension = dimensions.get("multi_window_volume") or {}
        volume_windows = volume_dimension.get("windows") or {}
        peer_comparison_complete = all(
            [
                comparable_dimension("market_cap"),
                comparable_dimension("liquidity"),
                comparable_dimension("holder_count"),
                volume_dimension.get("state") not in (None, "UNKNOWN"),
                all(
                    window in volume_windows
                    and volume_windows[window].get("state") not in (None, "UNKNOWN")
                    and _number(volume_windows[window].get("ratio")) is not None
                    and (_number(volume_windows[window].get("target_value")) or 0) > 0
                    and bool((volume_windows[window].get("peer") or {}).get("symbol"))
                    and (_number((volume_windows[window].get("peer") or {}).get("value")) or 0)
                    > 0
                    for window in VOLUME_WINDOWS
                ),
            ]
        )
        attention_complete = all(
            [
                attention.get("state") not in (None, "UNKNOWN"),
                _number(robinhood_share.get("attention")) is not None,
                _number(robinhood_share.get("activity")) is not None,
            ]
        )
        x_live_complete = all(
            [
                twitter.get("status") == "OK",
                fresh,
                all((feeds.get(key) or {}).get("status") == "OK" for key in (
                    "official",
                    "founder",
                    "ecosystem",
                    "cashcat",
                    "robinhood",
                    "external",
                )),
            ]
        )

        def narrative_complete(key: str, allow_no_source: bool = False) -> bool:
            item = narrative_evidence.get(key) or {}
            source_ok = bool(item.get("source_url")) or (
                allow_no_source and item.get("state") == "none"
            )
            return bool(
                item.get("state") not in (None, "unknown")
                and item.get("fresh")
                and item.get("observed_at")
                and source_ok
            )

        checks = [
            {
                "key": "gmgn_current",
                "label": "Cash Cat 当前链上数据",
                "complete": current_market_complete,
                "detail": "价格、市值、GMGN 最大主池、四个成交周期与持币地址",
            },
            {
                "key": "liquidity_scope",
                "label": "流动性多池口径核对",
                "complete": liquidity_scope_complete,
                "detail": (
                    f"已核对 {int(liquidity_crosscheck.get('pool_count') or 0)} 个"
                    " DEX Screener 索引池"
                ),
            },
            {
                "key": "gmgn_kline",
                "label": "过去24小时价格轨迹",
                "complete": kline_complete,
                "detail": f"{int(price_history.get('candle_count') or 0)} 根 GMGN 1小时K线",
            },
            {
                "key": "peer_comparison",
                "label": "四项龙头对手比较",
                "complete": peer_comparison_complete,
                "detail": "Cash Cat、最强对手、倍数、名次与四个成交周期",
            },
            {
                "key": "chain_attention",
                "label": "Robinhood Chain 跨链热度",
                "complete": attention_complete,
                "detail": "关注份额、成交活跃份额与热搜位置",
            },
            {
                "key": "x_live",
                "label": "X 六路实时检索",
                "complete": x_live_complete,
                "detail": "公司与负责人、创始人立场、生态伙伴、Cash Cat、链与外部热点",
            },
            {
                "key": "founder",
                "label": "创始人态度原帖",
                "complete": narrative_complete("founder_support"),
                "detail": "有时间、原帖链接与明确立场",
            },
            {
                "key": "mainstream",
                "label": "主流讨论度证据",
                "complete": narrative_complete("mainstream_attention"),
                "detail": "有实时检索计数、作者数与代表原帖",
            },
            {
                "key": "external_hotspot",
                "label": "外部新热点排查",
                "complete": narrative_complete("external_hotspot", allow_no_source=True),
                "detail": "有候选筛查结果；未发现也保留检索回执",
            },
        ]
        confirmed = sum(1 for item in checks if item["complete"])
        total = len(checks)
        ratio = confirmed / total if total else 0.0
        reasons = [f"{item['label']}未完整" for item in checks if not item["complete"]]
        complete = confirmed == total
        return {
            "contract": "live_evidence",
            "status": "COMPLETE" if complete else ("EMPTY" if not latest else "PARTIAL"),
            "label": "当前证据齐全" if complete else ("暂无数据" if not latest else "当前证据有缺口"),
            "complete": complete,
            "minimum_ratio": 1.0,
            "expected_points": total,
            "observed_points": confirmed,
            "ratio": round(ratio, 4),
            "onchain_ok_ratio": 1.0 if collection.get("data_health") == "OK" else 0.0,
            "twitter_ok_ratio": 1.0 if twitter.get("status") == "OK" else 0.0,
            "latest_fresh": fresh,
            "latest_observed_at": _iso(latest_at) if latest_at else None,
            "largest_gap_minutes": history_continuity.get("largest_gap_minutes"),
            "checks": checks,
            "reasons": reasons,
        }

    def _published_action(
        self,
        raw_action: str,
        coverage: Dict[str, Any],
        latest: Optional[Dict[str, Any]],
    ) -> str:
        latest_onchain_ok = _nested(latest or {}, "collection", "data_health") == "OK"
        latest_twitter_ok = _nested(latest or {}, "twitter", "status") == "OK"
        # A fresh, explicit exit gate is never hidden by earlier gaps. Positive conclusions
        # remain paused until the complete 24-hour observation contract is met.
        if (
            raw_action == "EXIT"
            and coverage.get("latest_fresh")
            and latest_onchain_ok
            and latest_twitter_ok
        ):
            return "EXIT"
        if not coverage.get("complete"):
            return "PAUSE"
        return raw_action if raw_action in ACTION_LABELS else "PAUSE"

    @staticmethod
    def _target(snapshot: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        return _nested(snapshot or {}, "collection", "target", default={}) or {}

    def _target_summary(
        self,
        first: Optional[Dict[str, Any]],
        latest: Optional[Dict[str, Any]],
        snapshots: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        first_target = self._target(first)
        latest_target = self._target(latest)
        metric_paths = {
            "market_cap": ("市值", lambda target: target.get("market_cap")),
            "liquidity": ("GMGN 主池流动性", lambda target: target.get("liquidity")),
            "volume_24h": ("24小时成交量", lambda target: _nested(target, "volumes", "24h")),
            "holders": ("持币地址", lambda target: target.get("holder_count")),
        }
        metrics: Dict[str, Any] = {}
        for key, (label, getter) in metric_paths.items():
            values = [
                number
                for number in (_number(getter(self._target(item))) for item in snapshots)
                if number is not None
            ]
            start_value = _number(getter(first_target))
            current_value = _number(getter(latest_target))
            metrics[key] = {
                "label": label,
                "start": start_value,
                "current": current_value,
                "change_percent": _percent_change(start_value, current_value),
                "low": min(values) if values else None,
                "high": max(values) if values else None,
                "median": statistics.median(values) if values else None,
            }
        liquidity_scope = latest_target.get("liquidity_scope") or {}
        liquidity_crosscheck = (
            latest_target.get("liquidity_crosscheck")
            or _nested(
                latest or {},
                "collection",
                "liquidity_crosscheck",
                default={},
            )
            or {}
        )
        return {
            "symbol": latest_target.get("symbol") or getattr(self.monitor_settings, "target_symbol", "CASHCAT"),
            "name": latest_target.get("name") or "Cash Cat",
            "address": latest_target.get("address") or getattr(self.monitor_settings, "target_address", ""),
            "chain": _nested(latest or {}, "collection", "chain", default="robinhood"),
            "current_price": _number(latest_target.get("price")),
            "price_24h": _nested(
                latest or {}, "collection", "price_history_24h", default={}
            )
            or {},
            "metrics": metrics,
            "liquidity_context": {
                "comparison_label": liquidity_scope.get("label") or "GMGN 最大主池",
                "comparison_note": (
                    "四项断崖比较统一使用 GMGN 最大主池口径；"
                    "多池合计只用于解释钱包与聚合器显示差异。"
                ),
                "main_pool_usd": _number(latest_target.get("liquidity")),
                "main_pool_address": liquidity_scope.get("pool_address"),
                "pair": liquidity_scope.get("pair"),
                "venue": liquidity_scope.get("venue"),
                "crosscheck_status": liquidity_crosscheck.get("status") or "UNKNOWN",
                "crosscheck_observed_at": liquidity_crosscheck.get("observed_at"),
                "crosscheck_source_url": liquidity_crosscheck.get("source_url"),
                "indexed_pool_count": int(liquidity_crosscheck.get("pool_count") or 0),
                "same_main_pool_usd": _number(
                    liquidity_crosscheck.get("same_main_pool_liquidity_usd")
                ),
                "top5_pools_usd": _number(
                    liquidity_crosscheck.get("top5_liquidity_usd")
                ),
                "all_indexed_pools_usd": _number(
                    liquidity_crosscheck.get("all_pools_liquidity_usd")
                ),
            },
            "safety": _nested(latest or {}, "collection", "safety", default={}) or {},
        }

    def _cliff_summary(self, latest: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        leader = _nested(latest or {}, "analysis", "leader", default={}) or {}
        dimensions = leader.get("dimensions") or {}
        definitions = [
            (
                "market_cap",
                "市值",
                "市值是否显著甩开第二名",
                getattr(self.monitor_settings, "market_cap_cliff", 1.5),
            ),
            (
                "liquidity",
                "GMGN 主池流动性",
                "按 GMGN 最大主池同口径比较承接能力；多池合计另行披露",
                getattr(self.monitor_settings, "liquidity_cliff", 1.5),
            ),
            (
                "multi_window_volume",
                "多周期成交量",
                "5分钟到24小时是否持续有对手盘",
                getattr(self.monitor_settings, "volume_cliff", 1.3),
            ),
            (
                "holder_count",
                "持币地址",
                "用户共识是否形成数量级优势",
                getattr(self.monitor_settings, "holders_cliff", 1.5),
            ),
        ]
        items: List[Dict[str, Any]] = []
        for key, label, explanation, threshold in definitions:
            data = dimensions.get(key) or {}
            state = str(data.get("state") or "UNKNOWN")
            item: Dict[str, Any] = {
                "key": key,
                "label": label,
                "explanation": explanation,
                "state": state,
                "state_label": {
                    "CLIFF": "断崖领先",
                    "LEAD": "领先但不够断崖",
                    "CHALLENGED": "受到挑战",
                    "UNKNOWN": "数据不足",
                }.get(state, "未达断崖"),
                "is_cliff": state == "CLIFF",
                "ratio": _round(data.get("ratio")),
                "rank": data.get("rank"),
                "threshold": _round(threshold),
                "target_value": _number(data.get("target_value")),
                "peer": data.get("peer") or {},
                "top3": data.get("top3") or [],
                "target_ranking": data.get("target_ranking") or {},
            }
            if key == "multi_window_volume":
                item.update(
                    {
                        "leading_windows": data.get("leading_windows"),
                        "required_leading_windows": data.get("required_leading_windows"),
                        "geometric_ratio": _round(data.get("geometric_ratio")),
                        "windows": [
                            {
                                "window": window,
                                "state": window_data.get("state"),
                                "ratio": _round(window_data.get("ratio")),
                                "rank": window_data.get("rank"),
                                "target_value": _number(window_data.get("target_value")),
                                "peer": window_data.get("peer") or {},
                                "top3": window_data.get("top3") or [],
                                "target_ranking": window_data.get("target_ranking") or {},
                            }
                            for window in VOLUME_WINDOWS
                            for window_data in [(data.get("windows") or {}).get(window) or {}]
                        ],
                    }
                )
            items.append(item)
        return {
            "state": leader.get("state") or "UNKNOWN",
            "label": LEADER_LABELS.get(leader.get("state"), "数据不足"),
            "cliff_count": int(leader.get("cliff_count") or 0),
            "eligible_peer_count": int(leader.get("eligible_peer_count") or 0),
            "items": items,
        }

    def _attention_summary(
        self,
        first: Optional[Dict[str, Any]],
        latest: Optional[Dict[str, Any]],
        snapshots: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        first_data = _nested(first or {}, "analysis", "attention", default={}) or {}
        current = _nested(latest or {}, "analysis", "attention", default={}) or {}
        current_robinhood = _nested(current, "chain_shares", "robinhood", default={}) or {}
        first_robinhood = _nested(first_data, "chain_shares", "robinhood", default={}) or {}
        attention_values = [
            value
            for value in (
                _number(_nested(item, "analysis", "attention", "chain_shares", "robinhood", "attention"))
                for item in snapshots
            )
            if value is not None
        ]
        activity_values = [
            value
            for value in (
                _number(_nested(item, "analysis", "attention", "chain_shares", "robinhood", "activity"))
                for item in snapshots
            )
            if value is not None
        ]
        state = current.get("state") or "UNKNOWN"
        return {
            "state": state,
            "label": ATTENTION_LABELS.get(state, "热度数据不足"),
            "robinhood_attention_share": _round(current_robinhood.get("attention")),
            "robinhood_activity_share": _round(current_robinhood.get("activity")),
            "attention_change_percent": _percent_change(
                first_robinhood.get("attention"), current_robinhood.get("attention")
            ),
            "activity_change_percent": _percent_change(
                first_robinhood.get("activity"), current_robinhood.get("activity")
            ),
            "attention_low": min(attention_values) if attention_values else None,
            "attention_high": max(attention_values) if attention_values else None,
            "activity_low": min(activity_values) if activity_values else None,
            "activity_high": max(activity_values) if activity_values else None,
            "target_hot_rank": current.get("target_hot_rank"),
            "target_attention_share": _round(current.get("target_attention_share")),
            "target_attention_state": current.get("target_attention_state"),
            "versus_attention_baseline": _round(current.get("robinhood_attention_vs_baseline")),
            "versus_activity_baseline": _round(current.get("robinhood_activity_vs_baseline")),
            "fastest_external_chain": current.get("fastest_external_chain"),
            "fastest_external_growth": _round(current.get("fastest_external_attention_growth")),
        }

    def _narrative_summary(
        self,
        first: Optional[Dict[str, Any]],
        latest: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        first_state = _nested(first or {}, "analysis", "narrative", "state", default="UNKNOWN")
        narrative = _nested(latest or {}, "analysis", "narrative", default={}) or {}
        evidence = narrative.get("evidence") or {}
        definitions = [
            ("founder_support", "创始人态度"),
            ("mainstream_attention", "主流讨论度"),
            ("external_hotspot", "外部新热点"),
        ]
        items = []
        for key, label in definitions:
            item = evidence.get(key) or {}
            tweet = item.get("tweet") or {}
            items.append(
                {
                    "key": key,
                    "label": label,
                    "state": item.get("state") or "unknown",
                    "observed_at": item.get("observed_at"),
                    "fresh": item.get("fresh"),
                    "note": _compact_text(item.get("note"), 220),
                    "source_url": item.get("source_url") or tweet.get("url"),
                    "name": item.get("name"),
                    "author": tweet.get("author_name") or tweet.get("author_username"),
                    "post_text": _compact_text(tweet.get("text"), 220),
                    "engagement": tweet.get("engagement"),
                }
            )
        state = narrative.get("state") or "UNKNOWN"
        account_security = _nested(
            latest or {},
            "twitter",
            "official_account_security",
            default={},
        ) or {}
        return {
            "state": state,
            "previous_state": first_state,
            "label": NARRATIVE_LABELS.get(state, "舆情证据不足"),
            "exit_reasons": narrative.get("exit_reasons") or [],
            "evidence": items,
            "account_security": {
                "state": account_security.get("state") or "NO_ALERT",
                "note": _compact_text(account_security.get("note"), 240),
                "observed_at": account_security.get("observed_at"),
                "source_url": account_security.get("source_url"),
            },
        }

    @staticmethod
    def _state_summary(
        snapshots: Sequence[Dict[str, Any]],
        events: Sequence[Dict[str, Any]],
    ) -> Dict[str, Any]:
        counts: Dict[str, int] = {}
        for item in snapshots:
            action = _nested(item, "analysis", "action", default="UNKNOWN")
            counts[action] = counts.get(action, 0) + 1
        total = len(snapshots)
        distribution = [
            {
                "action": action,
                "label": ACTION_LABELS.get(action, action),
                "count": count,
                "ratio": round(count / total, 4) if total else 0,
            }
            for action, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
        ]
        return {
            "distribution": distribution,
            "transition_count": len(events),
            "transitions": [
                {
                    "observed_at": event.get("observed_at"),
                    "from": event.get("previous_action"),
                    "from_label": ACTION_LABELS.get(event.get("previous_action"), "开始监控"),
                    "to": event.get("new_action"),
                    "to_label": ACTION_LABELS.get(event.get("new_action"), "暂停判断"),
                }
                for event in events[-10:]
            ],
        }

    def _material_changes(
        self,
        first: Optional[Dict[str, Any]],
        latest: Optional[Dict[str, Any]],
        target: Dict[str, Any],
        cliffs: Dict[str, Any],
        attention: Dict[str, Any],
        narrative: Dict[str, Any],
        coverage: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        candidates: List[Tuple[int, Dict[str, Any]]] = []

        def add(priority: int, title: str, detail: str, tone: str = "neutral") -> None:
            candidates.append((priority, {"title": title, "detail": detail, "tone": tone}))

        if not coverage.get("complete"):
            if coverage.get("contract") == "live_evidence":
                add(
                    100,
                    "当前证据仍有缺口",
                    f"八类判断证据已确认 {coverage.get('observed_points', 0)}/{coverage.get('expected_points', 0)}；缺失项补齐前暂停判断。",
                    "warning",
                )
            else:
                add(
                    100,
                    "历史连续性不足",
                    f"仅取得 {coverage.get('observed_points', 0)}/{coverage.get('expected_points', 0)} 个实盘采样点，本期不输出强持有结论。",
                    "warning",
                )

        first_action = _nested(first or {}, "analysis", "action", default="UNKNOWN")
        latest_action = _nested(latest or {}, "analysis", "action", default="UNKNOWN")
        if first and latest and first_action != latest_action:
            add(
                95,
                "监控状态发生切换",
                f"从“{ACTION_LABELS.get(first_action, first_action)}”变为“{ACTION_LABELS.get(latest_action, latest_action)}”。",
                "danger" if latest_action in {"EXIT", "EXIT_CANDIDATE"} else "neutral",
            )

        first_leader = _nested(first or {}, "analysis", "leader", "state", default="UNKNOWN")
        current_leader = cliffs.get("state")
        if first and latest and first_leader != current_leader:
            add(
                88,
                "龙头结构发生变化",
                f"从“{LEADER_LABELS.get(first_leader, first_leader)}”变为“{cliffs.get('label')}”。",
                "warning",
            )

        first_attention = _nested(first or {}, "analysis", "attention", "state", default="UNKNOWN")
        if first and latest and first_attention != attention.get("state"):
            add(
                86,
                "链上热度状态变化",
                f"从“{ATTENTION_LABELS.get(first_attention, first_attention)}”变为“{attention.get('label')}”。",
                "warning" if attention.get("state") in {"DIVERTED", "DIVERSION_CANDIDATE"} else "neutral",
            )

        if first and latest and narrative.get("previous_state") != narrative.get("state"):
            add(
                84,
                "叙事证据状态变化",
                f"从“{NARRATIVE_LABELS.get(narrative.get('previous_state'), narrative.get('previous_state'))}”变为“{narrative.get('label')}”。",
                "warning",
            )

        for key in ("market_cap", "liquidity", "volume_24h", "holders"):
            metric = _nested(target, "metrics", key, default={}) or {}
            change = _number(metric.get("change_percent"))
            if change is not None and abs(change) >= 15:
                direction = "上升" if change > 0 else "下降"
                add(
                    65 + min(15, int(abs(change) // 10)),
                    f"{metric.get('label')}明显{direction}",
                    f"窗口内从起点到终点变动 {change:+.1f}%。",
                    "positive" if change > 0 else "warning",
                )

        non_cliff = [item for item in cliffs.get("items", []) if not item.get("is_cliff")]
        if non_cliff:
            names = "、".join(item.get("label", "") for item in non_cliff)
            add(
                70,
                "四项断崖尚未全部成立",
                f"当前未达断崖标准：{names}。龙头成立不等于优势已经足够宽。",
                "warning",
            )

        if not candidates:
            add(10, "没有跨过关键阈值", "本窗口没有出现需要改变投资前提的显著变化。")

        candidates.sort(key=lambda item: -item[0])
        return [item for _, item in candidates[:3]]

    @staticmethod
    def _watchlist(
        coverage: Dict[str, Any],
        cliffs: Dict[str, Any],
        attention: Dict[str, Any],
        narrative: Dict[str, Any],
    ) -> List[Dict[str, str]]:
        items: List[Dict[str, str]] = []
        if not coverage.get("complete"):
            if coverage.get("contract") == "live_evidence":
                items.append(
                    {
                        "title": "补齐当前判断证据",
                        "trigger": "把页面标出的缺失证据抓全后，才恢复当前判断。",
                    }
                )
            else:
                items.append(
                    {
                        "title": "补齐24小时实盘连续性",
                        "trigger": f"采样覆盖达到 {coverage.get('minimum_ratio', 0.9):.0%} 以上后，才恢复历史趋势结论。",
                    }
                )
        missing = [item for item in cliffs.get("items", []) if not item.get("is_cliff")]
        if missing:
            items.append(
                {
                    "title": "盯住龙头优势宽度",
                    "trigger": "、".join(item.get("label", "") for item in missing) + "仍未形成断崖。",
                }
            )
        if attention.get("state") in {"WEAKENING", "DIVERSION_CANDIDATE", "DIVERTED"}:
            items.append(
                {
                    "title": "Robinhood Chain 热度转弱",
                    "trigger": f"重点观察 {attention.get('fastest_external_chain') or '其他链'} 是否进一步吸走关注和成交。",
                }
            )
        else:
            items.append(
                {
                    "title": "Robinhood Chain 热度",
                    "trigger": "一旦关注份额与成交份额同时持续下滑，投资前提开始松动。",
                }
            )
        if narrative.get("state") in {"EXIT", "EXIT_CANDIDATE", "WATCH", "UNKNOWN"}:
            items.append(
                {
                    "title": "官方、负责人和主流讨论",
                    "trigger": "创始人转为反对 meme，负责人停止推进，或链上 meme 退出主流讨论，触发离场审查。",
                }
            )
        return items[:3]

    @staticmethod
    def _live_posts(latest: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        feeds = _nested(latest or {}, "twitter", "feeds", default={}) or {}
        result: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for feed_key in (
            "official",
            "founder",
            "ecosystem",
            "cashcat",
            "robinhood",
            "external",
        ):
            feed = feeds.get(feed_key) or {}
            feed_added = 0
            for tweet in feed.get("tweets") or []:
                url = str(tweet.get("url") or "")
                if not url or url in seen:
                    continue
                seen.add(url)
                metrics = tweet.get("metrics") or {}
                result.append(
                    {
                        "feed": feed.get("label") or "X 实时讨论",
                        "url": url,
                        "author_username": tweet.get("author_username"),
                        "author_name": tweet.get("author_name") or tweet.get("author_username"),
                        "account_role": tweet.get("account_role"),
                        "verified": bool(tweet.get("verified")),
                        "created_at": tweet.get("created_at"),
                        "text": _compact_text(tweet.get("text"), 360),
                        "engagement": tweet.get("engagement"),
                        "views": metrics.get("views"),
                    }
                )
                feed_added += 1
                if len(result) >= 8:
                    return result
                if feed_added >= 2:
                    break
        return result

    @staticmethod
    def _sources(latest: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not latest:
            return []
        collection = latest.get("collection") or {}
        twitter = latest.get("twitter") or {}
        target = collection.get("target") or {}
        liquidity_crosscheck = (
            target.get("liquidity_crosscheck")
            or collection.get("liquidity_crosscheck")
            or {}
        )
        price_history = collection.get("price_history_24h") or {}
        feeds = twitter.get("feeds") or {}
        feed_receipts = []
        for key in (
            "official",
            "founder",
            "ecosystem",
            "cashcat",
            "robinhood",
            "external",
        ):
            feed = feeds.get(key) or {}
            feed_receipts.append(
                {
                    "label": feed.get("label") or key,
                    "status": feed.get("status") or "UNKNOWN",
                    "result_count": int(feed.get("result_count") or 0),
                    "credible_count": int(feed.get("credible_count") or 0),
                    "unique_authors": int(feed.get("unique_authors") or 0),
                    "window_hours": feed.get("window_hours"),
                    "query_type": feed.get("query_type"),
                }
            )
        return [
            {
                "label": "GMGN 链上实盘",
                "status": collection.get("data_health") or "UNKNOWN",
                "observed_at": latest.get("observed_at"),
                "receipt": "当前价格、四项指标、同链最强对手与过去24小时1小时K线",
                "facts": {
                    "price": _number(target.get("price")),
                    "market_cap": _number(target.get("market_cap")),
                    "liquidity": _number(target.get("liquidity")),
                    "volumes": target.get("volumes") or {},
                    "holder_count": _number(target.get("holder_count")),
                    "kline_candles": int(price_history.get("candle_count") or 0),
                    "kline_start_at": price_history.get("first_candle_at"),
                    "kline_end_at": price_history.get("last_candle_at"),
                    "kline_volume_usd": _number(price_history.get("total_volume_usd")),
                },
                "commands": collection.get("commands") or [],
            },
            {
                "label": "DEX Screener 多池核对",
                "status": liquidity_crosscheck.get("status") or "UNKNOWN",
                "observed_at": liquidity_crosscheck.get("observed_at"),
                "source_url": liquidity_crosscheck.get("source_url"),
                "receipt": (
                    f"核对 {int(liquidity_crosscheck.get('pool_count') or 0)} 个索引池；"
                    "用于解释钱包聚合流动性，不参与同链断崖排名"
                ),
                "facts": {
                    "same_main_pool_liquidity": _number(
                        liquidity_crosscheck.get("same_main_pool_liquidity_usd")
                    ),
                    "top5_liquidity": _number(
                        liquidity_crosscheck.get("top5_liquidity_usd")
                    ),
                    "all_pools_liquidity": _number(
                        liquidity_crosscheck.get("all_pools_liquidity_usd")
                    ),
                    "pool_count": int(liquidity_crosscheck.get("pool_count") or 0),
                },
            },
            {
                "label": "X 实时舆情",
                "status": twitter.get("status") or "UNKNOWN",
                "observed_at": twitter.get("observed_at"),
                "source_url": twitter.get("source_documentation"),
                "receipt": "公司与负责人、创始人立场、生态伙伴、Cash Cat、链及外部热点六路实时检索",
                "feeds": feed_receipts,
                "account_scope": twitter.get("account_scope") or [],
                "ecosystem_scope": twitter.get("ecosystem_scope") or [],
                "account_security": twitter.get("official_account_security") or {},
            },
        ]

    @staticmethod
    def _headline(
        action: str,
        coverage: Dict[str, Any],
        cliffs: Dict[str, Any],
        attention: Dict[str, Any],
        narrative: Dict[str, Any],
    ) -> str:
        if action == "PAUSE":
            if coverage.get("contract") == "live_evidence":
                return "当前实盘证据仍有缺口：先补齐标记项，再恢复判断。"
            return "历史连续性尚未达到完整日报门槛：先看事实，不给出强趋势结论。"
        if action == "EXIT":
            return "核心投资前提已经被破坏：优先处理离场，不用盈利比例替自己找理由。"
        if action == "EXIT_CANDIDATE":
            return "离场条件正在形成：缩短观察周期，等待持续确认。"
        if action == "HOLD":
            return "链热度、龙头优势与舆情前提同时成立：继续持有，盯住离场条件。"
        if cliffs.get("cliff_count", 0) < 4:
            return f"Cash Cat 仍是龙头，但只满足 {cliffs.get('cliff_count', 0)}/4 项断崖领先。"
        if attention.get("state") in {"WEAKENING", "DIVERSION_CANDIDATE", "DIVERTED"}:
            return "龙头结构仍在，但链上关注出现分流迹象：继续观察，不盲目加仓。"
        if narrative.get("state") not in {"CONFIRMED"}:
            return "链上数据尚可，但叙事证据不够稳：继续观察。"
        return "核心投资前提暂未被破坏：继续观察离场条件。"


class DailyReportArchive:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    @staticmethod
    def validate_id(report_id: str) -> str:
        if not REPORT_ID_PATTERN.fullmatch(report_id or ""):
            raise ValueError("invalid report id")
        return report_id

    def report_path(self, report_id: str) -> Path:
        return self.root / self.validate_id(report_id) / "report.json"

    def png_path(self, report_id: str) -> Path:
        return self.root / self.validate_id(report_id) / "card.png"

    def save(self, report: Dict[str, Any]) -> Path:
        path = self.report_path(str(report.get("report_id") or ""))
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        serialized = json.dumps(report, ensure_ascii=False, indent=2)
        with self.lock:
            temporary.write_text(serialized + "\n", encoding="utf-8")
            temporary.replace(path)
        return path

    def load(self, report_id: str) -> Dict[str, Any]:
        path = self.report_path(report_id)
        if not path.exists():
            raise FileNotFoundError(report_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> List[Dict[str, Any]]:
        reports: List[Dict[str, Any]] = []
        for path in self.root.glob("*/report.json"):
            try:
                report = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            reports.append(
                {
                    "report_id": report.get("report_id"),
                    "kind": report.get("kind"),
                    "generated_at": report.get("generated_at"),
                    "date_label": _nested(report, "window", "date_label"),
                    "verdict": report.get("verdict"),
                    "coverage": report.get("coverage"),
                    "artifacts": report.get("artifacts"),
                }
            )
        reports.sort(key=lambda item: item.get("generated_at") or "", reverse=True)
        return reports

    def latest(self) -> Dict[str, Any]:
        items = self.list()
        if not items:
            raise FileNotFoundError("latest")
        return self.load(str(items[0]["report_id"]))


class CardExporter:
    def __init__(self, settings: DailyReportSettings, archive: DailyReportArchive):
        self.settings = settings
        self.archive = archive

    def _find_chrome(self) -> Optional[str]:
        candidates = [
            self.settings.chrome_bin,
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            shutil.which("google-chrome") or "",
            shutil.which("chromium") or "",
            shutil.which("chromium-browser") or "",
        ]
        return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), None)

    def export(self, report_id: str) -> Dict[str, Any]:
        chrome = self._find_chrome()
        if not chrome:
            return {"status": "UNAVAILABLE", "reason": "未找到可用的 Chrome"}
        output = self.archive.png_path(report_id)
        output.parent.mkdir(parents=True, exist_ok=True)
        url = f"{self.settings.base_url.rstrip('/')}/reports/{quote(report_id)}/card?export=1"
        try:
            # Chrome otherwise leaves one scoped_dir profile (including large optimization
            # models) under HOME for every export. A private profile is both isolated and
            # deterministically removed after the one-shot screenshot.
            with tempfile.TemporaryDirectory(prefix="cashcat-chrome-") as profile_dir:
                command = [
                    chrome,
                    "--headless=new",
                    "--no-sandbox",
                    "--disable-gpu",
                    "--disable-dev-shm-usage",
                    "--hide-scrollbars",
                    "--force-device-scale-factor=1",
                    "--window-size=1080,1350",
                    "--virtual-time-budget=4000",
                    f"--user-data-dir={profile_dir}",
                    f"--screenshot={output}",
                    url,
                ]
                completed = subprocess.run(
                    command, capture_output=True, text=True, timeout=60, check=False
                )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {"status": "ERROR", "reason": f"{type(exc).__name__}: {exc}"}
        if completed.returncode != 0 or not output.exists() or output.stat().st_size < 1000:
            reason = _compact_text(completed.stderr or completed.stdout or "Chrome export failed", 300)
            return {"status": "ERROR", "reason": reason}
        return {
            "status": "READY",
            "path": str(output),
            "url": f"/api/reports/{quote(report_id)}/card.png",
            "bytes": output.stat().st_size,
            "width": 1080,
            "height": 1350,
        }


class DailyReportService:
    def __init__(
        self,
        builder: DailyReportBuilder,
        archive: DailyReportArchive,
        exporter: CardExporter,
        notifier: Optional[Any] = None,
    ):
        self.builder = builder
        self.archive = archive
        self.exporter = exporter
        self.notifier = notifier
        self.lock = threading.Lock()

    def generate_preview(self, export_png: Optional[bool] = None) -> Dict[str, Any]:
        return self._persist(self.builder.build_preview(), export_png=export_png, notify=False)

    def generate_live(self, export_png: Optional[bool] = None) -> Dict[str, Any]:
        return self._persist(self.builder.build_live(), export_png=export_png, notify=False)

    def generate_daily(
        self,
        report_date: Optional[dt.date] = None,
        export_png: Optional[bool] = None,
        notify: bool = False,
    ) -> Dict[str, Any]:
        return self._persist(
            self.builder.build_daily(report_date),
            export_png=export_png,
            notify=notify,
        )

    def generate_scheduled(self) -> Dict[str, Any]:
        return self.generate_daily(export_png=self.builder.settings.export_png, notify=True)

    def _persist(
        self,
        report: Dict[str, Any],
        export_png: Optional[bool],
        notify: bool,
    ) -> Dict[str, Any]:
        if not self.lock.acquire(blocking=False):
            return {"skipped": True, "reason": "report_generation_in_progress"}
        try:
            self.archive.save(report)
            should_export = self.builder.settings.export_png if export_png is None else export_png
            if should_export:
                report["artifacts"]["png"] = self.exporter.export(report["report_id"])
                self.archive.save(report)
            else:
                report["artifacts"]["png"] = {"status": "SKIPPED"}
                self.archive.save(report)
            if notify:
                self._notify(report)
            return report
        finally:
            self.lock.release()

    def _notify(self, report: Dict[str, Any]) -> bool:
        urls = str(getattr(self.notifier, "urls", "") or "").strip()
        if not urls:
            return False
        try:
            import apprise  # type: ignore
        except ImportError:
            return False
        service = apprise.Apprise()
        try:
            parsed_urls: Iterable[str] = json.loads(urls) if urls.startswith("[") else urls.splitlines()
        except json.JSONDecodeError:
            parsed_urls = [urls]
        for url in parsed_urls:
            if str(url).strip():
                service.add(str(url).strip())
        verdict = report.get("verdict") or {}
        report_url = f"{self.builder.settings.base_url.rstrip('/')}/reports/{quote(report['report_id'])}"
        return bool(
            service.notify(
                title=f"Cash Cat 日报：{verdict.get('label', '暂停判断')}",
                body=f"{verdict.get('headline', '')}\n证据页：{report_url}\n只读判断，不会自动交易。",
            )
        )


def build_report_service(
    store: Any,
    monitor_settings: Any,
    notifier: Optional[Any] = None,
    settings: Optional[DailyReportSettings] = None,
) -> DailyReportService:
    chosen = settings or DailyReportSettings()
    archive = DailyReportArchive(chosen.report_dir)
    builder = DailyReportBuilder(store, monitor_settings, chosen)
    return DailyReportService(builder, archive, CardExporter(chosen, archive), notifier)
