"""
SYNCRO :: scoring_logic.py
ScoringEngine  — scores raw proof-of-work payloads from AuditorService.
DecayEngine    — applies -10 HP to a squad when threshold is missed.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from supabase import Client

# ── Weights ────────────────────────────────────────────────────────────────
GITHUB_WEIGHT     = 0.40
LEETCODE_WEIGHT   = 0.35
MONKEYTYPE_WEIGHT = 0.25
DISCIPLINE_THRESHOLD = 0.60

GITHUB_TARGET_COMMITS   = 3
LEETCODE_TARGET_POINTS  = 3
MONKEYTYPE_TARGET_WPM   = 60.0
MONKEYTYPE_TARGET_CONS  = 85.0


class ScoringEngine:
    def score_github(self, data: dict) -> float:
        if not data or data.get("error"):
            return 0.0
        return min(data.get("commit_count", 0) / GITHUB_TARGET_COMMITS, 1.0)

    def score_leetcode(self, data: dict) -> float:
        if not data or data.get("error"):
            return 0.0
        pts = data.get("recent_ac_count", 0)
        return min(pts / LEETCODE_TARGET_POINTS, 1.0)

    def score_monkeytype(self, data: dict) -> float:
        if not data or data.get("error") or not data.get("within_window"):
            return 0.0
        wpm  = float(data.get("wpm", 0))
        cons = float(data.get("consistency", 0))
        return round(min(wpm / MONKEYTYPE_TARGET_WPM, 1.0) * 0.6 +
                     min(cons / MONKEYTYPE_TARGET_CONS, 1.0) * 0.4, 4)

    def compute_discipline_score(self, github_score, leetcode_score, monkeytype_score):
        total = round(
            github_score     * GITHUB_WEIGHT +
            leetcode_score   * LEETCODE_WEIGHT +
            monkeytype_score * MONKEYTYPE_WEIGHT, 4
        )
        return total, total >= DISCIPLINE_THRESHOLD


class DecayEngine:
    def __init__(self, supabase: "Client"):
        self._sb = supabase

    async def apply_decay(self, squad_id: str, user_id: str) -> None:
        loop = asyncio.get_event_loop()
        squad = await loop.run_in_executor(
            None,
            lambda: self._sb.table("squads").select("health").eq("id", squad_id).single().execute().data,
        )
        if not squad:
            return
        new_health = max(0, squad.get("health", 100) - 10)
        await loop.run_in_executor(
            None,
            lambda: self._sb.table("squads").update(
                {"health": new_health, "last_decay_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", squad_id).execute(),
        )
        await loop.run_in_executor(
            None,
            lambda: self._sb.table("squad_health_events").insert({
                "squad_id": squad_id, "user_id": user_id,
                "delta": -10, "reason": "discipline_threshold_missed",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }).execute(),
        )