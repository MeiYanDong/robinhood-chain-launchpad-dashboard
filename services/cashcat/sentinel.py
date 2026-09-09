from __future__ import annotations

import datetime as dt
import json
import math
import os
import sqlite3
import statistics
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from twitter_live import (
    TwitterLiveClient,
    TwitterLiveCollector,
    compact_twitter_snapshot,
    evaluate_twitter_narrative,
    merge_live_and_manual_narrative,
)


APP_DIR = Path(__file__).resolve().parent
WINDOWS = ("5m", "1h", "6h", "24h")
TARGET_CHAIN = "robinhood"


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


def _number(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso(value: Optional[dt.datetime] = None) -> str:
    return (value or _utcnow()).isoformat(timespec="seconds")


def _parse_iso(value: Any) -> Optional[dt.datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


@dataclass(frozen=True)
class Settings:
    target_address: str = os.getenv(
        "CASHCAT_ADDRESS", "0x020bfc650a365f8bb26819deaabf3e21291018b4"
    ).lower()
    target_symbol: str = os.getenv("CASHCAT_SYMBOL", "CASHCAT")
    chain: str = TARGET_CHAIN
    poll_seconds: int = _env_int("CASHCAT_POLL_SECONDS", 300)
    rank_limit: int = _env_int("CASHCAT_RANK_LIMIT", 30)
    cli_timeout_seconds: int = _env_int("CASHCAT_CLI_TIMEOUT_SECONDS", 45)
    peer_market_cap_floor: float = _env_float("CASHCAT_PEER_MCAP_FLOOR", 250_000)
    peer_liquidity_floor: float = _env_float("CASHCAT_PEER_LIQ_FLOOR", 25_000)
    peer_relative_floor: float = _env_float("CASHCAT_PEER_RELATIVE_FLOOR", 0.01)
    peer_excluded_addresses: str = os.getenv("CASHCAT_PEER_EXCLUDED_ADDRESSES", "")
    market_cap_cliff: float = _env_float("CASHCAT_MCAP_CLIFF", 1.50)
    liquidity_cliff: float = _env_float("CASHCAT_LIQ_CLIFF", 1.50)
    holders_cliff: float = _env_float("CASHCAT_HOLDERS_CLIFF", 1.50)
    volume_cliff: float = _env_float("CASHCAT_VOLUME_CLIFF", 1.30)
    minimum_volume_lead_windows: int = _env_int("CASHCAT_VOLUME_LEAD_WINDOWS", 3)
    baseline_points: int = _env_int("CASHCAT_BASELINE_POINTS", 12)
    narrative_fresh_hours: int = _env_int("CASHCAT_NARRATIVE_FRESH_HOURS", 168)
    twitter_timeout_seconds: int = _env_int("CASHCAT_TWITTER_TIMEOUT_SECONDS", 30)
    twitter_min_request_interval_seconds: float = _env_float(
        "CASHCAT_TWITTER_MIN_REQUEST_INTERVAL_SECONDS", 5.2
    )
    liquidity_crosscheck_timeout_seconds: int = _env_int(
        "CASHCAT_LIQUIDITY_CROSSCHECK_TIMEOUT_SECONDS", 20
    )
    retention_days: int = _env_int("CASHCAT_RETENTION_DAYS", 30)
    db_path: Path = Path(
        os.getenv("CASHCAT_DB_PATH", str(APP_DIR / "outputs" / "cashcat-sentinel.db"))
    )
    narrative_path: Path = Path(
        os.getenv("CASHCAT_NARRATIVE_PATH", str(APP_DIR / "outputs" / "narrative.json"))
    )


class GMGNError(RuntimeError):
    pass


class LiquidityCrossCheckError(RuntimeError):
    pass


class DexScreenerLiquidityClient:
    """Best-effort, read-only all-pool liquidity cross-check.

    GMGN's token liquidity is the largest pool. DEX Screener exposes every indexed
    pool for the token, which lets the UI explain why an aggregator can show a
    larger number without changing the like-for-like GMGN peer ranking.
    """

    API_URL = (
        "https://api.dexscreener.com/token-pairs/v1/robinhood/"
        "{token_address}"
    )
    DOCS_URL = "https://docs.dexscreener.com/api/reference"

    def __init__(self, timeout_seconds: int = 20):
        self.timeout_seconds = max(1, int(timeout_seconds))

    def fetch(self, token_address: str, main_pool_address: str = "") -> Dict[str, Any]:
        url = self.API_URL.format(token_address=token_address.lower())
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "CashCat-Sentinel/0.4 read-only",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read(240).decode("utf-8", "replace")
            raise LiquidityCrossCheckError(
                f"DEX Screener HTTP {exc.code}: {detail}"
            ) from exc
        except (OSError, ValueError) as exc:
            raise LiquidityCrossCheckError(
                f"DEX Screener request failed: {exc}"
            ) from exc
        if not isinstance(payload, list):
            raise LiquidityCrossCheckError("DEX Screener returned a non-list payload")

        unique: Dict[str, Dict[str, Any]] = {}
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            pair_address = str(raw.get("pairAddress") or "").lower()
            liquidity = _number((raw.get("liquidity") or {}).get("usd"))
            if not pair_address or liquidity <= 0:
                continue
            base = raw.get("baseToken") or {}
            quote = raw.get("quoteToken") or {}
            labels = raw.get("labels") or []
            version = str(labels[0]) if labels else ""
            unique[pair_address] = {
                "pool_address": pair_address,
                "pair": "/".join(
                    part
                    for part in (
                        str(base.get("symbol") or ""),
                        str(quote.get("symbol") or ""),
                    )
                    if part
                ),
                "venue": " ".join(
                    part
                    for part in (str(raw.get("dexId") or ""), version)
                    if part
                ),
                "liquidity_usd": liquidity,
                "volume_24h_usd": _number((raw.get("volume") or {}).get("h24")),
                "price_usd": _number(raw.get("priceUsd")),
                "url": str(raw.get("url") or ""),
            }
        pools = sorted(
            unique.values(),
            key=lambda item: _number(item.get("liquidity_usd")),
            reverse=True,
        )
        main_address = main_pool_address.lower()
        same_main_pool = next(
            (item for item in pools if item.get("pool_address") == main_address),
            None,
        )
        return {
            "status": "OK",
            "source": "DEX Screener",
            "source_url": self.DOCS_URL,
            "observed_at": _iso(),
            "scope": "all_indexed_pools",
            "pool_count": len(pools),
            "top5_liquidity_usd": round(
                sum(_number(item.get("liquidity_usd")) for item in pools[:5]), 2
            ),
            "all_pools_liquidity_usd": round(
                sum(_number(item.get("liquidity_usd")) for item in pools), 2
            ),
            "same_main_pool_liquidity_usd": _number(
                (same_main_pool or {}).get("liquidity_usd")
            )
            or None,
            "pools": pools[:10],
        }


class GMGNClient:
    """Read-only, allow-listed gmgn-cli adapter.

    This class intentionally exposes no swap, order, portfolio-signing or cooking method.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self.env = dict(os.environ)
        node_options = self.env.get("NODE_OPTIONS", "")
        if "--use-system-ca" not in node_options:
            self.env["NODE_OPTIONS"] = (node_options + " --use-system-ca").strip()

    def check_config(self) -> None:
        result = subprocess.run(
            ["gmgn-cli", "config", "--check"],
            capture_output=True,
            text=True,
            timeout=self.settings.cli_timeout_seconds,
            env=self.env,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "gmgn-cli config check failed").strip()
            raise GMGNError(detail)

    def _run_json(self, args: List[str]) -> Any:
        allowed = {
            ("market", "kline"),
            ("market", "trending"),
            ("market", "hot-searches"),
            ("token", "info"),
            ("token", "security"),
        }
        if tuple(args[:2]) not in allowed:
            raise GMGNError("Blocked non-read-only gmgn-cli command")
        command = ["gmgn-cli"] + args
        if "--raw" not in command:
            command.append("--raw")
        started = time.monotonic()
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=self.settings.cli_timeout_seconds,
            env=self.env,
        )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "gmgn-cli failed").strip()
            raise GMGNError(f"{detail} (after {elapsed_ms}ms)")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise GMGNError(f"gmgn-cli returned invalid JSON: {exc}") from exc
        if isinstance(payload, dict) and payload.get("code") not in (None, 0):
            detail = payload.get("message") or payload.get("msg") or payload.get("error")
            raise GMGNError(f"gmgn-cli code={payload.get('code')}: {detail or 'unknown error'}")
        return payload

    def trending(self, interval: str, order_by: str) -> List[Dict[str, Any]]:
        payload = self._run_json(
            [
                "market",
                "trending",
                "--chain",
                self.settings.chain,
                "--interval",
                interval,
                "--order-by",
                order_by,
                "--direction",
                "desc",
                "--limit",
                str(self.settings.rank_limit),
            ]
        )
        data = payload.get("data", payload) if isinstance(payload, dict) else {}
        rows = data.get("rank") or data.get("tokens") or [] if isinstance(data, dict) else []
        return rows if isinstance(rows, list) else []

    def hot_searches(self) -> List[Dict[str, Any]]:
        payload = self._run_json(
            ["market", "hot-searches", "--interval", "24h", "--limit", str(self.settings.rank_limit)]
        )
        if isinstance(payload, dict):
            payload = payload.get("data") or []
        return payload if isinstance(payload, list) else []

    def kline_24h(self) -> Dict[str, Any]:
        end_at = int(time.time())
        start_at = end_at - 24 * 60 * 60
        payload = self._run_json(
            [
                "market",
                "kline",
                "--chain",
                self.settings.chain,
                "--address",
                self.settings.target_address,
                "--resolution",
                "1h",
                "--from",
                str(start_at),
                "--to",
                str(end_at),
            ]
        )
        rows = payload.get("list") if isinstance(payload, dict) else []
        candles = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            timestamp_ms = int(_number(row.get("time")))
            candles.append(
                {
                    "observed_at": _iso(
                        dt.datetime.fromtimestamp(timestamp_ms / 1000, tz=dt.timezone.utc)
                    )
                    if timestamp_ms > 0
                    else None,
                    "open": _number(row.get("open")),
                    "close": _number(row.get("close")),
                    "high": _number(row.get("high")),
                    "low": _number(row.get("low")),
                    # GMGN kline uses `volume` for USD value and `amount` for token units.
                    "volume_usd": _number(row.get("volume")),
                }
            )
        candles.sort(key=lambda item: item.get("observed_at") or "")
        valid = [
            item
            for item in candles
            if item["open"] > 0
            and item["close"] > 0
            and item["high"] > 0
            and item["low"] > 0
        ]
        first = valid[0] if valid else {}
        last = valid[-1] if valid else {}
        open_price = _number(first.get("open"))
        close_price = _number(last.get("close"))
        return {
            "source": "GMGN 1小时K线",
            "resolution": "1h",
            "requested_start_at": _iso(
                dt.datetime.fromtimestamp(start_at, tz=dt.timezone.utc)
            ),
            "requested_end_at": _iso(dt.datetime.fromtimestamp(end_at, tz=dt.timezone.utc)),
            "first_candle_at": first.get("observed_at"),
            "last_candle_at": last.get("observed_at"),
            "candle_count": len(valid),
            "open": open_price or None,
            "close": close_price or None,
            "high": max((_number(item.get("high")) for item in valid), default=0) or None,
            "low": min((_number(item.get("low")) for item in valid), default=0) or None,
            "change_percent": round((close_price / open_price - 1) * 100, 2)
            if open_price > 0 and close_price > 0
            else None,
            "total_volume_usd": round(
                sum(_number(item.get("volume_usd")) for item in valid), 6
            ),
            "candles": valid,
        }

    def token_info(self) -> Dict[str, Any]:
        payload = self._run_json(
            ["token", "info", "--chain", self.settings.chain, "--address", self.settings.target_address]
        )
        return payload if isinstance(payload, dict) else {}

    def token_security(self) -> Dict[str, Any]:
        payload = self._run_json(
            [
                "token",
                "security",
                "--chain",
                self.settings.chain,
                "--address",
                self.settings.target_address,
            ]
        )
        return payload if isinstance(payload, dict) else {}


def _empty_token(address: str, symbol: str = "") -> Dict[str, Any]:
    return {
        "address": address.lower(),
        "symbol": symbol,
        "name": "",
        "launchpad_platform": "",
        "market_cap": 0.0,
        "liquidity": 0.0,
        "holder_count": 0,
        "visiting_count": 0,
        "volumes": {window: 0.0 for window in WINDOWS},
    }


def _merge_rank_row(
    registry: Dict[str, Dict[str, Any]], row: Dict[str, Any], interval: str
) -> None:
    address = str(row.get("address") or "").lower()
    if not address:
        return
    item = registry.setdefault(address, _empty_token(address, str(row.get("symbol") or "")))
    if row.get("symbol"):
        item["symbol"] = str(row["symbol"])
    if row.get("name"):
        item["name"] = str(row["name"])
    if row.get("launchpad_platform"):
        item["launchpad_platform"] = str(row["launchpad_platform"])
    for key in ("market_cap", "liquidity"):
        value = _number(row.get(key))
        if value > 0:
            item[key] = value
    holders = int(_number(row.get("holder_count")))
    if holders > 0:
        item["holder_count"] = holders
    visits = int(_number(row.get("visiting_count")))
    if visits > 0:
        item["visiting_count"] = visits
    volume = _number(row.get("volume"))
    if volume > 0:
        item["volumes"][interval] = volume


class Collector:
    def __init__(
        self,
        client: GMGNClient,
        settings: Settings,
        liquidity_client: Optional[DexScreenerLiquidityClient] = None,
    ):
        self.client = client
        self.settings = settings
        self.liquidity_client = liquidity_client or DexScreenerLiquidityClient(
            settings.liquidity_crosscheck_timeout_seconds
        )

    def collect(self) -> Dict[str, Any]:
        started = time.monotonic()
        self.client.check_config()
        info = self.client.token_info()
        security = self.client.token_security()
        price_history_24h = self.client.kline_24h()

        boards: Dict[str, List[Dict[str, Any]]] = {
            "market_cap": self.client.trending("24h", "marketcap"),
            "liquidity": self.client.trending("24h", "liquidity"),
            "holder_count": self.client.trending("24h", "holder_count"),
        }
        for window in WINDOWS:
            boards[f"volume_{window}"] = self.client.trending(window, "volume")

        registry: Dict[str, Dict[str, Any]] = {}
        for key, rows in boards.items():
            interval = key.split("volume_", 1)[1] if key.startswith("volume_") else "24h"
            for row in rows:
                if isinstance(row, dict):
                    _merge_rank_row(registry, row, interval)

        target = registry.setdefault(
            self.settings.target_address,
            _empty_token(self.settings.target_address, self.settings.target_symbol),
        )
        target["symbol"] = str(info.get("symbol") or target["symbol"] or self.settings.target_symbol)
        price = info.get("price") if isinstance(info.get("price"), dict) else {}
        current_price = _number(price.get("price"))
        if current_price > 0:
            target["price"] = current_price
        circulating_supply = _number(info.get("circulating_supply") or info.get("total_supply"))
        calculated_market_cap = current_price * circulating_supply
        if calculated_market_cap > 0:
            target["market_cap"] = calculated_market_cap
        info_liquidity = _number(info.get("liquidity"))
        if info_liquidity > 0:
            target["liquidity"] = info_liquidity
        pool = info.get("pool") if isinstance(info.get("pool"), dict) else {}
        main_pool_address = str(
            info.get("biggest_pool_address") or pool.get("pool_address") or ""
        ).lower()
        target["liquidity_scope"] = {
            "label": "GMGN 最大主池",
            "definition": "用于同链同口径比较，不是全部交易池之和",
            "pool_address": main_pool_address,
            "pair": "/".join(
                part
                for part in (
                    str(info.get("symbol") or target.get("symbol") or ""),
                    str(pool.get("quote_symbol") or ""),
                )
                if part
            ),
            "venue": " ".join(
                part
                for part in (
                    str(pool.get("exchange") or ""),
                    "主池" if main_pool_address else "",
                )
                if part
            ),
        }
        try:
            liquidity_crosscheck = self.liquidity_client.fetch(
                self.settings.target_address,
                main_pool_address,
            )
        except LiquidityCrossCheckError as exc:
            liquidity_crosscheck = {
                "status": "ERROR",
                "source": "DEX Screener",
                "source_url": DexScreenerLiquidityClient.DOCS_URL,
                "observed_at": _iso(),
                "scope": "all_indexed_pools",
                "error": str(exc),
                "pool_count": 0,
                "top5_liquidity_usd": None,
                "all_pools_liquidity_usd": None,
                "same_main_pool_liquidity_usd": None,
                "pools": [],
            }
        target["liquidity_crosscheck"] = liquidity_crosscheck
        info_holders = int(_number(info.get("holder_count")))
        if info_holders > 0:
            target["holder_count"] = info_holders
        for window in WINDOWS:
            volume = _number(price.get(f"volume_{window}"))
            if volume > 0:
                target["volumes"][window] = volume

        hot_blocks = []
        for block in self.client.hot_searches():
            if not isinstance(block, dict):
                continue
            tokens = []
            for row in block.get("tokens") or []:
                if not isinstance(row, dict):
                    continue
                tokens.append(
                    {
                        "address": str(row.get("address") or "").lower(),
                        "symbol": str(row.get("symbol") or ""),
                        "visiting_count": int(_number(row.get("visiting_count"))),
                        "volume": _number(row.get("volume")),
                        "market_cap": _number(row.get("market_cap")),
                        "liquidity": _number(row.get("liquidity")),
                        "holder_count": int(_number(row.get("holder_count"))),
                    }
                )
            # GMGN has returned rank values that disagree with visiting_count; sort locally.
            tokens.sort(key=lambda row: row["visiting_count"], reverse=True)
            hot_blocks.append(
                {
                    "chain": str(block.get("chain") or "").lower(),
                    "interval": str(block.get("interval") or "24h"),
                    "version": block.get("version"),
                    "tokens": tokens,
                }
            )

        peers = [item for address, item in registry.items() if address != self.settings.target_address]
        safety = {
            "is_honeypot": security.get("is_honeypot"),
            "open_source": security.get("open_source"),
            "owner_renounced": security.get("owner_renounced"),
            "rug_ratio": security.get("rug_ratio"),
            "top_10_holder_rate": _number(security.get("top_10_holder_rate"), -1),
            "dev_team_hold_rate": security.get("dev_team_hold_rate"),
            "creator_balance_rate": security.get("creator_balance_rate"),
            "creator_token_status": security.get("creator_token_status"),
            "is_wash_trading": security.get("is_wash_trading"),
        }
        return {
            "observed_at": _iso(),
            "data_health": "OK",
            "source": "gmgn-cli",
            "chain": self.settings.chain,
            "target": target,
            "price_history_24h": price_history_24h,
            "peers": peers,
            "peer_universe_size": len(peers),
            "hot_search_blocks": hot_blocks,
            "safety": safety,
            "liquidity_crosscheck": liquidity_crosscheck,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "commands": [
                "config --check",
                "token info",
                "token security",
                "liquidity cross-check: all indexed pools",
                "kline: CASHCAT@1h/24h",
                "trending: marketcap/liquidity/holder_count@24h",
                "trending: volume@5m/1h/6h/24h",
                "hot-searches: all chains@24h",
            ],
        }


def _eligible_peers(
    target: Dict[str, Any], peers: Iterable[Dict[str, Any]], settings: Settings
) -> Tuple[List[Dict[str, Any]], Dict[str, float], List[Dict[str, str]]]:
    market_cap_floor = max(
        settings.peer_market_cap_floor,
        _number(target.get("market_cap")) * settings.peer_relative_floor,
    )
    liquidity_floor = max(
        settings.peer_liquidity_floor,
        _number(target.get("liquidity")) * settings.peer_relative_floor,
    )
    manual_exclusions = {
        address.strip().lower()
        for address in settings.peer_excluded_addresses.split(",")
        if address.strip()
    }
    eligible: List[Dict[str, Any]] = []
    excluded: List[Dict[str, str]] = []
    for peer in peers:
        address = str(peer.get("address") or "").lower()
        name = str(peer.get("name") or "")
        reason = None
        if address in manual_exclusions:
            reason = "manual_exclusion"
        elif name.strip().lower().endswith("• robinhood token"):
            reason = "tokenized_asset_not_meme"
        elif _number(peer.get("market_cap")) < market_cap_floor:
            reason = "market_cap_below_peer_floor"
        elif _number(peer.get("liquidity")) < liquidity_floor:
            reason = "liquidity_below_peer_floor"
        if reason:
            excluded.append(
                {"address": address, "symbol": str(peer.get("symbol") or ""), "reason": reason}
            )
        else:
            eligible.append(peer)
    return eligible, {"market_cap": market_cap_floor, "liquidity": liquidity_floor}, excluded


def _ranking_rows(
    target: Dict[str, Any],
    peers: List[Dict[str, Any]],
    value_getter,
) -> List[Dict[str, Any]]:
    candidates = []
    target_value = value_getter(target)
    if target_value > 0:
        candidates.append((target_value, target, True))
    candidates.extend(
        (value_getter(peer), peer, False)
        for peer in peers
        if value_getter(peer) > 0
    )
    candidates.sort(
        key=lambda item: (
            -item[0],
            0 if item[2] else 1,
            str(item[1].get("symbol") or "").casefold(),
            str(item[1].get("address") or "").casefold(),
        )
    )
    return [
        {
            "rank": rank,
            "address": token.get("address"),
            "symbol": token.get("symbol"),
            "name": token.get("name"),
            "value": value,
            "is_target": is_target,
        }
        for rank, (value, token, is_target) in enumerate(candidates, start=1)
    ]


def _dominance_metric(
    target: Dict[str, Any],
    peers: List[Dict[str, Any]],
    value_getter,
    cliff_threshold: float,
) -> Dict[str, Any]:
    target_value = value_getter(target)
    ranking_rows = _ranking_rows(target, peers, value_getter)
    target_ranking = next(
        (row for row in ranking_rows if row.get("is_target")),
        None,
    )
    candidates = sorted(
        ((value_getter(peer), peer) for peer in peers if value_getter(peer) > 0),
        key=lambda item: (
            -item[0],
            str(item[1].get("symbol") or "").casefold(),
            str(item[1].get("address") or "").casefold(),
        ),
    )
    if target_value <= 0 or not candidates:
        return {
            "state": "UNKNOWN",
            "ratio": None,
            "rank": (target_ranking or {}).get("rank"),
            "peer": None,
            "top3": ranking_rows[:3],
            "target_ranking": target_ranking,
        }
    peer_value, peer = candidates[0]
    ratio = target_value / peer_value if peer_value > 0 else None
    rank = int((target_ranking or {}).get("rank") or 0) or None
    if rank == 1 and ratio is not None and ratio >= cliff_threshold:
        state = "CLIFF"
    elif rank == 1:
        state = "LEAD"
    elif rank <= 3:
        state = "CHALLENGED"
    else:
        state = "LOST"
    return {
        "state": state,
        "ratio": round(ratio, 4) if ratio is not None else None,
        "rank": rank,
        "target_value": target_value,
        "peer": {
            "address": peer.get("address"),
            "symbol": peer.get("symbol"),
            "value": peer_value,
        },
        "top3": ranking_rows[:3],
        "target_ranking": target_ranking,
    }


def evaluate_leader(
    target: Dict[str, Any], peers: List[Dict[str, Any]], settings: Settings
) -> Dict[str, Any]:
    eligible, floors, excluded = _eligible_peers(target, peers, settings)
    market_cap = _dominance_metric(
        target,
        eligible,
        lambda peer: _number(peer.get("market_cap")),
        settings.market_cap_cliff,
    )
    liquidity = _dominance_metric(
        target,
        eligible,
        lambda peer: _number(peer.get("liquidity")),
        settings.liquidity_cliff,
    )
    holders = _dominance_metric(
        target,
        eligible,
        lambda peer: _number(peer.get("holder_count")),
        settings.holders_cliff,
    )

    per_window: Dict[str, Dict[str, Any]] = {}
    ratios: List[float] = []
    leading_windows = 0
    for window in WINDOWS:
        result = _dominance_metric(
            target,
            eligible,
            lambda token, w=window: _number((token.get("volumes") or {}).get(w)),
            settings.volume_cliff,
        )
        per_window[window] = result
        if result.get("rank") == 1:
            leading_windows += 1
        if result.get("ratio") and result["ratio"] > 0:
            ratios.append(result["ratio"])
    geometric_ratio = math.prod(ratios) ** (1 / len(ratios)) if ratios else 0.0
    if len(ratios) != len(WINDOWS):
        volume_state = "UNKNOWN"
    elif (
        leading_windows >= settings.minimum_volume_lead_windows
        and geometric_ratio >= settings.volume_cliff
    ):
        volume_state = "CLIFF"
    elif leading_windows >= settings.minimum_volume_lead_windows:
        volume_state = "LEAD"
    elif leading_windows == 2:
        volume_state = "CHALLENGED"
    else:
        volume_state = "LOST"
    volume = {
        "state": volume_state,
        "leading_windows": leading_windows,
        "required_leading_windows": settings.minimum_volume_lead_windows,
        "geometric_ratio": round(geometric_ratio, 4) if ratios else None,
        "windows": per_window,
    }

    dimensions = {
        "market_cap": market_cap,
        "liquidity": liquidity,
        "multi_window_volume": volume,
        "holder_count": holders,
    }
    cliff_count = sum(1 for item in dimensions.values() if item.get("state") == "CLIFF")
    lead_count = sum(1 for item in dimensions.values() if item.get("state") in ("CLIFF", "LEAD"))
    if any(item.get("state") == "UNKNOWN" for item in dimensions.values()):
        state = "UNKNOWN"
    elif cliff_count == 4:
        state = "FOUR_CLIFFS"
    elif lead_count == 4:
        state = "LEADER_NOT_CLIFF"
    elif lead_count >= 2:
        state = "CHALLENGED"
    else:
        state = "LOST"
    return {
        "state": state,
        "cliff_count": cliff_count,
        "lead_count": lead_count,
        "eligible_peer_count": len(eligible),
        "raw_peer_count": len(peers),
        "excluded_peer_count": len(excluded),
        "excluded_peers": excluded,
        "eligibility_floors": floors,
        "dimensions": dimensions,
    }


def _median(values: List[float]) -> Optional[float]:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    return statistics.median(clean) if clean else None


def evaluate_attention(
    blocks: List[Dict[str, Any]],
    target_address: str,
    history: List[Dict[str, Any]],
    settings: Settings,
) -> Dict[str, Any]:
    chain_totals: Dict[str, Dict[str, float]] = {}
    target_rank = None
    target_share = None
    for block in blocks:
        chain = str(block.get("chain") or "").lower()
        if not chain:
            continue
        tokens = sorted(
            (block.get("tokens") or []),
            key=lambda row: _number(row.get("visiting_count")),
            reverse=True,
        )[:10]
        attention_total = sum(_number(row.get("visiting_count")) for row in tokens)
        activity_total = sum(_number(row.get("volume")) for row in tokens)
        chain_totals[chain] = {"attention": attention_total, "activity": activity_total}
        if chain == settings.chain:
            for index, row in enumerate(tokens, start=1):
                if str(row.get("address") or "").lower() == target_address.lower():
                    target_rank = index
                    target_share = (
                        _number(row.get("visiting_count")) / attention_total
                        if attention_total > 0
                        else None
                    )
                    break
    target_attention_state = (
        "TOP_3"
        if target_rank is not None and target_rank <= 3
        else "TOP_10"
        if target_rank is not None
        else "OUTSIDE_TOP_10"
    )
    total_attention = sum(item["attention"] for item in chain_totals.values())
    total_activity = sum(item["activity"] for item in chain_totals.values())
    shares = {
        chain: {
            "attention": values["attention"] / total_attention if total_attention else 0.0,
            "activity": values["activity"] / total_activity if total_activity else 0.0,
            "attention_total": values["attention"],
            "activity_total": values["activity"],
        }
        for chain, values in chain_totals.items()
    }
    if settings.chain not in shares or not total_attention or not total_activity:
        return {
            "state": "UNKNOWN",
            "reason": "cross-chain hot-search data missing",
            "chain_shares": shares,
            "target_hot_rank": target_rank,
            "target_attention_share": target_share,
            "target_attention_state": target_attention_state,
        }

    historical_shares: List[Dict[str, Any]] = []
    for snapshot in history:
        attention = ((snapshot.get("analysis") or {}).get("attention") or {})
        if isinstance(attention.get("chain_shares"), dict):
            historical_shares.append(attention["chain_shares"])
    current = shares[settings.chain]
    if len(historical_shares) < settings.baseline_points:
        return {
            "state": "WARMING_UP",
            "baseline_points": len(historical_shares),
            "required_baseline_points": settings.baseline_points,
            "chain_shares": shares,
            "target_hot_rank": target_rank,
            "target_attention_share": round(target_share, 4) if target_share is not None else None,
            "target_attention_state": target_attention_state,
        }

    rh_attention_baseline = _median(
        [
            _number((sample.get(settings.chain) or {}).get("attention"), float("nan"))
            for sample in historical_shares
        ]
    )
    rh_activity_baseline = _median(
        [
            _number((sample.get(settings.chain) or {}).get("activity"), float("nan"))
            for sample in historical_shares
        ]
    )
    attention_ratio = (
        current["attention"] / rh_attention_baseline if rh_attention_baseline else None
    )
    activity_ratio = current["activity"] / rh_activity_baseline if rh_activity_baseline else None

    other_growth: Dict[str, float] = {}
    for chain, values in shares.items():
        if chain == settings.chain:
            continue
        baseline = _median(
            [
                _number((sample.get(chain) or {}).get("attention"), float("nan"))
                for sample in historical_shares
            ]
        )
        if baseline:
            other_growth[chain] = values["attention"] / baseline
    fastest_chain = max(other_growth, key=other_growth.get) if other_growth else None
    fastest_growth = other_growth.get(fastest_chain) if fastest_chain else None
    if (
        attention_ratio is not None
        and activity_ratio is not None
        and attention_ratio < 0.60
        and activity_ratio < 0.60
        and fastest_growth is not None
        and fastest_growth > 1.25
    ):
        state = "DIVERSION_CANDIDATE"
    elif (
        (attention_ratio is not None and attention_ratio < 0.75)
        or (activity_ratio is not None and activity_ratio < 0.75)
    ):
        state = "WEAKENING"
    else:
        state = "STABLE"
    return {
        "state": state,
        "baseline_points": len(historical_shares),
        "chain_shares": shares,
        "target_hot_rank": target_rank,
        "target_attention_share": round(target_share, 4) if target_share is not None else None,
        "target_attention_state": target_attention_state,
        "robinhood_attention_vs_baseline": round(attention_ratio, 4)
        if attention_ratio is not None
        else None,
        "robinhood_activity_vs_baseline": round(activity_ratio, 4)
        if activity_ratio is not None
        else None,
        "fastest_external_chain": fastest_chain,
        "fastest_external_attention_growth": round(fastest_growth, 4)
        if fastest_growth is not None
        else None,
    }


DEFAULT_NARRATIVE = {
    "founder_support": {"state": "unknown", "observed_at": None, "source_url": "", "note": ""},
    "mainstream_attention": {
        "state": "unknown",
        "observed_at": None,
        "source_url": "",
        "note": "",
    },
    "external_hotspot": {
        "state": "unknown",
        "observed_at": None,
        "source_url": "",
        "note": "",
        "name": "",
    },
}


class NarrativeStore:
    VALID = {
        "founder_support": {"unknown", "supportive", "neutral", "negative"},
        "mainstream_attention": {"unknown", "mainstream", "fading", "gone"},
        "external_hotspot": {"unknown", "none", "emerging", "confirmed"},
    }

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def load(self) -> Dict[str, Any]:
        with self.lock:
            if not self.path.exists():
                return json.loads(json.dumps(DEFAULT_NARRATIVE))
            try:
                payload = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return json.loads(json.dumps(DEFAULT_NARRATIVE))
        merged = json.loads(json.dumps(DEFAULT_NARRATIVE))
        for key in merged:
            if isinstance(payload.get(key), dict):
                merged[key].update(payload[key])
        return merged

    def validate(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Narrative payload must be an object")
        clean = json.loads(json.dumps(DEFAULT_NARRATIVE))
        for key, valid_states in self.VALID.items():
            item = payload.get(key)
            if not isinstance(item, dict):
                raise ValueError(f"Missing evidence object: {key}")
            state = str(item.get("state") or "unknown").lower()
            if state not in valid_states:
                raise ValueError(f"Invalid {key}.state: {state}")
            source_url = str(item.get("source_url") or "").strip()
            if source_url and not source_url.startswith(("https://", "http://")):
                raise ValueError(f"{key}.source_url must be http(s)")
            observed_at = item.get("observed_at")
            if observed_at and _parse_iso(observed_at) is None:
                raise ValueError(f"{key}.observed_at must be ISO-8601")
            if state != "unknown" and (not source_url or not observed_at):
                raise ValueError(f"{key} requires source_url and observed_at when state is known")
            clean[key] = {
                "state": state,
                "observed_at": observed_at,
                "source_url": source_url,
                "note": str(item.get("note") or "").strip()[:1000],
            }
            if key == "external_hotspot":
                clean[key]["name"] = str(item.get("name") or "").strip()[:120]
        return clean

    def save(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        clean = self.validate(payload)
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
            temporary.replace(self.path)
        return clean


def evaluate_narrative(
    narrative: Dict[str, Any], settings: Settings, now: Optional[dt.datetime] = None
) -> Dict[str, Any]:
    current_time = now or _utcnow()
    evidence: Dict[str, Any] = {}
    for key in DEFAULT_NARRATIVE:
        item = narrative.get(key) if isinstance(narrative.get(key), dict) else {}
        observed = _parse_iso(item.get("observed_at"))
        age_hours = (current_time - observed).total_seconds() / 3600 if observed else None
        evidence_fresh_hours = _number(
            item.get("fresh_hours"), settings.narrative_fresh_hours
        )
        fresh = age_hours is not None and age_hours <= evidence_fresh_hours
        evidence[key] = {
            **item,
            "fresh": fresh,
            "age_hours": round(age_hours, 2) if age_hours is not None else None,
            "fresh_hours": evidence_fresh_hours,
        }
    founder = evidence["founder_support"]
    mainstream = evidence["mainstream_attention"]
    hotspot = evidence["external_hotspot"]
    exit_reasons = []
    if founder.get("fresh") and founder.get("state") == "negative":
        exit_reasons.append("founder_support_negative")
    if mainstream.get("fresh") and mainstream.get("state") == "gone":
        exit_reasons.append("robinhood_meme_no_longer_mainstream")
    if hotspot.get("fresh") and hotspot.get("state") == "confirmed":
        exit_reasons.append("external_hotspot_confirmed")
    complete = all(
        [
            founder.get("fresh") and founder.get("state") == "supportive",
            mainstream.get("fresh") and mainstream.get("state") == "mainstream",
            hotspot.get("fresh") and hotspot.get("state") == "none",
        ]
    )
    watch = any(
        [
            not founder.get("fresh") or founder.get("state") in ("unknown", "neutral"),
            not mainstream.get("fresh") or mainstream.get("state") in ("unknown", "fading"),
            not hotspot.get("fresh") or hotspot.get("state") in ("unknown", "emerging"),
        ]
    )
    return {
        "state": "EXIT" if exit_reasons else "CONFIRMED" if complete else "WATCH" if watch else "PARTIAL",
        "exit_reasons": exit_reasons,
        "evidence": evidence,
    }


def decide_action(
    collection: Dict[str, Any],
    leader: Dict[str, Any],
    attention: Dict[str, Any],
    narrative: Dict[str, Any],
) -> Tuple[str, List[str]]:
    reasons: List[str] = []
    if collection.get("data_health") != "OK":
        return "UNKNOWN", ["required_market_data_unavailable"]
    if narrative.get("exit_reasons"):
        return "EXIT", list(narrative["exit_reasons"])
    if attention.get("state") == "DIVERSION_CANDIDATE":
        return "EXIT_CANDIDATE", ["cross_chain_attention_and_activity_diversion"]
    if leader.get("state") == "LOST":
        reasons.append("cashcat_leader_status_lost")
    elif leader.get("state") in ("CHALLENGED", "LEADER_NOT_CLIFF", "UNKNOWN"):
        reasons.append(f"leader_state_{leader.get('state', 'unknown').lower()}")
    if attention.get("state") in ("WEAKENING", "WARMING_UP", "UNKNOWN"):
        reasons.append(f"attention_state_{attention.get('state', 'unknown').lower()}")
    if narrative.get("state") != "CONFIRMED":
        reasons.append("narrative_premise_not_fully_confirmed")
    safety = collection.get("safety") or {}
    if safety.get("is_honeypot") is True or safety.get("is_wash_trading") is True:
        reasons.append("independent_token_safety_alert")
    if _number(safety.get("top_10_holder_rate"), -1) > 0.50:
        reasons.append("holder_concentration_above_50pct")
    if reasons:
        return "WATCH", reasons
    return "HOLD", ["all_required_premises_confirmed"]


def stabilize_action(candidate: str, history: List[Dict[str, Any]]) -> Tuple[str, str]:
    if candidate in ("EXIT", "UNKNOWN"):
        return candidate, "immediate_hard_gate"
    previous_candidates = [
        ((snapshot.get("analysis") or {}).get("candidate_action")) for snapshot in history[:3]
    ]
    previous_actions = [((snapshot.get("analysis") or {}).get("action")) for snapshot in history[:3]]
    if candidate == "EXIT_CANDIDATE":
        consecutive = 1
        for previous in previous_candidates:
            if previous == "EXIT_CANDIDATE":
                consecutive += 1
            else:
                break
        if consecutive >= 3:
            return "EXIT", "three_consecutive_automated_exit_candidates"
        return "EXIT_CANDIDATE", f"awaiting_persistence_{consecutive}_of_3"
    if candidate == "HOLD":
        consecutive = 1
        for previous in previous_candidates:
            if previous == "HOLD":
                consecutive += 1
            else:
                break
        recovering_from_exit = any(
            previous in ("EXIT", "EXIT_CANDIDATE") for previous in previous_actions
        )
        if recovering_from_exit and consecutive < 3:
            return "WATCH", f"recovery_hysteresis_{consecutive}_of_3"
    return candidate, "stable"


class SnapshotStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self):
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    observed_at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_snapshots_observed_at
                    ON snapshots(observed_at DESC);
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    observed_at TEXT NOT NULL,
                    previous_action TEXT,
                    new_action TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _decode(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        return json.loads(row["payload_json"])

    def save(self, payload: Dict[str, Any]) -> int:
        serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        with self.lock, self._connect() as connection:
            cursor = connection.execute(
                "INSERT INTO snapshots(observed_at, action, payload_json) VALUES (?, ?, ?)",
                (payload["observed_at"], payload["analysis"]["action"], serialized),
            )
            return int(cursor.lastrowid)

    def latest(self) -> Optional[Dict[str, Any]]:
        with self.lock, self._connect() as connection:
            row = connection.execute(
                "SELECT payload_json FROM snapshots ORDER BY id DESC LIMIT 1"
            ).fetchone()
        return self._decode(row)

    def history(self, limit: int = 100) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 2000))
        with self.lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM snapshots ORDER BY id DESC LIMIT ?", (safe_limit,)
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def between(
        self,
        start_at: str,
        end_at: str,
        limit: int = 10_000,
    ) -> List[Dict[str, Any]]:
        """Return snapshots in chronological order for an auditable report window."""
        safe_limit = max(1, min(int(limit), 50_000))
        with self.lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT payload_json
                FROM snapshots
                WHERE observed_at >= ? AND observed_at <= ?
                ORDER BY observed_at ASC, id ASC
                LIMIT ?
                """,
                (start_at, end_at, safe_limit),
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def add_event(
        self,
        previous_action: Optional[str],
        new_action: str,
        reason: str,
        payload: Dict[str, Any],
    ) -> None:
        with self.lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO events(observed_at, previous_action, new_action, reason, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    payload["observed_at"],
                    previous_action,
                    new_action,
                    reason,
                    json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                ),
            )

    def prune(self, retention_days: int) -> None:
        cutoff = _iso(_utcnow() - dt.timedelta(days=max(1, retention_days)))
        with self.lock, self._connect() as connection:
            connection.execute("DELETE FROM snapshots WHERE observed_at < ?", (cutoff,))
            connection.execute("DELETE FROM events WHERE observed_at < ?", (cutoff,))

    def events(self, limit: int = 100) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 1000))
        with self.lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT observed_at, previous_action, new_action, reason, payload_json
                FROM events ORDER BY id DESC LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
        return [
            {
                "observed_at": row["observed_at"],
                "previous_action": row["previous_action"],
                "new_action": row["new_action"],
                "reason": row["reason"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]

    def events_between(
        self,
        start_at: str,
        end_at: str,
        limit: int = 5_000,
    ) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 20_000))
        with self.lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT observed_at, previous_action, new_action, reason, payload_json
                FROM events
                WHERE observed_at >= ? AND observed_at <= ?
                ORDER BY observed_at ASC, id ASC
                LIMIT ?
                """,
                (start_at, end_at, safe_limit),
            ).fetchall()
        return [
            {
                "observed_at": row["observed_at"],
                "previous_action": row["previous_action"],
                "new_action": row["new_action"],
                "reason": row["reason"],
                "payload": json.loads(row["payload_json"]),
            }
            for row in rows
        ]


class Notifier:
    def __init__(self, urls: Optional[str] = None):
        self.urls = urls if urls is not None else os.getenv("CASHCAT_APPRISE_URLS", "")

    def enabled(self) -> bool:
        return bool(self.urls.strip())

    def send(self, snapshot: Dict[str, Any]) -> bool:
        if not self.enabled():
            return False
        try:
            import apprise  # type: ignore
        except ImportError:
            return False
        service = apprise.Apprise()
        raw = self.urls.strip()
        try:
            urls = json.loads(raw) if raw.startswith("[") else [part for part in raw.splitlines() if part]
        except json.JSONDecodeError:
            urls = [raw]
        for url in urls:
            service.add(str(url).strip())
        analysis = snapshot.get("analysis") or {}
        action = analysis.get("action", "UNKNOWN")
        reasons = ", ".join(analysis.get("reasons") or [])
        return bool(
            service.notify(
                title=f"Cash Cat Sentinel: {action}",
                body=f"{snapshot.get('observed_at')}\n{reasons}\n只读建议，不会自动交易。",
            )
        )


class MonitorService:
    def __init__(
        self,
        settings: Settings,
        collector: Collector,
        twitter_collector: TwitterLiveCollector,
        store: SnapshotStore,
        narrative_store: NarrativeStore,
        notifier: Optional[Notifier] = None,
    ):
        self.settings = settings
        self.collector = collector
        self.twitter_collector = twitter_collector
        self.store = store
        self.narrative_store = narrative_store
        self.notifier = notifier or Notifier()
        self.run_lock = threading.Lock()

    def run_once(self) -> Dict[str, Any]:
        if not self.run_lock.acquire(blocking=False):
            latest = self.store.latest()
            return {"skipped": True, "reason": "run_already_in_progress", "latest": latest}
        previous = self.store.latest()
        history = self.store.history(limit=2000)
        try:
            manual_narrative = self.narrative_store.load()
            collection = self.collector.collect()
            twitter = self.twitter_collector.collect()
            leader = evaluate_leader(collection["target"], collection["peers"], self.settings)
            attention = evaluate_attention(
                collection["hot_search_blocks"],
                self.settings.target_address,
                history,
                self.settings,
            )
            live_narrative_result = evaluate_twitter_narrative(twitter, history)
            twitter["signals"] = live_narrative_result["signals"]
            narrative_input = merge_live_and_manual_narrative(
                live_narrative_result["narrative"], manual_narrative
            )
            narrative = evaluate_narrative(narrative_input, self.settings)
            candidate, reasons = decide_action(collection, leader, attention, narrative)
            action, transition_rule = stabilize_action(candidate, history)
            persisted_collection = dict(collection)
            # The decision receipt keeps target facts and derived competitors; storing every raw
            # rank row every five minutes would add roughly 1 GB/month with no decision benefit.
            persisted_collection.pop("peers", None)
            persisted_collection.pop("hot_search_blocks", None)
            snapshot = {
                "observed_at": collection["observed_at"],
                "collection": persisted_collection,
                "twitter": compact_twitter_snapshot(twitter),
                "narrative_input": narrative_input,
                "analysis": {
                    "action": action,
                    "candidate_action": candidate,
                    "transition_rule": transition_rule,
                    "reasons": reasons,
                    "leader": leader,
                    "attention": attention,
                    "narrative": narrative,
                    "financial_execution": "DISABLED",
                },
            }
        except Exception as exc:
            snapshot = {
                "observed_at": _iso(),
                "collection": {
                    "data_health": "ERROR",
                    "source": "gmgn-cli",
                    "error": f"{type(exc).__name__}: {exc}",
                },
                "twitter": {
                    "status": "UNAVAILABLE",
                    "mode": "LIVE",
                    "source": "TwitterAPI.io",
                    "observed_at": _iso(),
                    "configured": False,
                    "feeds": {},
                },
                "narrative_input": self.narrative_store.load(),
                "analysis": {
                    "action": "UNKNOWN",
                    "candidate_action": "UNKNOWN",
                    "transition_rule": "immediate_data_failure",
                    "reasons": ["required_market_data_unavailable"],
                    "leader": {"state": "UNKNOWN"},
                    "attention": {"state": "UNKNOWN"},
                    "narrative": {"state": "UNKNOWN"},
                    "financial_execution": "DISABLED",
                },
            }
        finally:
            self.run_lock.release()

        previous_action = ((previous or {}).get("analysis") or {}).get("action")
        self.store.save(snapshot)
        self.store.prune(self.settings.retention_days)
        new_action = snapshot["analysis"]["action"]
        if new_action != previous_action:
            reason = ",".join(snapshot["analysis"].get("reasons") or [])
            self.store.add_event(previous_action, new_action, reason, snapshot)
            self.notifier.send(snapshot)
        return snapshot


def build_service(settings: Optional[Settings] = None) -> MonitorService:
    chosen = settings or Settings()
    client = GMGNClient(chosen)
    twitter_client = TwitterLiveClient(
        timeout_seconds=chosen.twitter_timeout_seconds,
        minimum_request_interval_seconds=chosen.twitter_min_request_interval_seconds,
    )
    return MonitorService(
        chosen,
        Collector(
            client,
            chosen,
            DexScreenerLiquidityClient(
                timeout_seconds=chosen.liquidity_crosscheck_timeout_seconds
            ),
        ),
        TwitterLiveCollector(twitter_client, chosen.target_address),
        SnapshotStore(chosen.db_path),
        NarrativeStore(chosen.narrative_path),
        Notifier(),
    )
