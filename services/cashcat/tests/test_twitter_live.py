import unittest

from twitter_live import (
    _annotate_account,
    _normalize_tweet,
    _official_account_security,
    _summarize_feed,
    evaluate_twitter_narrative,
    merge_live_and_manual_narrative,
)


def tweet(tweet_id, author, text, likes=0, reposts=0, views=0, created_at="2026-07-21T08:00:00+00:00"):
    return {
        "id": str(tweet_id),
        "url": f"https://x.com/{author}/status/{tweet_id}",
        "author_username": author,
        "author_name": author,
        "verified": False,
        "created_at": created_at,
        "text": text,
        "metrics": {
            "replies": 0,
            "reposts": reposts,
            "likes": likes,
            "quotes": 0,
            "views": views,
            "bookmarks": 0,
        },
        "engagement": likes + 2 * reposts,
    }


def live_payload(
    official=None,
    ecosystem=None,
    cashcat=None,
    robinhood=None,
    external=None,
    official_account_security=None,
):
    payload = {
        "status": "OK",
        "mode": "LIVE",
        "source": "TwitterAPI.io",
        "configured": True,
        "observed_at": "2026-07-21T08:05:00+00:00",
        "feeds": {
            "official": {"tweets": official or []},
            "ecosystem": {"tweets": ecosystem or []},
            "cashcat": {"tweets": cashcat or []},
            "robinhood": {"tweets": robinhood or []},
            "external": {"tweets": external or []},
        },
    }
    if official_account_security is not None:
        payload["official_account_security"] = official_account_security
    return payload


