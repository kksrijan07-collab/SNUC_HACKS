"""
SYNCRO :: AUDITOR ENGINE — auditor_service.py
Fetches raw proof-of-work data from GitHub, LeetCode, and Monkeytype APIs.
All methods are async, return raw dicts for logging, raise on hard failure.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

# ── Constants ──────────────────────────────────────────────────────────────
GITHUB_API_BASE    = "https://api.github.com"
LEETCODE_GQL_URL   = "https://leetcode.com/graphql"
MONKEYTYPE_API_BASE = "https://api.monkeytype.com"
WINDOW_HOURS       = 24          # Discipline window
REQUEST_TIMEOUT    = 12.0        # seconds


class AuditorService:
    """
    Stateless service. Each method independently fetches and normalises
    one source's proof-of-work payload.
    """

    def __init__(self):
        self._client = httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "SYNCRO-Auditor/1.0"},
            follow_redirects=True,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self._client.aclose()

    # ══════════════════════════════════════════════════════════════════════
    # 1. GITHUB
    # ══════════════════════════════════════════════════════════════════════

    async def fetch_github_events(self, github_username: str | None) -> dict[str, Any]:
        """
        Fetches public events for `github_username` from the GitHub Events API.
        Filters to PushEvent and CreateEvent within the last WINDOW_HOURS.

        Returns a normalised dict:
          {
            "username": str,
            "window_hours": int,
            "push_events": [...],
            "create_events": [...],
            "commit_count": int,
            "repo_count": int,
            "fetched_at": ISO str
          }
        """
        if not github_username:
            return _empty_github()

        cutoff = datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)
        url = f"{GITHUB_API_BASE}/users/{github_username}/events/public"

        try:
            resp = await self._client.get(url, params={"per_page": 100})
            resp.raise_for_status()
            events: list[dict] = resp.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return _empty_github(error="GitHub user not found")
            raise

        push_events: list[dict] = []
        create_events: list[dict] = []
        commit_count = 0
        seen_repos: set[str] = set()

        for event in events:
            try:
                created_at = datetime.fromisoformat(
                    event["created_at"].replace("Z", "+00:00")
                )
            except (KeyError, ValueError):
                continue

            if created_at < cutoff:
                continue

            repo_name = event.get("repo", {}).get("name", "unknown")
            event_type = event.get("type")

            if event_type == "PushEvent":
                payload = event.get("payload", {})
                commits = payload.get("commits", [])
                commit_count += len(commits)
                seen_repos.add(repo_name)
                push_events.append(
                    {
                        "repo": repo_name,
                        "commits": len(commits),
                        "ref": payload.get("ref", ""),
                        "created_at": event["created_at"],
                    }
                )

            elif event_type == "CreateEvent":
                payload = event.get("payload", {})
                seen_repos.add(repo_name)
                create_events.append(
                    {
                        "repo": repo_name,
                        "ref_type": payload.get("ref_type", ""),
                        "ref": payload.get("ref", ""),
                        "created_at": event["created_at"],
                    }
                )

        return {
            "username": github_username,
            "window_hours": WINDOW_HOURS,
            "push_events": push_events,
            "create_events": create_events,
            "commit_count": commit_count,
            "repo_count": len(seen_repos),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }

    # ══════════════════════════════════════════════════════════════════════
    # 2. LEETCODE
    # ══════════════════════════════════════════════════════════════════════

    async def fetch_leetcode_stats(self, lc_username: str | None) -> dict[str, Any]:
        """
        Queries LeetCode's public GraphQL API for the user's solved problem stats
        and recent submission history (last 24 h).

        Returns:
          {
            "username": str,
            "solved": {"easy": int, "medium": int, "hard": int, "total": int},
            "recent_ac_count": int,   # accepted submissions in last 24h
            "recent_submissions": [...],
            "fetched_at": ISO str
          }
        """
        if not lc_username:
            return _empty_leetcode()

        # Two queries: profile stats + recent submissions
        stats_query = """
        query getUserStats($username: String!) {
          matchedUser(username: $username) {
            submitStats: submitStatsGlobal {
              acSubmissionNum {
                difficulty
                count
              }
            }
          }
        }
        """

        recent_query = """
        query getRecentSubmissions($username: String!, $limit: Int!) {
          recentAcSubmissionList(username: $username, limit: $limit) {
            id
            title
            titleSlug
            timestamp
          }
        }
        """

        try:
            stats_resp, recent_resp = await asyncio.gather(
                self._client.post(
                    LEETCODE_GQL_URL,
                    json={"query": stats_query, "variables": {"username": lc_username}},
                    headers={"Content-Type": "application/json", "Referer": "https://leetcode.com"},
                ),
                self._client.post(
                    LEETCODE_GQL_URL,
                    json={"query": recent_query, "variables": {"username": lc_username, "limit": 20}},
                    headers={"Content-Type": "application/json", "Referer": "https://leetcode.com"},
                ),
            )
            stats_resp.raise_for_status()
            recent_resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            return _empty_leetcode(error=f"LeetCode API error: {exc.response.status_code}")

        stats_data = stats_resp.json()
        recent_data = recent_resp.json()

        # Parse aggregate stats
        solved = {"easy": 0, "medium": 0, "hard": 0, "total": 0}
        matched = stats_data.get("data", {}).get("matchedUser")
        if matched:
            for entry in matched["submitStats"]["acSubmissionNum"]:
                diff = entry["difficulty"].lower()
                if diff in solved:
                    solved[diff] = entry["count"]
            solved["total"] = solved["easy"] + solved["medium"] + solved["hard"]

        # Filter recent AC submissions to 24h window
        cutoff_ts = (datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)).timestamp()
        recent_subs = recent_data.get("data", {}).get("recentAcSubmissionList", []) or []
        recent_24h = [
            s for s in recent_subs
            if int(s.get("timestamp", 0)) >= cutoff_ts
        ]

        return {
            "username": lc_username,
            "solved": solved,
            "recent_ac_count": len(recent_24h),
            "recent_submissions": recent_24h,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }

    # ══════════════════════════════════════════════════════════════════════
    # 3. MONKEYTYPE
    # ══════════════════════════════════════════════════════════════════════

    async def fetch_monkeytype_results(self, ape_key: str | None) -> dict[str, Any]:
        """
        Fetches the user's last typing test result from Monkeytype using their
        personal ApeKey (set in profile settings → API keys).

        Endpoint: GET /results/last
        Docs: https://api.monkeytype.com/docs/#/results/get_results_last

        Returns:
          {
            "wpm": float,
            "raw_wpm": float,
            "accuracy": float,
            "consistency": float,
            "mode": str,
            "mode2": str,
            "timestamp": int,
            "within_window": bool,
            "fetched_at": ISO str
          }
        """
        if not ape_key:
            return _empty_monkeytype()

        try:
            resp = await self._client.get(
                f"{MONKEYTYPE_API_BASE}/results/last",
                headers={"Authorization": f"ApeKey {ape_key}"},
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in (401, 403):
                return _empty_monkeytype(error="Invalid or expired Monkeytype ApeKey")
            return _empty_monkeytype(error=f"Monkeytype API error: {status}")

        data = resp.json().get("data", {})
        if not data:
            return _empty_monkeytype(error="No results found")

        cutoff_ts = int(
            (datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)).timestamp() * 1000
        )
        within_window = int(data.get("timestamp", 0)) >= cutoff_ts

        return {
            "wpm":           float(data.get("wpm", 0)),
            "raw_wpm":       float(data.get("rawWpm", 0)),
            "accuracy":      float(data.get("acc", 0)),
            "consistency":   float(data.get("consistency", 0)),
            "mode":          data.get("mode", "time"),
            "mode2":         str(data.get("mode2", "")),
            "timestamp":     data.get("timestamp", 0),
            "within_window": within_window,
            "fetched_at":    datetime.now(timezone.utc).isoformat(),
            "error":         None,
        }


# ── Helpers: empty payloads ────────────────────────────────────────────────

def _empty_github(error: str | None = None) -> dict:
    return {
        "username": None, "window_hours": WINDOW_HOURS,
        "push_events": [], "create_events": [],
        "commit_count": 0, "repo_count": 0,
        "fetched_at": datetime.now(timezone.utc).isoformat(), "error": error,
    }

def _empty_leetcode(error: str | None = None) -> dict:
    return {
        "username": None, "solved": {"easy": 0, "medium": 0, "hard": 0, "total": 0},
        "recent_ac_count": 0, "recent_submissions": [],
        "fetched_at": datetime.now(timezone.utc).isoformat(), "error": error,
    }

def _empty_monkeytype(error: str | None = None) -> dict:
    return {
        "wpm": 0.0, "raw_wpm": 0.0, "accuracy": 0.0, "consistency": 0.0,
        "mode": "", "mode2": "", "timestamp": 0, "within_window": False,
        "fetched_at": datetime.now(timezone.utc).isoformat(), "error": error,
    }
