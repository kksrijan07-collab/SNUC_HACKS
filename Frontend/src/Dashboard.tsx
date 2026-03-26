import { useEffect, useState, useCallback } from "react";
import SquadHealth, { Squad, SquadMember } from "./Squadhealth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserConfig {
  id: string;
  githubUsername: string;
  leetcodeUsername: string;
  hasMonkeytype: boolean;
}

interface AuditStatus {
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  error: string | null;
}

// ─── Mock data helpers (replace with real API calls) ──────────────────────────

function mockMember(id: string, username: string, score: number, met: boolean): SquadMember {
  return {
    id,
    username,
    avatar: `https://avatars.githubusercontent.com/${username}`,
    disciplineScore: score,
    thresholdMet: met,
    github: { commits: Math.floor(score * 8), pushEvents: Math.floor(score * 3) },
    leetcode: {
      easy:   met ? 1 : 0,
      medium: met ? Math.floor(Math.random() * 2) : 0,
      hard:   0,
    },
    monkeytype: { wpm: Math.round(40 + score * 60), consistency: Math.round(70 + score * 25) },
    lastVerified: new Date().toISOString(),
  };
}

function mockSquad(health: number): Squad {
  return {
    id: "squad-001",
    name: "PHANTOM UNIT",
    health,
    streak: 4,
    lastDecayAt: health < 100 ? new Date(Date.now() - 86400000).toISOString() : null,
    members: [
      mockMember("u1", "torvalds",   0.88, true),
      mockMember("u2", "gaearon",    0.72, true),
      mockMember("u3", "cassidoo",   0.45, false),
      mockMember("u4", "antfu",      0.91, true),
    ],
  };
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value" style={{ color: accent ?? "#fff" }}>
        {value}
      </p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

interface LogEntry {
  ts: string;
  msg: string;
  kind: "info" | "success" | "warn" | "error";
}

function AuditLog({ entries }: { entries: LogEntry[] }) {
  const colours = { info: "#888", success: "#00ff87", warn: "#ffd60a", error: "#ff3131" };
  return (
    <div className="audit-log">
      <p className="section-title">AUDIT LOG</p>
      <div className="log-body">
        {entries.length === 0 && <p className="log-empty">No audit runs yet.</p>}
        {[...entries].reverse().map((e, i) => (
          <div key={i} className="log-row">
            <span className="log-ts">{new Date(e.ts).toLocaleTimeString()}</span>
            <span className="log-dot" style={{ color: colours[e.kind] }}>●</span>
            <span className="log-msg" style={{ color: colours[e.kind] === "#888" ? "#bbb" : colours[e.kind] }}>
              {e.msg}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [squad, setSquad]       = useState<Squad>(mockSquad(80));
  const [status, setStatus]     = useState<AuditStatus>({
    running: false, lastRun: null, nextRun: null, error: null,
  });
  const [log, setLog]           = useState<LogEntry[]>([]);
  const [countdown, setCountdown] = useState(0);

  const pushLog = useCallback((msg: string, kind: LogEntry["kind"] = "info") => {
    setLog(prev => [...prev, { ts: new Date().toISOString(), msg, kind }]);
  }, []);

  // Simulated audit run
  const runAudit = useCallback(async () => {
    if (status.running) return;
    setStatus(s => ({ ...s, running: true, error: null }));
    pushLog("Audit initiated — contacting GitHub, LeetCode, Monkeytype…", "info");

    await new Promise(r => setTimeout(r, 800));
    pushLog("GitHub: 4/4 members verified ✓", "success");

    await new Promise(r => setTimeout(r, 600));
    pushLog("LeetCode: 3/4 members verified ✓ — cassidoo below threshold", "warn");

    await new Promise(r => setTimeout(r, 500));
    pushLog("Monkeytype: 4/4 results fetched ✓", "success");

    await new Promise(r => setTimeout(r, 300));

    // Apply decay if any member failed
    const anyFailed = squad.members.some(m => !m.thresholdMet);
    if (anyFailed) {
      const newHealth = Math.max(0, squad.health - 10);
      setSquad(prev => ({ ...prev, health: newHealth, lastDecayAt: new Date().toISOString() }));
      pushLog(`Discipline threshold missed — Squad health: ${squad.health} → ${newHealth} HP (-10)`, "error");
    } else {
      pushLog("All members met threshold — no health decay applied ✓", "success");
    }

    const next = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    setStatus({
      running: false,
      lastRun: new Date().toISOString(),
      nextRun: next,
      error: null,
    });
    setCountdown(24 * 60 * 60);
    pushLog("Audit complete. Next window in 24 h.", "info");
  }, [status.running, squad, pushLog]);

  // Countdown ticker
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  const hh = String(Math.floor(countdown / 3600)).padStart(2, "0");
  const mm = String(Math.floor((countdown % 3600) / 60)).padStart(2, "0");
  const ss = String(countdown % 60).padStart(2, "0");

  const avgDiscipline = Math.round(
    (squad.members.reduce((acc, m) => acc + m.disciplineScore, 0) / squad.members.length) * 100,
  );

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body, html { background: #060609; }

        .dashboard {
          min-height: 100vh;
          background: #060609;
          color: #e0e0e0;
          font-family: 'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
          padding: 0 0 60px;
        }

        /* ── top bar ── */
        .topbar {
          border-bottom: 1px solid #1a1a2e;
          padding: 14px 32px;
          display: flex; align-items: center; justify-content: space-between;
          background: #0a0a0f;
        }
        .logo { font-size: 1.1rem; font-weight: 800; letter-spacing: .2em; color: #fff; }
        .logo span { color: #00ff87; }
        .topbar-meta { font-size: .65rem; color: #555; letter-spacing: .08em; }

        /* ── main layout ── */
        .main { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }

        /* ── page header ── */
        .page-header { margin-bottom: 32px; }
        .page-title  {
          font-size: 2rem; font-weight: 800; letter-spacing: .06em; color: #fff;
          text-shadow: 0 0 40px #00ff8730;
        }
        .page-sub    { font-size: .72rem; color: #555; margin-top: 4px; letter-spacing: .1em; }

        /* ── stats row ── */
        .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 32px; }
        .stat-card {
          background: #0f0f1a; border: 1px solid #1e1e2e; border-radius: 10px;
          padding: 16px; position: relative; overflow: hidden;
        }
        .stat-card::before {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(135deg, #ffffff04, transparent);
          pointer-events: none;
        }
        .stat-label { font-size: .6rem; color: #555; letter-spacing: .12em; margin-bottom: 6px; }
        .stat-value { font-size: 1.4rem; font-weight: 700; }
        .stat-sub   { font-size: .6rem; color: #555; margin-top: 4px; }

        /* ── audit button ── */
        .audit-row { display: flex; align-items: center; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
        .audit-btn {
          font-family: inherit; font-size: .75rem; font-weight: 700;
          letter-spacing: .14em; padding: 10px 24px;
          background: #00ff8718; border: 1px solid #00ff8760;
          color: #00ff87; border-radius: 8px; cursor: pointer;
          transition: background .2s, box-shadow .2s;
          display: flex; align-items: center; gap: 8px;
        }
        .audit-btn:hover:not(:disabled) {
          background: #00ff8728;
          box-shadow: 0 0 16px #00ff8730;
        }
        .audit-btn:disabled { opacity: .4; cursor: not-allowed; }
        .audit-btn .spinner {
          width: 12px; height: 12px; border-radius: 50%;
          border: 2px solid transparent; border-top-color: #00ff87;
          animation: spin .7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .countdown { font-size: .68rem; color: #555; letter-spacing: .06em; }

        /* ── two-col layout ── */
        .two-col { display: grid; grid-template-columns: 1fr 340px; gap: 20px; align-items: start; }
        @media (max-width: 800px) { .two-col { grid-template-columns: 1fr; } }

        /* ── section title ── */
        .section-title { font-size: .6rem; color: #555; letter-spacing: .15em; margin-bottom: 12px; }

        /* ── audit log ── */
        .audit-log { background: #0a0a0f; border: 1px solid #1e1e2e; border-radius: 10px; padding: 16px; }
        .log-body  { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
        .log-row   { display: flex; align-items: baseline; gap: 8px; }
        .log-ts    { font-size: .6rem; color: #444; flex-shrink: 0; }
        .log-dot   { font-size: .5rem; flex-shrink: 0; }
        .log-msg   { font-size: .68rem; }
        .log-empty { font-size: .68rem; color: #444; }

        /* scrollbar */
        .log-body::-webkit-scrollbar       { width: 4px; }
        .log-body::-webkit-scrollbar-track { background: #0a0a0f; }
        .log-body::-webkit-scrollbar-thumb { background: #1e1e2e; border-radius: 2px; }
      `}</style>

      <div className="dashboard">
        {/* Top bar */}
        <header className="topbar">
          <div className="logo">SYN<span>CRO</span></div>
          <p className="topbar-meta">PROOF-OF-WORK ACCOUNTABILITY ENGINE · v1.0</p>
        </header>

        <main className="main">
          {/* Page header */}
          <div className="page-header">
            <h1 className="page-title">ACCOUNTABILITY DASHBOARD</h1>
            <p className="page-sub">AUTOMATED PROOF-OF-WORK VERIFICATION · NO MANUAL CHECK-INS</p>
          </div>

          {/* Stats */}
          <div className="stats-row">
            <StatCard
              label="SQUAD HEALTH"
              value={`${squad.health} HP`}
              sub="out of 100"
              accent={squad.health > 65 ? "#00ff87" : squad.health > 35 ? "#ffd60a" : "#ff3131"}
            />
            <StatCard label="AVG DISCIPLINE" value={`${avgDiscipline}%`} sub="60% required" accent="#a78bfa" />
            <StatCard label="ACTIVE STREAK"  value={`${squad.streak}d`}  sub="consecutive" accent="#ffd60a" />
            <StatCard label="MEMBERS" value={squad.members.length} sub={`${squad.members.filter(m => m.thresholdMet).length} passing`} />
            {countdown > 0 && (
              <StatCard label="NEXT AUDIT" value={`${hh}:${mm}:${ss}`} sub="countdown" accent="#00c7ff" />
            )}
          </div>

          {/* Audit controls */}
          <div className="audit-row">
            <button className="audit-btn" onClick={runAudit} disabled={status.running}>
              {status.running ? <span className="spinner" /> : "⚡"}
              {status.running ? "AUDITING…" : "RUN AUDIT NOW"}
            </button>
            {status.lastRun && (
              <span className="countdown">
                Last run: {new Date(status.lastRun).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Main two-col */}
          <div className="two-col">
            {/* Squad health widget */}
            <div>
              <p className="section-title">SQUAD STATUS</p>
              <SquadHealth squad={squad} onRefresh={runAudit} />
            </div>

            {/* Audit log */}
            <AuditLog entries={log} />
          </div>
        </main>
      </div>
    </>
  );
}
