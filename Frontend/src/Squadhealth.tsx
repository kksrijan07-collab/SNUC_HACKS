import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SquadMember {
  id: string;
  username: string;
  avatar: string;
  disciplineScore: number;   // 0–1
  thresholdMet: boolean;
  github: { commits: number; pushEvents: number };
  leetcode: { easy: number; medium: number; hard: number };
  monkeytype: { wpm: number; consistency: number };
  lastVerified: string;
}

export interface Squad {
  id: string;
  name: string;
  health: number;          // 0–100
  members: SquadMember[];
  lastDecayAt: string | null;
  streak: number;          // consecutive days threshold met
}

interface SquadHealthProps {
  squad: Squad;
  onRefresh?: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HealthBar({ health, prev }: { health: number; prev: number }) {
  const [displayed, setDisplayed] = useState(prev);
  const [shaking, setShaking]     = useState(false);

  useEffect(() => {
    if (health < prev) {
      setShaking(true);
      setTimeout(() => setShaking(false), 600);
    }
    const id = setTimeout(() => setDisplayed(health), 80);
    return () => clearTimeout(id);
  }, [health, prev]);

  const colour =
    displayed > 65 ? "#00ff87" :
    displayed > 35 ? "#ffd60a" :
    "#ff3131";

  return (
    <div className={`health-bar-wrap ${shaking ? "shake" : ""}`}>
      <div className="health-bar-track">
        <div
          className="health-bar-fill"
          style={{ width: `${displayed}%`, background: colour }}
        />
        {/* tick marks every 10 % */}
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className="health-tick"
            style={{ left: `${(i + 1) * 10}%` }}
          />
        ))}
      </div>
      <span className="health-label" style={{ color: colour }}>
        {Math.round(displayed)}
        <span className="health-unit">HP</span>
      </span>
    </div>
  );
}

function MemberCard({ m }: { m: SquadMember }) {
  const pct = Math.round(m.disciplineScore * 100);
  const ring = m.thresholdMet ? "#00ff87" : "#ff3131";

  return (
    <div className={`member-card ${m.thresholdMet ? "met" : "failed"}`}>
      {/* Avatar ring */}
      <div className="avatar-ring" style={{ "--ring": ring } as React.CSSProperties}>
        <img src={m.avatar} alt={m.username} className="avatar-img" />
        <span className="avatar-score">{pct}%</span>
      </div>

      <div className="member-info">
        <p className="member-name">{m.username}</p>

        <div className="proof-grid">
          {/* GitHub */}
          <div className="proof-item">
            <GhIcon />
            <span>{m.github.commits} commits</span>
          </div>
          {/* LeetCode */}
          <div className="proof-item">
            <LcIcon />
            <span>
              {m.leetcode.easy}E&nbsp;·&nbsp;
              {m.leetcode.medium}M&nbsp;·&nbsp;
              {m.leetcode.hard}H
            </span>
          </div>
          {/* Monkeytype */}
          <div className="proof-item">
            <MtIcon />
            <span>{m.monkeytype.wpm} wpm</span>
          </div>
        </div>

        <p className="member-verified">
          Verified {new Date(m.lastVerified).toLocaleTimeString()}
        </p>
      </div>

      {/* Discipline bar */}
      <div className="discipline-bar-track">
        <div
          className="discipline-bar-fill"
          style={{ width: `${pct}%`, background: ring }}
        />
      </div>
    </div>
  );
}

// Tiny inline SVG icons
const GhIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
      0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52
      -.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2
      -3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64
      -.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51
      .56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01
      2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const LcIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M13.5 2L6 14h6l-1.5 8 9-12h-6z" />
  </svg>
);

const MtIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 17h2v-7H3v7zm4 0h2V7H7v10zm4 0h2v-4h-2v4zm4 0h2V3h-2v14zm4 0h2v-9h-2v9z" />
  </svg>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SquadHealth({ squad, onRefresh }: SquadHealthProps) {
  const prevHealth  = useRef(squad.health);
  const decayed     = squad.health < prevHealth.current;
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (decayed) {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    }
    prevHealth.current = squad.health;
  }, [squad.health]);

  const failing = squad.members.filter(m => !m.thresholdMet);

  return (
    <>
      {/* ── scoped styles ── */}
      <style>{`
        .squad-root {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          background: #0a0a0f;
          color: #e0e0e0;
          border: 1px solid #1e1e2e;
          border-radius: 12px;
          padding: 24px;
          max-width: 720px;
          position: relative;
          overflow: hidden;
        }
        .squad-root::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse 60% 40% at 50% 0%, #00ff8710 0%, transparent 70%);
          pointer-events: none;
        }
        .flash-overlay {
          position: absolute;
          inset: 0;
          background: #ff313122;
          animation: flashOut .8s ease forwards;
          pointer-events: none;
          border-radius: 12px;
        }
        @keyframes flashOut { to { opacity: 0; } }

        /* header */
        .squad-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
        .squad-name   { font-size: 1.3rem; font-weight: 700; letter-spacing: .08em; color: #fff; }
        .streak-badge {
          font-size: .7rem; padding: 3px 10px; border-radius: 99px;
          background: #00ff8718; border: 1px solid #00ff8740; color: #00ff87;
          letter-spacing: .1em;
        }
        .refresh-btn {
          background: none; border: 1px solid #2a2a3e; color: #888; font-size: .7rem;
          font-family: inherit; padding: 4px 10px; border-radius: 6px; cursor: pointer;
          transition: border-color .2s, color .2s; letter-spacing: .08em;
        }
        .refresh-btn:hover { border-color: #00ff87; color: #00ff87; }

        /* health bar */
        .health-bar-wrap   { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .health-bar-track  { flex: 1; height: 10px; background: #1e1e2e; border-radius: 99px; position: relative; overflow: hidden; }
        .health-bar-fill   { height: 100%; border-radius: 99px; transition: width .6s cubic-bezier(.4,0,.2,1), background .4s; }
        .health-tick       { position: absolute; top: 0; bottom: 0; width: 1px; background: #0a0a0f55; }
        .health-label      { font-size: 1rem; font-weight: 700; min-width: 56px; text-align: right; }
        .health-unit       { font-size: .65rem; margin-left: 2px; opacity: .7; }
        .shake             { animation: shake .5s ease; }
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-6px)}
          40%{transform:translateX(6px)}
          60%{transform:translateX(-4px)}
          80%{transform:translateX(4px)}
        }

        /* warning banner */
        .decay-warning {
          background: #ff313112; border: 1px solid #ff313140; border-radius: 8px;
          padding: 8px 14px; margin-bottom: 18px;
          font-size: .72rem; color: #ff6b6b; letter-spacing: .06em;
        }

        /* member grid */
        .member-grid { display: flex; flex-direction: column; gap: 10px; }
        .member-card {
          display: flex; align-items: center; gap: 14px;
          background: #0f0f1a; border-radius: 10px;
          padding: 12px 14px; border: 1px solid #1e1e2e;
          position: relative; overflow: hidden;
          transition: border-color .2s;
        }
        .member-card.met    { border-color: #00ff8720; }
        .member-card.failed { border-color: #ff313120; }
        .member-card::after {
          content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
        }
        .member-card.met::after    { background: #00ff87; }
        .member-card.failed::after { background: #ff3131; }

        /* avatar */
        .avatar-ring {
          position: relative; flex-shrink: 0;
          width: 44px; height: 44px;
          border-radius: 50%;
          border: 2px solid var(--ring);
          box-shadow: 0 0 8px var(--ring)40;
        }
        .avatar-img  { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
        .avatar-score {
          position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%);
          font-size: .58rem; background: #0a0a0f; border: 1px solid #2a2a3e;
          padding: 1px 4px; border-radius: 4px; white-space: nowrap;
        }

        /* member info */
        .member-info { flex: 1; }
        .member-name { font-size: .82rem; font-weight: 600; color: #fff; margin: 0 0 6px; }
        .proof-grid  { display: flex; gap: 14px; flex-wrap: wrap; }
        .proof-item  { display: flex; align-items: center; gap: 5px; font-size: .68rem; color: #888; }
        .proof-item svg { opacity: .6; }
        .member-verified { font-size: .6rem; color: #555; margin: 6px 0 0; }

        /* discipline bar */
        .discipline-bar-track {
          position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: #1e1e2e;
        }
        .discipline-bar-fill { height: 100%; transition: width .6s ease, background .4s; }

        /* footer */
        .squad-footer { display: flex; justify-content: space-between; margin-top: 18px; font-size: .65rem; color: #555; }
      `}</style>

      <div className="squad-root">
        {flash && <div className="flash-overlay" />}

        {/* Header */}
        <div className="squad-header">
          <div>
            <p className="squad-name">{squad.name}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {squad.streak > 0 && (
              <span className="streak-badge">🔥 {squad.streak}d STREAK</span>
            )}
            {onRefresh && (
              <button className="refresh-btn" onClick={onRefresh}>
                ⟳ AUDIT
              </button>
            )}
          </div>
        </div>

        {/* Health bar */}
        <HealthBar health={squad.health} prev={prevHealth.current} />

        {/* Decay warning */}
        {failing.length > 0 && (
          <div className="decay-warning">
            ⚠ {failing.map(m => m.username).join(", ")}{" "}
            {failing.length === 1 ? "has" : "have"} not met the discipline threshold.
            Squad health will decay –10 HP at next checkpoint.
          </div>
        )}

        {/* Member cards */}
        <div className="member-grid">
          {squad.members.map(m => (
            <MemberCard key={m.id} m={m} />
          ))}
        </div>

        {/* Footer */}
        <div className="squad-footer">
          <span>DECAY THRESHOLD: 60% DISCIPLINE</span>
          {squad.lastDecayAt && (
            <span>Last decay: {new Date(squad.lastDecayAt).toLocaleDateString()}</span>
          )}
        </div>
      </div>
    </>
  );
}
