import datetime as dt
import unittest

from sentinel import (
    Settings,
    decide_action,
    evaluate_attention,
    evaluate_leader,
    evaluate_narrative,
    stabilize_action,
)


def token(symbol, market_cap, liquidity, holders, volumes, address=None):
    return {
        "address": address or symbol.lower(),
        "symbol": symbol,
        "market_cap": market_cap,
        "liquidity": liquidity,
        "holder_count": holders,
        "visiting_count": 10,
        "volumes": volumes,
    }


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.settings = Settings(
            peer_market_cap_floor=1,
            peer_liquidity_floor=1,
            peer_relative_floor=0,
            baseline_points=3,
        )
        self.target = token(
            "CASHCAT",
            10_000_000,
            1_000_000,
            10_000,
            {"5m": 100_000, "1h": 500_000, "6h": 2_000_000, "24h": 8_000_000},
            self.settings.target_address,
        )

    def test_four_cliffs_requires_all_four_dimensions(self):
        peer = token(
            "PEER",
            5_000_000,
            500_000,
            5_000,
            {"5m": 50_000, "1h": 250_000, "6h": 1_000_000, "24h": 4_000_000},
        )
        result = evaluate_leader(self.target, [peer], self.settings)
        self.assertEqual(result["state"], "FOUR_CLIFFS")
        self.assertEqual(result["cliff_count"], 4)

    def test_two_volume_windows_lost_is_not_multi_window_lead(self):
        peer = token(
            "PONS",
            4_000_000,
            300_000,
            3_000,
            {"5m": 120_000, "1h": 400_000, "6h": 2_500_000, "24h": 6_000_000},
        )
        result = evaluate_leader(self.target, [peer], self.settings)
        volume = result["dimensions"]["multi_window_volume"]
        self.assertEqual(volume["leading_windows"], 2)
        self.assertEqual(volume["state"], "CHALLENGED")

    def test_low_quality_holder_outlier_is_excluded(self):
        settings = Settings(
            peer_market_cap_floor=250_000,
            peer_liquidity_floor=25_000,
            peer_relative_floor=0.01,
        )
        legitimate = token(
            "LEGIT",
            5_000_000,
            500_000,
            5_000,
            {"5m": 50_000, "1h": 250_000, "6h": 1_000_000, "24h": 4_000_000},
        )
        emoji_outlier = token(
            "EMOJI",
            100,
            10,
            600_000,
            {"5m": 1, "1h": 1, "6h": 1, "24h": 1},
        )
        result = evaluate_leader(self.target, [legitimate, emoji_outlier], settings)
        holder_peer = result["dimensions"]["holder_count"]["peer"]
        self.assertEqual(holder_peer["symbol"], "LEGIT")
        self.assertEqual(result["eligible_peer_count"], 1)

    def test_tokenized_robinhood_stock_is_not_a_meme_peer(self):
        stock = token(
            "TSLA",
            5_000_000,
            500_000,
            50_000,
            {"5m": 50_000, "1h": 250_000, "6h": 1_000_000, "24h": 4_000_000},
        )
        stock["name"] = "Tesla • Robinhood Token"
        meme = token(
            "PONS",
            4_000_000,
            400_000,
            4_000,
            {"5m": 40_000, "1h": 200_000, "6h": 800_000, "24h": 3_000_000},
        )
        result = evaluate_leader(self.target, [stock, meme], self.settings)
        self.assertEqual(result["dimensions"]["holder_count"]["peer"]["symbol"], "PONS")
        self.assertTrue(
            any(item["reason"] == "tokenized_asset_not_meme" for item in result["excluded_peers"])
        )

    def test_each_dimension_keeps_top_three_and_target_rank(self):
        peers = [
            token("ALPHA", 12_000_000, 2_000_000, 12_000, {"5m": 120_000, "1h": 600_000, "6h": 2_400_000, "24h": 9_600_000}),
            token("BRAVO", 8_000_000, 800_000, 8_000, {"5m": 80_000, "1h": 400_000, "6h": 1_600_000, "24h": 6_400_000}),
            token("CHARLIE", 6_000_000, 600_000, 6_000, {"5m": 60_000, "1h": 300_000, "6h": 1_200_000, "24h": 4_800_000}),
        ]
        result = evaluate_leader(self.target, peers, self.settings)
        market_cap = result["dimensions"]["market_cap"]
        self.assertEqual(
            [row["symbol"] for row in market_cap["top3"]],
            ["ALPHA", "CASHCAT", "BRAVO"],
        )
        self.assertEqual(market_cap["target_ranking"]["rank"], 2)
        self.assertTrue(market_cap["target_ranking"]["is_target"])
        self.assertEqual(
            [row["symbol"] for row in result["dimensions"]["multi_window_volume"]["windows"]["24h"]["top3"]],
            ["ALPHA", "CASHCAT", "BRAVO"],
        )

    def test_target_rank_is_kept_when_it_falls_outside_top_three(self):
        peers = [
            token(f"PEER{index}", 20_000_000 - index * 1_000_000, 2_000_000, 20_000, {"5m": 200_000, "1h": 1_000_000, "6h": 4_000_000, "24h": 16_000_000})
            for index in range(4)
        ]
        result = evaluate_leader(self.target, peers, self.settings)
        market_cap = result["dimensions"]["market_cap"]
        self.assertEqual(len(market_cap["top3"]), 3)
        self.assertFalse(any(row["is_target"] for row in market_cap["top3"]))
        self.assertEqual(market_cap["target_ranking"]["rank"], 5)

    def test_attention_stays_warming_until_baseline_exists(self):
        blocks = [
            {"chain": "robinhood", "tokens": [{"address": self.settings.target_address, "visiting_count": 20, "volume": 20}]},
            {"chain": "sol", "tokens": [{"address": "sol", "visiting_count": 80, "volume": 80}]},
        ]
        result = evaluate_attention(blocks, self.settings.target_address, [], self.settings)
        self.assertEqual(result["state"], "WARMING_UP")

    def test_attention_diversion_needs_relative_drop_and_external_growth(self):
        blocks = [
            {"chain": "robinhood", "tokens": [{"address": self.settings.target_address, "visiting_count": 5, "volume": 5}]},
            {"chain": "sol", "tokens": [{"address": "sol", "visiting_count": 75, "volume": 75}]},
            {"chain": "bsc", "tokens": [{"address": "bsc", "visiting_count": 20, "volume": 20}]},
        ]
        history = []
        for _ in range(3):
            history.append(
                {
                    "analysis": {
                        "attention": {
                            "chain_shares": {
                                "robinhood": {"attention": 0.20, "activity": 0.20},
                                "sol": {"attention": 0.40, "activity": 0.40},
                                "bsc": {"attention": 0.40, "activity": 0.40},
                            }
                        }
                    }
                }
            )
        result = evaluate_attention(blocks, self.settings.target_address, history, self.settings)
        self.assertEqual(result["state"], "DIVERSION_CANDIDATE")
        self.assertEqual(result["fastest_external_chain"], "sol")

    def test_target_hot_rank_does_not_relabel_chain_as_weakening(self):
        blocks = [
            {
                "chain": "robinhood",
                "tokens": [
                    {"address": "a", "visiting_count": 20, "volume": 20},
                    {"address": "b", "visiting_count": 18, "volume": 18},
                    {"address": "c", "visiting_count": 16, "volume": 16},
                    {
                        "address": self.settings.target_address,
                        "visiting_count": 15,
                        "volume": 15,
                    },
                ],
            },
            {
                "chain": "sol",
                "tokens": [{"address": "sol", "visiting_count": 31, "volume": 31}],
            },
        ]
        history = [
            {
                "analysis": {
                    "attention": {
                        "chain_shares": {
                            "robinhood": {"attention": 0.69, "activity": 0.69},
                            "sol": {"attention": 0.31, "activity": 0.31},
                        }
                    }
                }
            }
            for _ in range(3)
        ]
        result = evaluate_attention(
            blocks,
            self.settings.target_address,
            history,
            self.settings,
        )
        self.assertEqual(result["state"], "STABLE")
        self.assertEqual(result["target_hot_rank"], 4)
        self.assertEqual(result["target_attention_state"], "TOP_10")

    def test_fresh_negative_founder_evidence_is_immediate_exit_gate(self):
        now = dt.datetime.now(dt.timezone.utc)
        narrative = {
            "founder_support": {"state": "negative", "observed_at": now.isoformat(), "source_url": "https://example.com/a", "note": "direct statement"},
            "mainstream_attention": {"state": "mainstream", "observed_at": now.isoformat(), "source_url": "https://example.com/b", "note": ""},
            "external_hotspot": {"state": "none", "observed_at": now.isoformat(), "source_url": "https://example.com/c", "note": "", "name": ""},
        }
        result = evaluate_narrative(narrative, self.settings, now)
        self.assertEqual(result["state"], "EXIT")
        self.assertIn("founder_support_negative", result["exit_reasons"])

    def test_missing_market_data_never_becomes_hold(self):
        action, reasons = decide_action(
            {"data_health": "ERROR"},
            {"state": "FOUR_CLIFFS"},
            {"state": "STABLE"},
            {"state": "CONFIRMED", "exit_reasons": []},
        )
        self.assertEqual(action, "UNKNOWN")
        self.assertIn("required_market_data_unavailable", reasons)

    def test_automated_exit_requires_three_consecutive_candidates(self):
        history = [
            {"analysis": {"candidate_action": "EXIT_CANDIDATE", "action": "EXIT_CANDIDATE"}},
            {"analysis": {"candidate_action": "EXIT_CANDIDATE", "action": "EXIT_CANDIDATE"}},
        ]
        action, rule = stabilize_action("EXIT_CANDIDATE", history)
        self.assertEqual(action, "EXIT")
        self.assertEqual(rule, "three_consecutive_automated_exit_candidates")

    def test_exit_recovery_requires_three_consecutive_hold_candidates(self):
        first_history = [
            {"analysis": {"candidate_action": "EXIT", "action": "EXIT"}},
        ]
        action, rule = stabilize_action("HOLD", first_history)
        self.assertEqual(action, "WATCH")
        self.assertEqual(rule, "recovery_hysteresis_1_of_3")

        second_history = [
            {"analysis": {"candidate_action": "HOLD", "action": "WATCH"}},
            {"analysis": {"candidate_action": "EXIT", "action": "EXIT"}},
        ]
        action, rule = stabilize_action("HOLD", second_history)
        self.assertEqual(action, "WATCH")
        self.assertEqual(rule, "recovery_hysteresis_2_of_3")

        third_history = [
            {"analysis": {"candidate_action": "HOLD", "action": "WATCH"}},
            {"analysis": {"candidate_action": "HOLD", "action": "WATCH"}},
            {"analysis": {"candidate_action": "EXIT", "action": "EXIT"}},
        ]
        action, rule = stabilize_action("HOLD", third_history)
        self.assertEqual(action, "HOLD")
        self.assertEqual(rule, "stable")

    def test_exact_cliff_threshold_counts_as_cliff(self):
        peer = token(
            "PEER",
            self.target["market_cap"] / self.settings.market_cap_cliff,
            self.target["liquidity"] / self.settings.liquidity_cliff,
            self.target["holder_count"] / self.settings.holders_cliff,
            {
                window: self.target["volumes"][window] / self.settings.volume_cliff
                for window in ("5m", "1h", "6h", "24h")
            },
        )
        result = evaluate_leader(self.target, [peer], self.settings)
        self.assertEqual(result["state"], "FOUR_CLIFFS")

    def test_expired_negative_narrative_does_not_trigger_exit(self):
        now = dt.datetime.now(dt.timezone.utc)
        old = now - dt.timedelta(hours=self.settings.narrative_fresh_hours + 1)
        narrative = {
            "founder_support": {"state": "negative", "observed_at": old.isoformat(), "source_url": "https://example.com/a", "note": "expired"},
            "mainstream_attention": {"state": "mainstream", "observed_at": now.isoformat(), "source_url": "https://example.com/b", "note": ""},
            "external_hotspot": {"state": "none", "observed_at": now.isoformat(), "source_url": "https://example.com/c", "note": "", "name": ""},
        }
        result = evaluate_narrative(narrative, self.settings, now)
        self.assertEqual(result["state"], "WATCH")
        self.assertEqual(result["exit_reasons"], [])


if __name__ == "__main__":
    unittest.main()
