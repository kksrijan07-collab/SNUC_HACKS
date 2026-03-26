-- =============================================================================
-- SYNCRO — Accountability Engine
-- Database Migration v1
-- =============================================================================
-- Run order: execute top-to-bottom in a single transaction.
-- Compatible with: PostgreSQL 15+
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username            TEXT        NOT NULL UNIQUE,
    email               TEXT        NOT NULL UNIQUE,
    password_hash       TEXT        NOT NULL,

    -- Third-party credentials (encrypted at application layer)
    github_username     TEXT,
    leetcode_username   TEXT,
    monkeytype_ape_key  TEXT,           -- store encrypted; decrypt only in auditor

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_github_username
    ON users (github_username)
    WHERE github_username IS NOT NULL;

-- ---------------------------------------------------------------------------
-- SQUADS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS squads (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT        NOT NULL,
    health          SMALLINT    NOT NULL DEFAULT 100
                                CHECK (health BETWEEN 0 AND 100),
    streak          INTEGER     NOT NULL DEFAULT 0,
    last_decay_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- SQUAD MEMBERS (junction)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS squad_members (
    squad_id    UUID    NOT NULL REFERENCES squads (id) ON DELETE CASCADE,
    user_id     UUID    NOT NULL REFERENCES users  (id) ON DELETE CASCADE,
    role        TEXT    NOT NULL DEFAULT 'member'
                        CHECK (role IN ('owner', 'member')),
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (squad_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_squad_members_user_id ON squad_members (user_id);

-- ---------------------------------------------------------------------------
-- AUDIT RUNS
-- One row per automated 24-hour audit window per squad.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_runs (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    squad_id        UUID        NOT NULL REFERENCES squads (id) ON DELETE CASCADE,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    health_before   SMALLINT    NOT NULL,
    health_after    SMALLINT,
    decay_applied   BOOLEAN     NOT NULL DEFAULT FALSE,
    status          TEXT        NOT NULL DEFAULT 'running'
                                CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_squad_id   ON audit_runs (squad_id);
CREATE INDEX IF NOT EXISTS idx_audit_runs_started_at ON audit_runs (started_at DESC);

-- ---------------------------------------------------------------------------
-- PROOF-OF-WORK RECORDS
-- Immutable ledger — one row per user per audit run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proof_of_work (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    audit_run_id    UUID        NOT NULL REFERENCES audit_runs (id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users      (id) ON DELETE CASCADE,

    -- Discipline summary
    discipline_score    NUMERIC(5, 4)   NOT NULL CHECK (discipline_score BETWEEN 0 AND 1),
    threshold_met       BOOLEAN         NOT NULL,

    -- GitHub sub-scores
    gh_push_events      INTEGER         NOT NULL DEFAULT 0,
    gh_create_events    INTEGER         NOT NULL DEFAULT 0,
    gh_total_commits    INTEGER         NOT NULL DEFAULT 0,
    gh_score            NUMERIC(5, 4)   NOT NULL DEFAULT 0,

    -- LeetCode sub-scores
    lc_easy_solved      SMALLINT        NOT NULL DEFAULT 0,
    lc_medium_solved    SMALLINT        NOT NULL DEFAULT 0,
    lc_hard_solved      SMALLINT        NOT NULL DEFAULT 0,
    lc_score            NUMERIC(5, 4)   NOT NULL DEFAULT 0,

    -- Monkeytype sub-scores
    mt_wpm              NUMERIC(6, 1)   NOT NULL DEFAULT 0,
    mt_consistency      NUMERIC(5, 1)   NOT NULL DEFAULT 0,
    mt_score            NUMERIC(5, 4)   NOT NULL DEFAULT 0,

    verified_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    UNIQUE (audit_run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pow_user_id      ON proof_of_work (user_id);
CREATE INDEX IF NOT EXISTS idx_pow_audit_run_id ON proof_of_work (audit_run_id);
CREATE INDEX IF NOT EXISTS idx_pow_verified_at  ON proof_of_work (verified_at DESC);

-- ---------------------------------------------------------------------------
-- HEALTH HISTORY
-- Append-only log of every HP change for charting / analytics.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS squad_health_history (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    squad_id    UUID        NOT NULL REFERENCES squads (id) ON DELETE CASCADE,
    health      SMALLINT    NOT NULL,
    delta       SMALLINT    NOT NULL,          -- negative = decay, positive = recovery
    reason      TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_history_squad_id
    ON squad_health_history (squad_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Trigger: keep updated_at current on users & squads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at'
    ) THEN
        CREATE TRIGGER trg_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_squads_updated_at'
    ) THEN
        CREATE TRIGGER trg_squads_updated_at
        BEFORE UPDATE ON squads
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Trigger: append to health_history whenever squad.health changes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_squad_health_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.health IS DISTINCT FROM OLD.health THEN
        INSERT INTO squad_health_history (squad_id, health, delta, reason)
        VALUES (
            NEW.id,
            NEW.health,
            NEW.health - OLD.health,
            CASE
                WHEN NEW.health < OLD.health THEN 'discipline_threshold_missed'
                ELSE                               'manual_adjustment'
            END
        );
    END IF;
    RETURN NEW;
END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'trg_log_health_change'
    ) THEN
        CREATE TRIGGER trg_log_health_change
        AFTER UPDATE OF health ON squads
        FOR EACH ROW EXECUTE FUNCTION log_squad_health_change();
    END IF;
END $$;

COMMIT;

-- =============================================================================
-- Rollback script (save separately as migration_v1_rollback.sql)
-- =============================================================================
-- DROP TABLE IF EXISTS squad_health_history  CASCADE;
-- DROP TABLE IF EXISTS proof_of_work         CASCADE;
-- DROP TABLE IF EXISTS audit_runs            CASCADE;
-- DROP TABLE IF EXISTS squad_members         CASCADE;
-- DROP TABLE IF EXISTS squads                CASCADE;
-- DROP TABLE IF EXISTS users                 CASCADE;
-- DROP FUNCTION IF EXISTS log_squad_health_change();
-- DROP FUNCTION IF EXISTS set_updated_at();