class TwitterLiveTests(unittest.TestCase):
    def test_normalizes_real_twitterapi_shape(self):
        normalized = _normalize_tweet(
            {
                "id": "123",
                "text": "Robinhood Chain is live",
                "createdAt": "Tue Jul 21 08:00:00 +0000 2026",
                "author": {"userName": "RobinhoodApp", "name": "Robinhood"},
                "likeCount": 100,
                "retweetCount": 20,
                "viewCount": 5000,
            }
        )
        self.assertEqual(normalized["author_username"], "RobinhoodApp")
        self.assertEqual(normalized["metrics"]["likes"], 100)
        self.assertEqual(normalized["engagement"], 140)
        self.assertEqual(normalized["url"], "https://x.com/RobinhoodApp/status/123")

    def test_annotates_direct_and_ecosystem_account_roles(self):
        johann = _annotate_account(tweet("1", "JohannKerbrat", "Robinhood Chain"))
        arbitrum = _annotate_account(tweet("2", "arbitrum", "Robinhood Chain"))
        self.assertEqual(johann["account_role"], "加密与国际业务负责人")
        self.assertEqual(arbitrum["account_tier"], "ecosystem")

    def test_latest_feed_is_ordered_by_time_not_old_engagement(self):
        old_popular = tweet(
            "1",
            "RobinhoodApp",
            "Older but popular",
            likes=10_000,
            created_at="2026-07-20T08:00:00+00:00",
        )
        new_update = tweet(
            "2",
            "JohannKerbrat",
            "Newest operational update",
            likes=10,
            created_at="2026-07-23T08:00:00+00:00",
        )
        summary = _summarize_feed([old_popular, new_update], "Latest")
        self.assertEqual(summary["tweets"][0]["id"], "2")

    def test_live_tweets_confirm_founder_support_and_mainstream_attention(self):
        official = [
            tweet(
                "1",
                "vladtenev",
                "While we're building Robinhood Chain for RWA, it works great for memes too",
                likes=9000,
            )
        ]
        discussion = [tweet(str(index + 10), f"author{index}", "$CASHCAT on Robinhood Chain", likes=5) for index in range(8)]
        result = evaluate_twitter_narrative(
            live_payload(official=official, cashcat=discussion), []
        )
        self.assertEqual(result["narrative"]["founder_support"]["state"], "supportive")
        self.assertEqual(result["narrative"]["mainstream_attention"]["state"], "mainstream")
        self.assertEqual(result["narrative"]["external_hotspot"]["state"], "none")

    def test_compromised_founder_account_quarantines_post_incident_tweets(self):
        compromise_notice = tweet(
            "100",
            "RobinhoodComms",
            "Our CEO Vlad Tenev's X account was compromised and posted a fake promotion for a meme coin.",
            created_at="2026-07-23T12:00:00+00:00",
        )
        security = _official_account_security([compromise_notice])
        official = [
            tweet(
                "1",
                "vladtenev",
                "Robinhood Chain works great for memes too",
                created_at="2026-07-22T10:00:00+00:00",
            ),
            tweet(
                "2",
                "vladtenev",
                "Robinhood Chain meme launch $SCAM",
                created_at="2026-07-23T13:00:00+00:00",
            ),
            compromise_notice,
        ]
        result = evaluate_twitter_narrative(
            live_payload(
                official=official,
                official_account_security=security,
            ),
            [],
        )
        founder = result["narrative"]["founder_support"]
        self.assertEqual(security["state"], "COMPROMISED")
        self.assertEqual(founder["state"], "supportive")
        self.assertEqual(founder["quarantined_post_count"], 1)
        self.assertIn("已隔离", founder["note"])

    def test_leadership_and_ecosystem_posts_are_counted_separately(self):
        official = [
            _annotate_account(
                tweet(
                    "1",
                    "JohannKerbrat",
                    "We are scaling the agentic economy on Robinhood Chain",
                )
            )
        ]
        ecosystem = [
            _annotate_account(
                tweet(
                    "2",
                    "arbitrum",
                    "Robinhood Chain passed 100M cumulative transactions",
                )
            )
        ]
        signals = evaluate_twitter_narrative(
            live_payload(official=official, ecosystem=ecosystem),
            [],
        )["signals"]["leadership_momentum"]
        self.assertEqual(signals["state"], "ACTIVE")
        self.assertEqual(signals["direct_account_count"], 1)
        self.assertEqual(signals["ecosystem_account_count"], 1)

    def test_airdrop_spam_does_not_count_as_mainstream_attention(self):
        spam = [
            tweet(str(index), f"spammer{index}", "CASHCAT airdrop: like and retweet, drop your wallet address")
            for index in range(12)
        ]
        result = evaluate_twitter_narrative(live_payload(cashcat=spam), [])
        self.assertEqual(result["narrative"]["mainstream_attention"]["state"], "unknown")
        self.assertEqual(result["signals"]["mainstream"]["post_count"], 0)

    def test_external_topic_needs_multiple_authors(self):
        external = [
            tweet("1", "alpha", "$PEPE is the new meme hotspot", likes=500),
            tweet("2", "beta", "Watching $PEPE momentum", likes=400),
        ]
        result = evaluate_twitter_narrative(live_payload(external=external), [])
        hotspot = result["narrative"]["external_hotspot"]
        self.assertEqual(hotspot["state"], "emerging")
        self.assertEqual(hotspot["name"], "PEPE")

    def test_external_topic_requires_three_rounds_before_confirmation(self):
        external = [
            tweet("1", "alpha", "$PEPE is the new meme hotspot", likes=1000),
            tweet("2", "beta", "Watching $PEPE momentum", likes=900),
            tweet("3", "gamma", "$PEPE volume is accelerating", likes=800),
        ]
        history = [
            {"analysis": {"narrative": {"evidence": {"external_hotspot": {"state": "emerging", "name": "PEPE"}}}}},
            {"analysis": {"narrative": {"evidence": {"external_hotspot": {"state": "emerging", "name": "PEPE"}}}}},
        ]
        result = evaluate_twitter_narrative(live_payload(external=external), history)
        self.assertEqual(result["narrative"]["external_hotspot"]["state"], "confirmed")

    def test_live_evidence_wins_and_manual_only_fills_live_unknowns(self):
        live = {
            "founder_support": {"state": "supportive", "source_kind": "twitter_live"},
            "mainstream_attention": {"state": "unknown", "source_kind": "twitter_live"},
            "external_hotspot": {"state": "none", "source_kind": "twitter_live"},
        }
        manual = {
            "founder_support": {"state": "negative", "source_kind": "manual"},
            "mainstream_attention": {"state": "mainstream", "source_kind": "manual"},
            "external_hotspot": {"state": "confirmed", "source_kind": "manual"},
        }
        merged = merge_live_and_manual_narrative(live, manual)
        self.assertEqual(merged["founder_support"]["state"], "supportive")
        self.assertEqual(merged["mainstream_attention"]["state"], "mainstream")
        self.assertEqual(merged["external_hotspot"]["state"], "none")


if __name__ == "__main__":
    unittest.main()
