import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

const LISTING = process.env.NEXT_PUBLIC_LISTING_URL;

export function Nav({ current }: { current?: 'home' | 'scan' }) {
  return (
    <header className="nav">
      <div className="nav-in">
        <Link className="nav-brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/owed-mark.png" alt="" width={36} height={36} />
          <b>
            OW<span>ED</span>
          </b>
        </Link>
        <nav className="nav-links" aria-label="Main">
          <Link href="/#leak">The leak</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#rates">Rates</Link>
          <Link href="/#agents">For agents</Link>
        </nav>
        <div className="nav-acts">
          <ThemeToggle />
          <Link
            className="btn btn-hot"
            href="/scan"
            aria-current={current === 'scan' ? 'page' : undefined}
          >
            Run a scan
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Ticker() {
  return (
    <>
      <div className="ticker">
        <div className="ticker-in">
          <span className="sq" aria-hidden />
          <span className="chip chip-ink">Agent #5885 on OKX.AI</span>
          <span className="chip">Quick check: free</span>
          <span className="chip">Full audit: $0.50</span>
          <span className="chip chip-go">Claiming: always free</span>
          <span className="sq" aria-hidden />
        </div>
      </div>
      <div className="substrip">
        <div className="substrip-in">
          <span>
            <mark>Find it.</mark> Prove it. Claim it.
          </span>
          <Link className="chip chip-hot" href="/scan">
            Scan your catalog free ✦
          </Link>
        </div>
      </div>
    </>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="foot-in">
        <div>
          <div className="fbrand">
            OW<span>ED</span>
          </div>
          <p>
            <b>Owed</b> is not affiliated with The MLC. Registered-share percentages come from
            public records and every finding links to its source. Joining The MLC and claiming
            are free. Reports are educational guidance, not legal advice.
          </p>
        </div>
        <div className="foot-meta">
          <span>Sources: public US registry data</span>
          <span>Payments: x402 · USDT on X Layer</span>
          {LISTING ? (
            <a href={LISTING}>Agent #5885 on OKX.AI ↗</a>
          ) : (
            <span>Agent #5885 on OKX.AI</span>
          )}
          <a href="https://useowed.xyz/mcp">MCP endpoint: useowed.xyz/mcp</a>
        </div>
      </div>
    </footer>
  );
}
