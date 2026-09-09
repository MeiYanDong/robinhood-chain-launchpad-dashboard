from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


# Reuses the proven TwitterAPI.io request and normalization path from the user's
# x-api-virtuals-base, IntelOS and 42space projects. This module is read-only.
DEFAULT_BASE_URL = "https://api.twitterapi.io"
MONITORED_ACCOUNTS = {
    "robinhoodapp": {
        "handle": "RobinhoodApp",
        "role": "Robinhood 公司官方",
        "tier": "company",
    },
    "robinhoodcomms": {
        "handle": "RobinhoodComms",
        "role": "Robinhood 官方传播与安全公告",
        "tier": "company",
    },
    "robinhoodapp_eu": {
        "handle": "RobinhoodApp_EU",
        "role": "Robinhood 欧洲官方",
        "tier": "company",
    },
    "vladtenev": {
        "handle": "vladtenev",
        "role": "联合创始人兼首席执行官",
        "tier": "executive",
    },
    "johannkerbrat": {
        "handle": "JohannKerbrat",
        "role": "加密与国际业务负责人",
        "tier": "operator",
    },
    "baijubhatt": {
        "handle": "BaijuBhatt",
        "role": "联合创始人兼董事",
        "tier": "board",
    },
}
ECOSYSTEM_ACCOUNTS = {
    "arbitrum": {
        "handle": "arbitrum",
        "role": "Robinhood Chain 技术栈生态",
        "tier": "ecosystem",
    },
    "uniswap": {
        "handle": "Uniswap",
        "role": "Robinhood Chain DEX 生态",
        "tier": "ecosystem",
    },
    "alchemyplatform": {
        "handle": "AlchemyPlatform",
        "role": "Robinhood Chain 基础设施生态",
        "tier": "ecosystem",
    },
    "chainlink": {
        "handle": "chainlink",
        "role": "Robinhood Chain 预言机生态",
        "tier": "ecosystem",
    },
    "bitgo": {
        "handle": "BitGo",
        "role": "Robinhood Chain 托管生态",
        "tier": "ecosystem",
    },
}
OFFICIAL_ACCOUNTS = set(MONITORED_ACCOUNTS)
OFFICIAL_QUERY = (
    "("
    + " OR ".join(
        f"from:{item['handle']}" for item in MONITORED_ACCOUNTS.values()
    )
    + ') ("Robinhood Chain" OR crypto OR meme OR memecoin OR CASHCAT) -is:retweet'
)
FOUNDER_QUERY = (
    'from:vladtenev "Robinhood Chain" '
    "(meme OR memes OR memecoin) -is:retweet"
)
ECOSYSTEM_QUERY = (
    "("
    + " OR ".join(
        f"from:{item['handle']}" for item in ECOSYSTEM_ACCOUNTS.values()
    )
    + ') "Robinhood Chain" -is:retweet'
)
MAJOR_TICKERS = {
    "BTC",
    "ETH",
    "SOL",
    "BNB",
    "USDT",
    "USDC",
    "USD",
    "XRP",
    "DOGE",
    "CASHCAT",
}
SPAM_PATTERNS = (
    "airdrop",
    "drop your",
    "wallet address",
    "like and retweet",
    "like & retweet",
    "claim rewards",
    "claim your",
    "presale",
    "giveaway",
    "whitelist",
    "free tokens",
    "send me your",
    "dm me",
    "join telegram",
)


