import datetime as dt
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from daily_report import DailyReportArchive, DailyReportBuilder, DailyReportSettings


UTC = dt.timezone.utc


def snapshot(
    observed_at,
    action="HOLD",
    data_health="OK",
    twitter_status="OK",
    market_cap=10_000_000,
    leader_state="FOUR_CLIFFS",
):
    return {
        "observed_at": observed_at.isoformat(timespec="seconds"),
        "collection": {
            "data_health": data_health,
            "source": "gmgn-cli",
            "chain": "robinhood",
            "target": {
                "address": "0xcashcat",
                "symbol": "CASHCAT",
                "name": "Cash Cat",
                "price": 0.05,
                "market_cap": market_cap,
                "liquidity": 1_000_000,
                "liquidity_scope": {
                    "label": "GMGN 最大主池",
                    "pool_address": "0xpool",
                    "pair": "CASHCAT/WETH",
                    "venue": "Uniswap v3 主池",
                },
                "liquidity_crosscheck": {
                    "status": "OK",
                    "source": "DEX Screener",
                    "source_url": "https://docs.dexscreener.com/api/reference",
                    "observed_at": observed_at.isoformat(timespec="seconds"),
                    "pool_count": 30,
                    "same_main_pool_liquidity_usd": 1_100_000,
                    "top5_liquidity_usd": 2_500_000,
                    "all_pools_liquidity_usd": 3_000_000,
                },
                "holder_count": 10_000,
                "volumes": {"5m": 100_000, "1h": 500_000, "6h": 2_000_000, "24h": 8_000_000},
            },
            "price_history_24h": {
                "candle_count": 24,
                "open": 0.04,
                "close": 0.05,
                "high": 0.06,
                "low": 0.035,
                "total_volume_usd": 8_000_000,
                "first_candle_at": (observed_at - dt.timedelta(hours=23)).isoformat(timespec="seconds"),
                "last_candle_at": observed_at.isoformat(timespec="seconds"),
            },
            "liquidity_crosscheck": {
                "status": "OK",
                "source": "DEX Screener",
                "source_url": "https://docs.dexscreener.com/api/reference",
                "observed_at": observed_at.isoformat(timespec="seconds"),
                "pool_count": 30,
                "same_main_pool_liquidity_usd": 1_100_000,
                "top5_liquidity_usd": 2_500_000,
                "all_pools_liquidity_usd": 3_000_000,
            },
            "safety": {"is_honeypot": False},
        },
        "twitter": {
            "status": twitter_status,
            "source": "TwitterAPI.io",
            "source_documentation": "https://docs.example.com/twitter",
            "observed_at": observed_at.isoformat(timespec="seconds"),
            "feeds": {
                "official": {
                    "label": "Robinhood 官方与创始人",
                    "status": "OK",
                    "tweets": [
                        {
                            "url": "https://x.com/vladtenev/status/1",
                            "author_username": "vladtenev",
                            "author_name": "Vlad Tenev",
                            "verified": True,
                            "created_at": observed_at.isoformat(timespec="seconds"),
                            "text": "Robinhood Chain works great for memes too",
                            "engagement": 100,
                            "metrics": {"views": 1000},
                        }
                    ],
                },
                "founder": {
                    "label": "创始人 Meme 立场原帖",
                    "status": "OK",
                    "tweets": [],
                },
                "ecosystem": {
                    "label": "Robinhood Chain 生态伙伴",
                    "status": "OK",
                    "tweets": [],
                },
                "cashcat": {"label": "Cash Cat 实时讨论", "status": "OK", "tweets": []},
                "robinhood": {"label": "Robinhood Chain 实时讨论", "status": "OK", "tweets": []},
                "external": {"label": "外部 Meme 新热点", "status": "OK", "tweets": []},
            },
        },
        "analysis": {
            "action": action,
            "leader": {
                "state": leader_state,
                "cliff_count": 4 if leader_state == "FOUR_CLIFFS" else 3,
                "eligible_peer_count": 10,
                "dimensions": {
                    "market_cap": {"state": "CLIFF", "ratio": 2.0, "rank": 1, "target_value": market_cap, "peer": {"symbol": "PONS", "value": market_cap / 2}},
                    "liquidity": {"state": "CLIFF", "ratio": 2.0, "rank": 1, "target_value": 1_000_000, "peer": {"symbol": "PONS", "value": 500_000}},
                    "multi_window_volume": {
                        "state": "CLIFF" if leader_state == "FOUR_CLIFFS" else "LEAD",
                        "leading_windows": 4 if leader_state == "FOUR_CLIFFS" else 3,
                        "required_leading_windows": 3,
                        "geometric_ratio": 1.5,
                        "windows": {
                            "5m": {"state": "LEAD", "ratio": 1.5, "rank": 1, "target_value": 100_000, "peer": {"symbol": "PONS", "value": 60_000}},
                            "1h": {"state": "LEAD", "ratio": 1.5, "rank": 1, "target_value": 500_000, "peer": {"symbol": "PONS", "value": 333_333}},
                            "6h": {"state": "LEAD", "ratio": 1.5, "rank": 1, "target_value": 2_000_000, "peer": {"symbol": "PONS", "value": 1_333_333}},
                            "24h": {"state": "LEAD", "ratio": 1.5, "rank": 1, "target_value": 8_000_000, "peer": {"symbol": "PONS", "value": 5_333_333}},
                        },
                    },
                    "holder_count": {"state": "CLIFF", "ratio": 2.0, "rank": 1, "target_value": 10_000, "peer": {"symbol": "PONS", "value": 5_000}},
                },
            },
            "attention": {
                "state": "STABLE",
                "chain_shares": {"robinhood": {"attention": 0.35, "activity": 0.5}},
                "target_hot_rank": 1,
                "target_attention_share": 0.2,
                "robinhood_attention_vs_baseline": 1.0,
                "robinhood_activity_vs_baseline": 1.0,
                "fastest_external_chain": "sol",
                "fastest_external_attention_growth": 1.01,
            },
            "narrative": {
                "state": "CONFIRMED",
                "exit_reasons": [],
                "evidence": {
                    "founder_support": {
                        "state": "supportive",
                        "observed_at": observed_at.isoformat(timespec="seconds"),
                        "source_url": "https://x.com/vladtenev/status/1",
                        "note": "创始人原帖仍明确支持。",
                        "fresh": True,
                    },
                    "mainstream_attention": {
                        "state": "mainstream",
                        "observed_at": observed_at.isoformat(timespec="seconds"),
                        "source_url": "https://x.com/example/status/2",
                        "note": "仍在主流讨论。",
                        "fresh": True,
                    },
                    "external_hotspot": {
                        "state": "none",
                        "observed_at": observed_at.isoformat(timespec="seconds"),
                        "source_url": "https://x.com/example/status/3",
                        "note": "尚未确认替代热点。",
                        "fresh": True,
                    },
                },
            },
        },
    }


