'use client';

import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8402';

type CheckResult = {
  status: 'complete';
  artist: string;
  sampledTracks: number;
  registeredWorksVerified: number;
  gapsExist: boolean;
  criticalGaps: number;
  unregisteredTracks: number;
  leakScorePreview: number;
};
type Ambiguous = {
  status: 'ambiguous';
  candidates: { name: string; disambiguation?: string; country?: string }[];
};

type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; data: CheckResult }
  | { kind: 'ambiguous'; data: Ambiguous }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string };

type AuditState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; scanId: string; progress: string[] }
  | { kind: 'complete'; reportUrl: string; kitUrl: string; cached: boolean }
  | { kind: 'error'; message: string };

const CHECK_LINES = [
  'reading your catalog from public music databases',
  'matching recordings by their unique codes',
  'querying the US songwriter registry, politely',
  'checking who is registered to collect',
];

export function ScanFlow() {
  const [name, setName] = useState('');
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [audit, setAudit] = useState<AuditState>({ kind: 'idle' });
  const [lineIdx, setLineIdx] = useState(0);
  const checking = check.kind === 'checking';
  const lineTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (checking) {
      lineTimer.current = setInterval(
        () => setLineIdx((i) => (i + 1) % CHECK_LINES.length),
        4000,
      );
    }
    return () => {
      if (lineTimer.current) clearInterval(lineTimer.current);
    };
  }, [checking]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function runCheck(query: string) {
    if (!query.trim() || checking) return;
    setCheck({ kind: 'checking' });
    setAudit({ kind: 'idle' });
    setLineIdx(0);
    try {
      const res = await fetch(`${API}/api/quick-check?artist=${encodeURIComponent(query.trim())}`);
      if (res.status === 429) {
        setCheck({ kind: 'error', message: 'One check per 20 seconds — try again shortly.' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      if (json.status === 'complete') setCheck({ kind: 'result', data: json });
      else if (json.status === 'ambiguous') setCheck({ kind: 'ambiguous', data: json });
      else setCheck({ kind: 'notfound' });
    } catch {
      setCheck({
        kind: 'error',
        message: 'The check could not run. Give it a minute and try again.',
      });
    }
  }

  function pollStatus(scanId: string) {
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/scan-status/${scanId}`);
        if (!res.ok) return; // transient — keep polling
        const json = await res.json();
        if (json.status === 'complete') {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setAudit({ kind: 'complete', reportUrl: json.reportUrl, kitUrl: json.kitUrl, cached: false });
        } else if (json.status === 'error') {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setAudit({
            kind: 'error',
            message: 'The audit hit a snag on our side. Your quick check still stands — try the full audit again in a few minutes.',
          });
        } else {
          setAudit({ kind: 'running', scanId, progress: json.progress ?? [] });
        }
      } catch {
        /* transient network error — keep polling */
      }
    }, 15000);
  }

  async function runAudit(artist: string) {
    setAudit({ kind: 'starting' });
    try {
      const res = await fetch(`${API}/api/scan?artist=${encodeURIComponent(artist)}`);
      if (res.status === 429) {
        setAudit({ kind: 'error', message: 'One full audit per 2 minutes — try again shortly.' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      if (json.status === 'complete') {
        setAudit({ kind: 'complete', reportUrl: json.reportUrl, kitUrl: json.kitUrl, cached: true });
      } else {
        setAudit({ kind: 'running', scanId: json.scanId, progress: [] });
        pollStatus(json.scanId);
      }
    } catch {
      setAudit({ kind: 'error', message: 'The audit could not start. Give it a minute and try again.' });
    }
  }

  return (
    <div className="flow">
      <div className="flow-step">
        <div className="flow-tag">
          <span className="chip chip-ink">Step 1</span>
          <span className="chip chip-go">FREE · ~1 MIN</span>
        </div>
        <h3>Quick check</h3>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void runCheck(name);
          }}
        >
          <input
            className="field"
            type="text"
            placeholder="Your artist name, e.g. Shallipopi"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={checking}
            aria-label="Artist name"
          />
          <button
            className="btn btn-hot"
            type="submit"
            disabled={checking || !name.trim()}
            data-busy={checking}
          >
            {checking ? 'Checking…' : 'Check my songs'}
          </button>
        </form>
        <p className="fine">
          No signup. We read public registry data only — nothing about you is stored.
        </p>

        {checking && (
          <div className="console" role="status">
            <b>CHECK IN PROGRESS</b> · {CHECK_LINES[lineIdx]}… This takes about a minute — we
            rate-limit our registry calls on purpose.
          </div>
        )}

        {check.kind === 'error' && <div className="error-note">{check.message}</div>}

        {check.kind === 'notfound' && (
          <div className="error-note">
            No artist found under that name in the public catalogs. Check the spelling, or try
            the name on your streaming profile.
          </div>
        )}

        {check.kind === 'ambiguous' && (
          <div className="candidates">
            <div className="chead">More than one artist goes by that name — which one is you?</div>
            {check.data.candidates.slice(0, 4).map((c) => (
              <button key={c.name + (c.disambiguation ?? '')} onClick={() => void runCheck(c.name)}>
                {c.name}{' '}
                <small>{[c.disambiguation, c.country].filter(Boolean).join(' · ')}</small>
              </button>
            ))}
          </div>
        )}

        {check.kind === 'result' && <CheckCard data={check.data} />}
      </div>

      <div className={`flow-step${check.kind === 'result' ? '' : ' locked'}`}>
        <div className="flow-tag">
          <span className="chip chip-ink">Step 2</span>
          <span className="chip chip-go">FREE ON THE SITE · 2–10 MIN</span>
        </div>
        <h3>Full audit</h3>
        <p className="fine">
          Your whole catalog, song by song: registered shares, whose money is held, dollar-range
          estimates, and a link to the public record behind every finding. Ends with a shareable
          audit statement and your claim kit.
        </p>

        {check.kind !== 'result' && audit.kind === 'idle' && (
          <p className="fine">
            <b>Run the quick check first</b> — it confirms which artist you are, so the audit
            scans the right catalog.
          </p>
        )}

        {check.kind === 'result' && (audit.kind === 'idle' || audit.kind === 'error') && (
          <div className="row">
            <button className="btn btn-hot btn-big" onClick={() => void runAudit(check.data.artist)}>
              Audit {check.data.artist}&rsquo;s full catalog
            </button>
          </div>
        )}

        {audit.kind === 'starting' && (
          <div className="console" role="status">
            <b>STARTING</b> · opening a scan job…
          </div>
        )}

        {audit.kind === 'running' && (
          <div className="console" role="status">
            <b>AUDIT RUNNING</b> · scan {audit.scanId.slice(0, 8)} · this takes 2–10 minutes (we
            rate-limit registry calls on purpose). Leave this tab open.
            {audit.progress.map((p) => (
              <span className="cline" key={p}>
                → {p}
              </span>
            ))}
          </div>
        )}

        {audit.kind === 'error' && <div className="error-note">{audit.message}</div>}

        {audit.kind === 'complete' && (
          <div className="result" role="status">
            <div className="rhead">
              <span className="rname">Your audit is ready</span>
              <span className="stamp ok">{audit.cached ? 'FROM TODAY’S SCAN' : 'COMPLETE'}</span>
            </div>
            <div className="rnote rnote-pad">
              Both pages are permanent and shareable — send them to your manager, your publisher,
              or your lawyer.
            </div>
            <div className="deliver deliver-pad">
              <a className="btn btn-hot btn-big" href={audit.reportUrl} target="_blank" rel="noopener">
                View the audit statement ↗
              </a>
              <a className="btn btn-go btn-big" href={audit.kitUrl} target="_blank" rel="noopener">
                Open the claim kit ↗
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CheckCard({ data }: { data: CheckResult }) {
  const leaking = data.gapsExist;
  return (
    <div className="result" role="status">
      <div className="rhead">
        <span className="rname">{data.artist}</span>
        <span className={`stamp${leaking ? '' : ' ok'}`}>
          {leaking ? 'LEAKS FOUND' : 'LOOKS CLEAN'}
        </span>
      </div>
      <div className="rgrid">
        <div>
          <div className="num">{data.leakScorePreview}</div>
          <div className="lbl">Leak score / 100 (sampled)</div>
        </div>
        <div>
          <div className="num">{data.criticalGaps}</div>
          <div className="lbl">Critical issues found</div>
        </div>
        <div>
          <div className="num g">{data.registeredWorksVerified}</div>
          <div className="lbl">Works verified as yours</div>
        </div>
      </div>
      <p className="rnote">
        Sampled from {data.sampledTracks} of your tracks
        {data.unregisteredTracks > 0
          ? ` — ${data.unregisteredTracks} of them have no US registration at all.`
          : '.'}{' '}
        The full audit covers your whole catalog with per-song evidence — run it below.
      </p>
    </div>
  );
}