def _number(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _first_string(*values: Any) -> str:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return ""


def _record(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _iso(value: Optional[dt.datetime] = None) -> str:
    return (value or dt.datetime.now(dt.timezone.utc)).isoformat(timespec="seconds")


def _parse_datetime(value: Any) -> Optional[dt.datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def _extract_items(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("tweets", "data", "results", "items", "statuses"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    for key in ("data", "result"):
        nested = payload.get(key)
        if not isinstance(nested, dict):
            continue
        for nested_key in ("tweets", "items", "results"):
            value = nested.get(nested_key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _normalize_tweet(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    author = _record(item.get("author")) or _record(item.get("user"))
    public_metrics = _record(item.get("public_metrics"))
    metrics = _record(item.get("metrics"))
    tweet_id = _first_string(item.get("id"), item.get("id_str"), item.get("tweetId"), item.get("rest_id"))
    text = html.unescape(
        _first_string(item.get("text"), item.get("full_text"), item.get("content"), _record(item.get("noteTweet")).get("text"))
    )
    if not tweet_id or not text:
        return None
    username = _first_string(
        author.get("userName"),
        author.get("username"),
        author.get("screen_name"),
        item.get("authorUsername"),
        item.get("userName"),
        item.get("username"),
    ).lstrip("@")
    author_name = _first_string(author.get("name"), author.get("displayName"), item.get("authorName"))
    created = _parse_datetime(
        _first_string(item.get("createdAt"), item.get("created_at"), item.get("created_at_iso"), item.get("timestamp"))
    )
    url = _first_string(item.get("url"), item.get("tweet_url"), item.get("tweetUrl"), item.get("link"))
    if not url and username:
        url = f"https://x.com/{username}/status/{tweet_id}"
    normalized_metrics = {
        "replies": int(_number(item.get("replyCount") or item.get("reply_count") or public_metrics.get("reply_count") or metrics.get("replyCount"))),
        "reposts": int(_number(item.get("retweetCount") or item.get("retweet_count") or public_metrics.get("retweet_count") or metrics.get("retweetCount"))),
        "likes": int(_number(item.get("likeCount") or item.get("favorite_count") or public_metrics.get("like_count") or metrics.get("likeCount"))),
        "quotes": int(_number(item.get("quoteCount") or item.get("quote_count") or public_metrics.get("quote_count") or metrics.get("quoteCount"))),
        "views": int(_number(item.get("viewCount") or item.get("view_count") or public_metrics.get("impression_count") or metrics.get("viewCount"))),
        "bookmarks": int(_number(item.get("bookmarkCount") or item.get("bookmark_count") or public_metrics.get("bookmark_count") or metrics.get("bookmarkCount"))),
    }
    engagement = (
        normalized_metrics["likes"]
        + normalized_metrics["replies"]
        + 2 * normalized_metrics["reposts"]
        + 2 * normalized_metrics["quotes"]
    )
    return {
        "id": tweet_id,
        "url": url,
        "author_username": username,
        "author_name": author_name,
        "verified": bool(
            item.get("verified")
            or item.get("isVerified")
            or item.get("isBlueVerified")
            or author.get("verified")
            or author.get("isVerified")
            or author.get("isBlueVerified")
        ),
        "created_at": _iso(created) if created else None,
        "text": text[:1200],
        "metrics": normalized_metrics,
        "engagement": engagement,
    }


def _load_key_from_file(path: Path) -> Optional[str]:
    if not path.exists() or not path.is_file():
        return None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for raw in lines:
        line = raw.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "TWITTERAPI_IO_KEY":
            cleaned = value.strip().strip("\"'")
            return cleaned or None
    return None


def find_twitter_api_key() -> Optional[str]:
    configured = os.getenv("TWITTERAPI_IO_KEY")
    if configured:
        return configured.strip()
    for path in (
        Path.home() / ".codex" / "secrets" / "twitterapi-io.env",
        Path.home() / ".Codex" / "secrets" / "twitterapi-io.env",
    ):
        key = _load_key_from_file(path)
        if key:
            return key
    return None


class TwitterLiveError(RuntimeError):
    pass


class TwitterLiveClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: int = 30,
        minimum_request_interval_seconds: float = 5.2,
        api_key: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.minimum_request_interval_seconds = max(0.0, minimum_request_interval_seconds)
        self.api_key = api_key or find_twitter_api_key()
        self._request_lock = threading.Lock()
        self._last_request_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, recency_hours: int, query_type: str = "Latest") -> List[Dict[str, Any]]:
        if not self.api_key:
            raise TwitterLiveError("TwitterAPI.io credential is not configured")
        since = int((dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=recency_hours)).timestamp())
        windowed_query = query if "since_time:" in query else f"({query}) since_time:{since}"
        params = urllib.parse.urlencode({"query": windowed_query, "queryType": query_type})
        url = f"{self.base_url}/twitter/tweet/advanced_search?{params}"
        request = urllib.request.Request(
            url,
            headers={"X-API-Key": self.api_key, "Accept": "application/json"},
        )
        with self._request_lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self.minimum_request_interval_seconds:
                time.sleep(self.minimum_request_interval_seconds - elapsed)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read(240).decode("utf-8", "replace")
                raise TwitterLiveError(f"TwitterAPI.io HTTP {exc.code}: {detail}") from exc
            except (OSError, ValueError) as exc:
                raise TwitterLiveError(f"TwitterAPI.io request failed: {exc}") from exc
            finally:
                self._last_request_at = time.monotonic()
        tweets = []
        for item in _extract_items(payload):
            normalized = _normalize_tweet(item)
            if normalized:
                tweets.append(normalized)
        tweets.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return tweets


def _is_spam(tweet: Dict[str, Any]) -> bool:
    text = str(tweet.get("text") or "").lower()
    return any(pattern in text for pattern in SPAM_PATTERNS)


def _dedupe(tweets: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for tweet in tweets:
        tweet_id = str(tweet.get("id") or "")
        if not tweet_id or tweet_id in seen:
            continue
        seen.add(tweet_id)
        result.append(tweet)
    return result


def _annotate_account(tweet: Dict[str, Any]) -> Dict[str, Any]:
    item = dict(tweet)
    username = str(tweet.get("author_username") or "").lower()
    account = MONITORED_ACCOUNTS.get(username) or ECOSYSTEM_ACCOUNTS.get(username)
    if account:
        item["account_role"] = account["role"]
        item["account_tier"] = account["tier"]
    return item


def _official_account_security(tweets: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    compromise_terms = (
        "account was compromised",
        "account compromised",
        "account was hacked",
        "account hacked",
        "fake promotion",
        "fake meme coin",
        "fake memecoin",
    )
    restore_terms = (
        "access has been restored",
        "access restored",
        "account has been restored",
        "account restored",
        "regained access",
        "back in control",
    )
    trusted_announcers = {"robinhoodcomms", "robinhoodapp"}
    notices = []
    for tweet in tweets:
        author = str(tweet.get("author_username") or "").lower()
        if author not in trusted_announcers:
            continue
        text = str(tweet.get("text") or "").lower()
        kind = None
        if any(term in text for term in compromise_terms):
            kind = "COMPROMISED"
        elif any(term in text for term in restore_terms):
            kind = "RESTORED"
        if kind:
            notices.append({**tweet, "kind": kind})
    notices.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    latest = notices[0] if notices else None
    compromise = next(
        (item for item in notices if item.get("kind") == "COMPROMISED"),
        None,
    )
    recovery = next(
        (
            item
            for item in notices
            if item.get("kind") == "RESTORED"
            and (
                not compromise
                or str(item.get("created_at") or "")
                > str(compromise.get("created_at") or "")
            )
        ),
        None,
    )
    if compromise and not recovery:
        state = "COMPROMISED"
        note = (
            "Robinhood 官方传播账号确认 Vlad 的 X 账号被盗；"
            "恢复确认前，新发内容不作为投资判断证据。"
        )
    elif recovery:
        state = "RESTORED"
        note = "Robinhood 官方已确认 Vlad 的 X 账号恢复控制。"
    else:
        state = "NO_ALERT"
        note = "本轮官方账号范围内未发现账号安全公告。"
    return {
        "state": state,
        "note": note,
        "observed_at": (latest or {}).get("created_at"),
        "source_url": (latest or {}).get("url") or "",
        "compromised_at": (compromise or {}).get("created_at"),
        "restored_at": (recovery or {}).get("created_at"),
        "notices": notices[:3],
    }


def _summarize_feed(
    tweets: List[Dict[str, Any]],
    query_type: str = "Latest",
) -> Dict[str, Any]:
    credible = [tweet for tweet in tweets if not _is_spam(tweet)]
    authors = {
        str(tweet.get("author_username") or "").lower()
        for tweet in credible
        if tweet.get("author_username")
    }
    ordered_tweets = (
        sorted(
            credible,
            key=lambda item: (
                int(_number(item.get("engagement"))),
                int(_number(_record(item.get("metrics")).get("views"))),
            ),
            reverse=True,
        )
        if query_type == "Top"
        else sorted(
            credible,
            key=lambda item: item.get("created_at") or "",
            reverse=True,
        )
    )
    return {
        "result_count": len(tweets),
        "credible_count": len(credible),
        "filtered_spam_count": len(tweets) - len(credible),
        "unique_authors": len(authors),
        "total_engagement": sum(int(_number(tweet.get("engagement"))) for tweet in credible),
        "total_views": sum(int(_number(_record(tweet.get("metrics")).get("views"))) for tweet in credible),
        "latest_tweet_at": max((tweet.get("created_at") or "" for tweet in credible), default=None),
        "tweets": _dedupe(ordered_tweets),
    }


class TwitterLiveCollector:
    def __init__(self, client: TwitterLiveClient, target_address: str):
        self.client = client
        self.target_address = target_address.lower()

    def collect(self) -> Dict[str, Any]:
        observed_at = _iso()
        if not self.client.configured:
            return {
                "status": "NOT_CONFIGURED",
                "mode": "LIVE",
                "source": "TwitterAPI.io",
                "observed_at": observed_at,
                "configured": False,
                "feeds": {},
                "error": "TwitterAPI.io credential is not configured",
            }
        definitions = {
            "official": {
                "label": "Robinhood 官方、负责人及联合创始人",
                "query": OFFICIAL_QUERY,
                "hours": 24 * 30,
                "type": "Latest",
            },
            "cashcat": {
                "label": "Cash Cat 实时讨论",
                "query": f'("Cash Cat" OR CASHCAT OR "{self.target_address}") -is:retweet',
                "hours": 24,
                "type": "Latest",
            },
            "founder": {
                "label": "创始人 Meme 立场原帖",
                "query": FOUNDER_QUERY,
                "hours": 24 * 30,
                "type": "Latest",
            },
            "ecosystem": {
                "label": "Robinhood Chain 生态伙伴",
                "query": ECOSYSTEM_QUERY,
                "hours": 24 * 7,
                "type": "Latest",
            },
            "robinhood": {
                "label": "Robinhood Chain 实时讨论",
                "query": '("Robinhood Chain" OR "chain 4663") -is:retweet',
                "hours": 24,
                "type": "Latest",
            },
            "external": {
                "label": "外部 Meme 新热点",
                "query": '(memecoin OR "meme coin") (Solana OR Base OR BNB OR Ethereum OR Hyperliquid) -is:retweet -("Robinhood Chain" OR CASHCAT)',
                "hours": 24,
                "type": "Top",
            },
        }
        feeds: Dict[str, Any] = {}
        errors = []
        started = time.monotonic()
        for key, definition in definitions.items():
            try:
                tweets = self.client.search(
                    str(definition["query"]),
                    int(definition["hours"]),
                    str(definition["type"]),
                )
                if key in ("official", "founder", "ecosystem"):
                    tweets = [_annotate_account(tweet) for tweet in tweets]
                feeds[key] = {
                    "label": definition["label"],
                    "status": "OK",
                    "query": definition["query"],
                    "window_hours": definition["hours"],
                    "query_type": definition["type"],
                    **_summarize_feed(tweets, str(definition["type"])),
                }
            except TwitterLiveError as exc:
                errors.append(f"{key}: {exc}")
                feeds[key] = {
                    "label": definition["label"],
                    "status": "ERROR",
                    "query": definition["query"],
                    "window_hours": definition["hours"],
                    "query_type": definition["type"],
                    "result_count": 0,
                    "credible_count": 0,
                    "filtered_spam_count": 0,
                    "unique_authors": 0,
                    "total_engagement": 0,
                    "total_views": 0,
                    "latest_tweet_at": None,
                    "tweets": [],
                }
        success_count = sum(1 for feed in feeds.values() if feed.get("status") == "OK")
        status = "OK" if success_count == len(feeds) else "PARTIAL" if success_count else "ERROR"
        official_security = _official_account_security(
            list(_record(feeds.get("official")).get("tweets") or [])
        )
        return {
            "status": status,
            "mode": "LIVE",
            "source": "TwitterAPI.io",
            "source_documentation": "https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search",
            "observed_at": observed_at,
            "configured": True,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "account_scope": [
                {
                    "handle": item["handle"],
                    "role": item["role"],
                    "tier": item["tier"],
                }
                for item in MONITORED_ACCOUNTS.values()
            ],
            "ecosystem_scope": [
                {
                    "handle": item["handle"],
                    "role": item["role"],
                    "tier": item["tier"],
                }
                for item in ECOSYSTEM_ACCOUNTS.values()
            ],
            "official_account_security": official_security,
            "feeds": feeds,
            "errors": errors,
        }


def _tweet_score(tweet: Dict[str, Any]) -> float:
    metrics = _record(tweet.get("metrics"))
    return _number(tweet.get("engagement")) + _number(metrics.get("views")) * 0.002


def _best_tweet(tweets: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    items = list(tweets)
    return max(items, key=_tweet_score) if items else None


def _median(values: List[float]) -> Optional[float]:
    clean = [value for value in values if isinstance(value, (int, float))]
    return statistics.median(clean) if clean else None


def _previous_signal(history: List[Dict[str, Any]], key: str, field: str) -> List[float]:
    values = []
    for snapshot in history:
        signal = (((snapshot.get("twitter") or {}).get("signals") or {}).get(key) or {})
        value = signal.get(field)
        if isinstance(value, (int, float)):
            values.append(float(value))
    return values


def _external_topics(tweets: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    topics: Dict[str, Dict[str, Any]] = {}
    for tweet in tweets:
        if _is_spam(tweet):
            continue
        symbols = {symbol.upper() for symbol in re.findall(r"\$([A-Za-z][A-Za-z0-9]{1,9})\b", str(tweet.get("text") or ""))}
        for symbol in symbols - MAJOR_TICKERS:
            topic = topics.setdefault(symbol, {"name": symbol, "tweets": [], "authors": set(), "score": 0.0})
            topic["tweets"].append(tweet)
            if tweet.get("author_username"):
                topic["authors"].add(str(tweet["author_username"]).lower())
            topic["score"] += _tweet_score(tweet)
    results = []
    for topic in topics.values():
        results.append(
            {
                "name": topic["name"],
                "post_count": len(topic["tweets"]),
                "unique_authors": len(topic["authors"]),
                "score": round(topic["score"], 2),
                "top_tweet": _best_tweet(topic["tweets"]),
            }
        )
    return sorted(results, key=lambda item: item["score"], reverse=True)


def evaluate_twitter_narrative(
    twitter: Dict[str, Any], history: List[Dict[str, Any]]
) -> Dict[str, Any]:
    observed_at = twitter.get("observed_at") or _iso()
    feeds = twitter.get("feeds") if isinstance(twitter.get("feeds"), dict) else {}
    empty = {
        "state": "unknown",
        "observed_at": observed_at,
        "source_url": "",
        "note": "Twitter 实盘数据不可用。",
        "source_kind": "twitter_live",
        "fresh_hours": 1,
    }
    if twitter.get("status") not in ("OK", "PARTIAL"):
        return {
            "narrative": {
                "founder_support": dict(empty),
                "mainstream_attention": dict(empty),
                "external_hotspot": {**empty, "name": ""},
            },
            "signals": {},
        }

    official_tweets = list(_record(feeds.get("official")).get("tweets") or [])
    account_security = _record(twitter.get("official_account_security"))
    security_state = str(account_security.get("state") or "NO_ALERT")
    compromised_at = _parse_datetime(account_security.get("compromised_at"))
    restored_at = _parse_datetime(account_security.get("restored_at"))

    def trusted_vlad_tweet(tweet: Dict[str, Any]) -> bool:
        created_at = _parse_datetime(tweet.get("created_at"))
        if not created_at or not compromised_at:
            return security_state != "COMPROMISED"
        if created_at < compromised_at:
            return True
        if restored_at and created_at >= restored_at:
            return True
        return False

    all_vlad_tweets = _dedupe(
        official_tweets
        + list(_record(feeds.get("founder")).get("tweets") or [])
    )
    all_vlad_tweets = [
        tweet
        for tweet in all_vlad_tweets
        if str(tweet.get("author_username") or "").lower() == "vladtenev"
    ]
    vlad_tweets = [tweet for tweet in all_vlad_tweets if trusted_vlad_tweet(tweet)]
    quarantined_vlad_posts = len(all_vlad_tweets) - len(vlad_tweets)
    founder_negative = None
    founder_supportive = None
    negative_terms = ("not support", "no longer", "shut down", "ban memes", "stop memes", "against memes")
    for tweet in vlad_tweets:
        text = str(tweet.get("text") or "").lower()
        if "robinhood chain" not in text or not any(term in text for term in ("meme", "memecoin")):
            continue
        if any(term in text for term in negative_terms):
            founder_negative = tweet
            break
        founder_supportive = founder_supportive or tweet
    founder_tweet = founder_negative or founder_supportive
    if founder_negative:
        founder_state = "negative"
        founder_note = "Vlad Tenev 的原帖对 Robinhood Chain Meme 表达了明确反对。"
    elif founder_supportive:
        founder_state = "supportive"
        founder_note = "Vlad Tenev 的原帖明确表示 Robinhood Chain 对 memes 同样有效。"
    else:
        founder_state = "unknown"
        founder_note = "近 30 天官方推文中没有找到可直接判断创始人 Meme 立场的新原帖。"
    if security_state == "COMPROMISED":
        security_note = (
            "Robinhood 官方已通报 Vlad 的 X 账号被盗；恢复确认前，"
            f"事发后的 {quarantined_vlad_posts} 条内容已隔离，不参与判断。"
        )
        founder_note = f"{founder_note} {security_note}"
    elif security_state == "RESTORED":
        founder_note = f"{founder_note} Robinhood 官方已确认账号恢复控制。"
    founder = {
        "state": founder_state,
        "observed_at": founder_tweet.get("created_at") if founder_tweet else observed_at,
        "source_url": founder_tweet.get("url") if founder_tweet else "",
        "note": founder_note,
        "source_kind": "twitter_live",
        "fresh_hours": 24 * 30,
        "tweet": founder_tweet,
        "account_security": account_security,
        "quarantined_post_count": quarantined_vlad_posts,
    }
    security_notice_urls = {
        str(item.get("url") or "")
        for item in account_security.get("notices") or []
        if item.get("url")
    }
    leadership_tweets = [
        tweet
        for tweet in official_tweets
        if str(tweet.get("url") or "") not in security_notice_urls
        and str(tweet.get("author_username") or "").lower() != "vladtenev"
        and "robinhood chain" in str(tweet.get("text") or "").lower()
        and not _is_spam(tweet)
    ]
    ecosystem_tweets = [
        tweet
        for tweet in list(_record(feeds.get("ecosystem")).get("tweets") or [])
        if not _is_spam(tweet)
    ]
    leadership_accounts = {
        str(tweet.get("author_username") or "").lower()
        for tweet in leadership_tweets
        if tweet.get("author_username")
    }
    ecosystem_accounts = {
        str(tweet.get("author_username") or "").lower()
        for tweet in ecosystem_tweets
        if tweet.get("author_username")
    }
    latest_leadership_tweet = _best_tweet(leadership_tweets + ecosystem_tweets)

    discussion_tweets = _dedupe(
        list(_record(feeds.get("cashcat")).get("tweets") or [])
        + list(_record(feeds.get("robinhood")).get("tweets") or [])
    )
    credible_discussion = [tweet for tweet in discussion_tweets if not _is_spam(tweet)]
    discussion_authors = {
        str(tweet.get("author_username") or "").lower()
        for tweet in credible_discussion
        if tweet.get("author_username")
    }
    discussion_engagement = sum(int(_number(tweet.get("engagement"))) for tweet in credible_discussion)
    discussion_views = sum(int(_number(_record(tweet.get("metrics")).get("views"))) for tweet in credible_discussion)
    author_baseline_values = _previous_signal(history, "mainstream", "unique_authors")
    engagement_baseline_values = _previous_signal(history, "mainstream", "engagement")
    author_baseline = _median(author_baseline_values[:50])
    engagement_baseline = _median(engagement_baseline_values[:50])
    if len(credible_discussion) >= 8 and len(discussion_authors) >= 6:
        mainstream_state = "mainstream"
    elif (
        len(author_baseline_values) >= 6
        and author_baseline
        and engagement_baseline
        and len(discussion_authors) <= max(1, author_baseline * 0.25)
        and discussion_engagement <= engagement_baseline * 0.25
    ):
        mainstream_state = "gone"
    elif (
        len(author_baseline_values) >= 6
        and author_baseline
        and len(discussion_authors) < author_baseline * 0.60
    ):
        mainstream_state = "fading"
    else:
        mainstream_state = "unknown"
    best_discussion = _best_tweet(credible_discussion)
    mainstream = {
        "state": mainstream_state,
        "observed_at": observed_at,
        "source_url": best_discussion.get("url") if best_discussion else "",
        "note": (
            f"过去 24 小时实时检索到 {len(credible_discussion)} 条有效讨论、"
            f"{len(discussion_authors)} 位作者、{discussion_engagement:,} 次加权互动。"
        ),
        "source_kind": "twitter_live",
        "fresh_hours": 1,
        "tweet": best_discussion,
    }

    external_tweets = list(_record(feeds.get("external")).get("tweets") or [])
    topics = _external_topics(external_tweets)
    strongest = topics[0] if topics else None
    cashcat_score = sum(_tweet_score(tweet) for tweet in list(_record(feeds.get("cashcat")).get("tweets") or []) if not _is_spam(tweet))
    emerging = bool(
        strongest
        and strongest["post_count"] >= 2
        and strongest["unique_authors"] >= 2
        and strongest["score"] >= max(200.0, cashcat_score * 1.25)
    )
    previous_topics = []
    if strongest:
        for snapshot in history[:2]:
            item = (((snapshot.get("analysis") or {}).get("narrative") or {}).get("evidence") or {}).get("external_hotspot") or {}
            if item.get("name") == strongest["name"] and item.get("state") in ("emerging", "confirmed"):
                previous_topics.append(item.get("name"))
    confirmed = bool(
        emerging
        and strongest
        and strongest["post_count"] >= 3
        and strongest["unique_authors"] >= 3
        and strongest["score"] >= max(1000.0, cashcat_score * 1.5)
        and len(previous_topics) >= 2
    )
    if confirmed:
        hotspot_state = "confirmed"
    elif emerging:
        hotspot_state = "emerging"
    else:
        hotspot_state = "none"
    hotspot_tweet = strongest.get("top_tweet") if strongest else None
    hotspot_name = strongest.get("name") if strongest else ""
    hotspot = {
        "state": hotspot_state,
        "observed_at": observed_at,
        "source_url": hotspot_tweet.get("url") if hotspot_tweet else "",
        "note": (
            f"最强外部候选 ${hotspot_name}：{strongest['post_count']} 条、"
            f"{strongest['unique_authors']} 位作者；尚未达到连续确认门槛。"
            if strongest
            else "本轮实时推文中未发现跨作者重复确认的外部 Meme 热点。"
        ),
        "source_kind": "twitter_live",
        "fresh_hours": 1,
        "name": hotspot_name,
        "tweet": hotspot_tweet,
    }
    return {
        "narrative": {
            "founder_support": founder,
            "mainstream_attention": mainstream,
            "external_hotspot": hotspot,
        },
        "signals": {
            "mainstream": {
                "post_count": len(credible_discussion),
                "unique_authors": len(discussion_authors),
                "engagement": discussion_engagement,
                "views": discussion_views,
            },
            "external": {
                "cashcat_score": round(cashcat_score, 2),
                "strongest_topic": hotspot_name,
                "strongest_score": strongest.get("score") if strongest else 0,
                "topic_count": len(topics),
            },
            "official_account_security": {
                "state": security_state,
                "quarantined_post_count": quarantined_vlad_posts,
                "source_url": account_security.get("source_url") or "",
            },
            "leadership_momentum": {
                "state": (
                    "ACTIVE"
                    if leadership_tweets or ecosystem_tweets
                    else "QUIET"
                ),
                "direct_post_count": len(leadership_tweets),
                "direct_account_count": len(leadership_accounts),
                "ecosystem_post_count": len(ecosystem_tweets),
                "ecosystem_account_count": len(ecosystem_accounts),
                "latest_tweet": latest_leadership_tweet,
            },
        },
    }


def merge_live_and_manual_narrative(
    live: Dict[str, Any], manual: Dict[str, Any]
) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    for key in ("founder_support", "mainstream_attention", "external_hotspot"):
        live_item = _record(live.get(key))
        manual_item = _record(manual.get(key))
        merged[key] = live_item if live_item.get("state") not in (None, "unknown") else manual_item or live_item
    return merged


def compact_twitter_snapshot(twitter: Dict[str, Any], tweets_per_feed: int = 8) -> Dict[str, Any]:
    compact = dict(twitter)
    compact_feeds = {}
    for key, feed in _record(twitter.get("feeds")).items():
        if not isinstance(feed, dict):
            continue
        item = dict(feed)
        item["tweets"] = list(feed.get("tweets") or [])[:tweets_per_feed]
        compact_feeds[key] = item
    compact["feeds"] = compact_feeds
    return compact
