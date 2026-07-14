'use client';

import { useEffect, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8402';
const LISTING = process.env.NEXT_PUBLIC_LISTING_URL;

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

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'result'; data: CheckResult }
  | { kind: 'ambiguous'; data: Ambiguous }
  | { kind: 'notfound' }
  | { kind: 'error'; message: string };

const SCAN_LINES = [
  'reading your catalog from public music databases',
  'matching recordings by their unique codes',
  'querying the US songwriter registry, politely',
  'checking who is registered to collect',
];

export function QuickCheck() {
  const [name, setName] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [lineIdx, setLineIdx] = useState(0);
  const scanning = state.kind === 'scanning';
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (scanning) {
      timer.current = setInterval(() => setLineIdx((i) => (i + 1) % SCAN_LINES.length), 4000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [scanning]);

  async function run(query: string) {
    if (!query.trim() || scanning) return;
    setState({ kind: 'scanning' });
    setLineIdx(0);
    try {
      const res = await fetch(`${API}/api/quick-check?artist=${encodeURIComponent(query.trim())}`);
      if (res.status === 429) {
        setState({ kind: 'error', message: 'One check per 20 seconds — try again shortly.' });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      if (json.status === 'complete') setState({ kind: 'result', data: json });
      else if (json.status === 'ambiguous') setState({ kind: 'ambiguous', data: json });
      else setState({ kind: 'notfound' });
    } catch {
      setState({
        kind: 'error',
        message: 'The check could not run. Give it a minute and try again.',
      });
    }
  }

  return (
    <section className="checker">
      <div className="label">Run a free quick check</div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(name);
        }}
      >
        <input
          className="field"
          type="text"
          placeholder="Your artist name, e.g. Shallipopi"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={scanning}
          aria-label="Artist name"
        />
        <button className="go" type="submit" disabled={scanning || !name.trim()}>
          {scanning ? 'Checking…' : 'Check my songs'}
        </button>
      </form>
      <p className="fine">
        No signup. We read public registry data only — nothing about you is stored.
      </p>

      {scanning && (
        <div className="state scanning" role="status">
          <b>AUDIT IN PROGRESS</b> · {SCAN_LINES[lineIdx]}… This takes about a minute — we
          rate-limit our registry calls on purpose.
        </div>
      )}

      {state.kind === 'error' && <div className="state error-note">{state.message}</div>}

      {state.kind === 'notfound' && (
        <div className="state error-note">
          No artist found under that name in the public catalogs. Check the spelling, or try the
          name on your streaming profile.
        </div>
      )}

      {state.kind === 'ambiguous' && (
        <div className="state candidates">
          <div className="chead">More than one artist goes by that name — which one is you?</div>
          {state.data.candidates.slice(0, 4).map((c) => (
            <button key={c.name + (c.disambiguation ?? '')} onClick={() => void run(c.name)}>
              {c.name}{' '}
              <small>
                {[c.disambiguation, c.country].filter(Boolean).join(' · ')}
              </small>
            </button>
          ))}
        </div>
      )}

      {state.kind === 'result' && <Result data={state.data} />}
    </section>
  );
}

function Result({ data }: { data: CheckResult }) {
  const leaking = data.gapsExist;
  return (
    <div className="state result" role="status">
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
        The full audit covers your whole catalog with per-song evidence.
      </p>
      <div className="racts">
        {LISTING ? (
          <>
            <a className="btn hot" href={LISTING}>
              Get the full audit · $5
            </a>
            <a className="btn" href={LISTING}>
              Claim kit · $19
            </a>
          </>
        ) : (
          <span className="btn wait">Full audit · $5 — coming to OKX.AI (listing in review)</span>
        )}
      </div>
    </div>
  );
}