class FakeStore:
    def __init__(self, snapshots):
        self.snapshots = snapshots

    def latest(self):
        return self.snapshots[-1] if self.snapshots else None

    def between(self, start_at, end_at, limit=10_000):
        start = dt.datetime.fromisoformat(start_at)
        end = dt.datetime.fromisoformat(end_at)
        return [
            item
            for item in self.snapshots
            if start <= dt.datetime.fromisoformat(item["observed_at"]) <= end
        ][:limit]

    def events_between(self, start_at, end_at, limit=5_000):
        return []


class DailyReportTests(unittest.TestCase):
    def settings(self, report_dir=None):
        return DailyReportSettings(
            timezone_name="Asia/Shanghai",
            cutoff_hour=8,
            schedule_minute=10,
            minimum_coverage=0.90,
            report_dir=Path(report_dir or "/tmp/cashcat-report-tests"),
            export_png=False,
        )

    def builder(self, snapshots, report_dir=None):
        monitor = SimpleNamespace(
            poll_seconds=300,
            target_symbol="CASHCAT",
            target_address="0xcashcat",
        )
        return DailyReportBuilder(FakeStore(snapshots), monitor, self.settings(report_dir))

    def test_daily_window_uses_beijing_eight_am_cutoff(self):
        builder = self.builder([])
        report_date, start, end = builder.daily_window(
            dt.date(2026, 7, 22),
            now=dt.datetime(2026, 7, 22, 1, tzinfo=UTC),
        )
        self.assertEqual(report_date, dt.date(2026, 7, 22))
        self.assertEqual(start, dt.datetime(2026, 7, 21, 0, tzinfo=UTC))
        self.assertEqual(end, dt.datetime(2026, 7, 22, 0, tzinfo=UTC))

    def test_incomplete_real_window_pauses_positive_conclusion(self):
        start = dt.datetime(2026, 7, 21, 0, tzinfo=UTC)
        snapshots = [snapshot(start + dt.timedelta(minutes=5 * index)) for index in range(42)]
        report = self.builder(snapshots).build_window(
            "preview", start, start + dt.timedelta(days=1), "preview"
        )
        self.assertEqual(report["coverage"]["observed_points"], 42)
        self.assertFalse(report["coverage"]["complete"])
        self.assertEqual(report["verdict"]["action"], "PAUSE")
        self.assertEqual(report["verdict"]["label"], "暂停判断")

    def test_complete_window_preserves_hold_action(self):
        start = dt.datetime(2026, 7, 21, 0, tzinfo=UTC)
        snapshots = [snapshot(start + dt.timedelta(minutes=5 * index)) for index in range(288)]
        report = self.builder(snapshots).build_window(
            "2026-07-22", start, start + dt.timedelta(days=1), "daily"
        )
        self.assertTrue(report["coverage"]["complete"])
        self.assertEqual(report["verdict"]["action"], "HOLD")
        self.assertEqual(report["verdict"]["label"], "继续持有")

    def test_complete_live_evidence_preserves_current_action_without_288_points(self):
        observed_at = dt.datetime(2026, 7, 24, 3, 20, tzinfo=UTC)
        report = self.builder([snapshot(observed_at, action="WATCH")]).build_live(
            now=observed_at
        )
        self.assertEqual(report["coverage"]["contract"], "live_evidence")
        self.assertTrue(report["coverage"]["complete"])
        self.assertEqual(report["coverage"]["observed_points"], 9)
        self.assertEqual(report["verdict"]["action"], "WATCH")
        self.assertFalse(report["history_continuity"]["complete"])

    def test_live_evidence_pauses_when_peer_comparison_is_missing(self):
        observed_at = dt.datetime(2026, 7, 24, 3, 20, tzinfo=UTC)
        item = snapshot(observed_at, action="HOLD")
        item["analysis"]["leader"]["dimensions"]["liquidity"]["peer"] = {}
        report = self.builder([item]).build_live(now=observed_at)
        self.assertFalse(report["coverage"]["complete"])
        self.assertEqual(report["verdict"]["action"], "PAUSE")
        self.assertIn(
            "四项龙头对手比较未完整",
            report["coverage"]["reasons"],
        )

    def test_four_cliffs_include_target_peer_ratio_and_all_volume_windows(self):
        observed_at = dt.datetime(2026, 7, 24, 3, 20, tzinfo=UTC)
        report = self.builder([snapshot(observed_at)]).build_live(now=observed_at)
        market_cap = report["four_cliffs"]["items"][0]
        volume = report["four_cliffs"]["items"][2]
        self.assertEqual(market_cap["target_value"], 10_000_000)
        self.assertEqual(market_cap["peer"]["symbol"], "PONS")
        self.assertEqual(market_cap["ratio"], 2.0)
        self.assertEqual([item["window"] for item in volume["windows"]], ["5m", "1h", "6h", "24h"])

    def test_four_cliffs_preserve_top_three_rankings(self):
        observed_at = dt.datetime(2026, 7, 24, 3, 20, tzinfo=UTC)
        item = snapshot(observed_at)
        market_cap = item["analysis"]["leader"]["dimensions"]["market_cap"]
        market_cap["top3"] = [
            {"rank": 1, "symbol": "CASHCAT", "value": 10_000_000, "is_target": True},
            {"rank": 2, "symbol": "PONS", "value": 5_000_000, "is_target": False},
            {"rank": 3, "symbol": "WOOD", "value": 3_000_000, "is_target": False},
        ]
        market_cap["target_ranking"] = market_cap["top3"][0]
        window = item["analysis"]["leader"]["dimensions"]["multi_window_volume"]["windows"]["5m"]
        window["top3"] = [
            {"rank": 1, "symbol": "CASHCAT", "value": 100_000, "is_target": True},
            {"rank": 2, "symbol": "PONS", "value": 60_000, "is_target": False},
            {"rank": 3, "symbol": "WOOD", "value": 40_000, "is_target": False},
        ]
        window["target_ranking"] = window["top3"][0]
        report = self.builder([item]).build_live(now=observed_at)
        self.assertEqual(
            [row["symbol"] for row in report["four_cliffs"]["items"][0]["top3"]],
            ["CASHCAT", "PONS", "WOOD"],
        )
        self.assertEqual(
            [row["symbol"] for row in report["four_cliffs"]["items"][2]["windows"][0]["top3"]],
            ["CASHCAT", "PONS", "WOOD"],
        )

    def test_report_reconciles_main_pool_and_multi_pool_liquidity(self):
        observed_at = dt.datetime(2026, 7, 24, 3, 20, tzinfo=UTC)
        report = self.builder([snapshot(observed_at)]).build_live(now=observed_at)
        context = report["target"]["liquidity_context"]
        self.assertEqual(report["target"]["metrics"]["liquidity"]["label"], "GMGN 主池流动性")
        self.assertEqual(context["main_pool_usd"], 1_000_000)
        self.assertEqual(context["top5_pools_usd"], 2_500_000)
        self.assertEqual(context["all_indexed_pools_usd"], 3_000_000)
        self.assertEqual(context["indexed_pool_count"], 30)

    def test_fresh_explicit_exit_is_not_hidden_by_earlier_gaps(self):
        end = dt.datetime(2026, 7, 22, 0, tzinfo=UTC)
        snapshots = [snapshot(end - dt.timedelta(minutes=5), action="EXIT")]
        report = self.builder(snapshots).build_window(
            "2026-07-22", end - dt.timedelta(days=1), end, "daily"
        )
        self.assertFalse(report["coverage"]["complete"])
        self.assertEqual(report["verdict"]["action"], "EXIT")

    def test_report_keeps_clickable_x_evidence_and_real_posts(self):
        end = dt.datetime(2026, 7, 22, 0, tzinfo=UTC)
        report = self.builder([snapshot(end)]).build_preview()
        self.assertEqual(
            report["narrative"]["evidence"][0]["source_url"],
            "https://x.com/vladtenev/status/1",
        )
        self.assertEqual(report["live_posts"][0]["author_username"], "vladtenev")
        self.assertEqual(report["live_posts"][0]["url"], "https://x.com/vladtenev/status/1")

    def test_archive_round_trip_and_latest(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = DailyReportArchive(Path(directory))
            report = {
                "report_id": "2026-07-22",
                "kind": "daily",
                "generated_at": "2026-07-22T00:10:00+00:00",
                "window": {"date_label": "2026年07月22日"},
                "verdict": {"label": "继续观察"},
                "coverage": {"ratio": 1},
                "artifacts": {},
            }
            path = archive.save(report)
            self.assertTrue(path.exists())
            self.assertEqual(archive.load("2026-07-22"), report)
            self.assertEqual(archive.latest()["report_id"], "2026-07-22")


if __name__ == "__main__":
    unittest.main()
