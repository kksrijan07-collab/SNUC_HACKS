"""
SYNCRO :: AUDITOR ENGINE — main.py
FastAPI entry point. Exposes audit trigger, health, and dashboard routes.
All writes to Supabase use the service role key (bypasses RLS).
"""

from __future__ import annotations

import os
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Header, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, UUID4
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

from auditor_service import AuditorService
from Backend.scoring_logic import ScoringEngine, DecayEngine

load_dotenv()

# ── Supabase client (service role — bypasses RLS) ──────────────────────────
from supabase import create_client, Client

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY: str = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── APScheduler: runs the full audit loop every 6 hours ───────────────────
scheduler = AsyncIOScheduler(timezone="UTC")

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.add_job(run_full_audit_cycle, "interval", hours=6, id="full_audit")
    scheduler.start()
    print("⚙  SYNCRO Auditor Engine online. Scheduler armed.")
    yield
    scheduler.shutdown()
    print("⚙  Scheduler stopped.")


app = FastAPI(
    title="SYNCRO Auditor API",
    description="Proof-of-Work Accountability Engine — Backend Auditor",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth dependency: validates Supabase JWT from frontend ─────────────────
async def get_current_user(authorization: str = Header(...)):
    token = authorization.removeprefix("Bearer ").strip()
    try:
        user = supabase.auth.get_user(token)
        return user.user
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# ══════════════════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════════════════

@app.get("/health", tags=["System"])
async def health_check():
    """Liveness probe for Docker / load balancer."""
    return {"status": "operational", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/audit/me", tags=["Audit"])
async def audit_self(
    background_tasks: BackgroundTasks,
    current_user=Depends(get_current_user),
):
    """
    Trigger an immediate audit for the authenticated user.
    Returns the computed discipline score and audit summary.
    """
    profile = _get_profile(current_user.id)
    result = await _audit_single_user(profile)
    return {"user_id": str(current_user.id), "audit_result": result}


@app.get("/api/v1/dashboard/me", tags=["Dashboard"])
async def get_my_dashboard(current_user=Depends(get_current_user)):
    """Return the full dashboard payload for the authenticated user."""
    profile = _get_profile(current_user.id)
    squad = _get_squad(profile.get("squad_id"))

    recent_logs = (
        supabase.table("audit_logs")
        .select("source, discipline_pts, verified, timestamp, raw_data")
        .eq("user_id", current_user.id)
        .order("timestamp", desc=True)
        .limit(20)
        .execute()
        .data
    )

    health_events = []
    if squad:
        health_events = (
            supabase.table("squad_health_events")
            .select("delta, reason, timestamp")
            .eq("squad_id", squad["id"])
            .order("timestamp", desc=True)
            .limit(10)
            .execute()
            .data
        )

    return {
        "profile": {
            "username": profile["username"],
            "discipline_score": profile["discipline_score"],
            "github_user": profile["github_user"],
            "leetcode_user": profile["leetcode_user"],
            "last_audited_at": profile.get("last_audited_at"),
        },
        "squad": squad,
        "recent_audit_logs": recent_logs,
        "health_events": health_events,
    }


@app.get("/api/v1/squad/{squad_id}", tags=["Squad"])
async def get_squad(squad_id: str, current_user=Depends(get_current_user)):
    """Return squad info + member list."""
    squad = supabase.table("squads").select("*").eq("id", squad_id).single().execute().data
    if not squad:
        raise HTTPException(status_code=404, detail="Squad not found")

    members = (
        supabase.table("profiles")
        .select("username, discipline_score, last_audited_at")
        .eq("squad_id", squad_id)
        .execute()
        .data
    )
    return {"squad": squad, "members": members}


@app.post("/api/v1/squad/join/{invite_code}", tags=["Squad"])
async def join_squad(invite_code: str, current_user=Depends(get_current_user)):
    """Join a squad using its invite code."""
    squad = (
        supabase.table("squads")
        .select("id, squad_name")
        .eq("invite_code", invite_code)
        .single()
        .execute()
        .data
    )
    if not squad:
        raise HTTPException(status_code=404, detail="Invalid invite code")

    supabase.table("profiles").update({"squad_id": squad["id"]}).eq(
        "id", current_user.id
    ).execute()
    return {"message": f"Joined squad: {squad['squad_name']}", "squad_id": squad["id"]}


# ══════════════════════════════════════════════════════════════════════════
# INTERNAL: AUDIT CYCLE
# ══════════════════════════════════════════════════════════════════════════

async def run_full_audit_cycle():
    """
    Scheduled task: audits every user, writes logs,
    then applies squad health decay where thresholds are missed.
    """
    print(f"\n{'═'*60}")
    print(f"  SYNCRO AUDIT CYCLE — {datetime.now(timezone.utc).isoformat()}")
    print(f"{'═'*60}")

    profiles = supabase.table("profiles").select("*").execute().data
    decay_engine = DecayEngine(supabase)

    tasks = [_audit_single_user(p) for p in profiles]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for profile, result in zip(profiles, results):
        if isinstance(result, Exception):
            print(f"  ✗ {profile['username']}: {result}")
            continue
        print(f"  ✓ {profile['username']}: score={result['discipline_score']}")

        # Write score back to profile
        supabase.table("profiles").update(
            {
                "discipline_score": result["discipline_score"],
                "last_audited_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", profile["id"]).execute()

        # Apply decay if threshold not met
        if result["threshold_met"] is False and profile.get("squad_id"):
            await decay_engine.apply_decay(profile["squad_id"], profile["id"])
            print(f"    ⚠  Decay applied to squad {profile['squad_id']}")


async def _audit_single_user(profile: dict) -> dict:
    """Runs all three source audits for one user and returns scored result."""
    svc = AuditorService()
    scoring = ScoringEngine()

    github_data, leetcode_data, monkeytype_data = await asyncio.gather(
        svc.fetch_github_events(profile.get("github_user")),
        svc.fetch_leetcode_stats(profile.get("leetcode_user")),
        svc.fetch_monkeytype_results(profile.get("monkeytype_key")),
        return_exceptions=True,
    )

    logs_to_insert = []

    # GitHub
    if isinstance(github_data, dict) and not isinstance(github_data, Exception):
        pts = scoring.score_github(github_data)
        logs_to_insert.append(
            {
                "user_id": profile["id"],
                "source": "github",
                "raw_data": github_data,
                "discipline_pts": pts,
                "verified": pts > 0,
            }
        )
    else:
        pts = 0
    github_pts = pts

    # LeetCode
    if isinstance(leetcode_data, dict) and not isinstance(leetcode_data, Exception):
        pts = scoring.score_leetcode(leetcode_data)
        logs_to_insert.append(
            {
                "user_id": profile["id"],
                "source": "leetcode",
                "raw_data": leetcode_data,
                "discipline_pts": pts,
                "verified": pts > 0,
            }
        )
    else:
        pts = 0
    leetcode_pts = pts

    # Monkeytype
    if isinstance(monkeytype_data, dict) and not isinstance(monkeytype_data, Exception):
        pts = scoring.score_monkeytype(monkeytype_data)
        logs_to_insert.append(
            {
                "user_id": profile["id"],
                "source": "monkeytype",
                "raw_data": monkeytype_data,
                "discipline_pts": pts,
                "verified": pts > 0,
            }
        )
    else:
        pts = 0
    monkeytype_pts = pts

    # Batch-write audit logs
    if logs_to_insert:
        supabase.table("audit_logs").insert(logs_to_insert).execute()

    total, threshold_met = scoring.compute_discipline_score(
        github_pts, leetcode_pts, monkeytype_pts
    )

    return {
        "discipline_score": total,
        "threshold_met": threshold_met,
        "breakdown": {
            "github": github_pts,
            "leetcode": leetcode_pts,
            "monkeytype": monkeytype_pts,
        },
    }


def _get_profile(user_id: str) -> dict:
    result = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return result.data


def _get_squad(squad_id: str | None) -> dict | None:
    if not squad_id:
        return None
    result = supabase.table("squads").select("*").eq("id", squad_id).single().execute()
    return result.data
