import Link from 'next/link';
import { CopyBlock } from './CopyBlock';
import { Nav, Ticker, Footer } from './Chrome';

// Every number on this page is from a real scan (Speedometer fixture,
// July 2026) — no invented metrics, per the honest-copy rule.

const LISTING = process.env.NEXT_PUBLIC_LISTING_URL;

export default function Page() {
  return (
    <>
      <Nav current="home" />
      <Ticker />

      <section className="hero">
        <div className="hero-in">
          <div className="hero-copy">
            <h1 className="hero-title">
              Get what
              <br />
              you&rsquo;re <em>owed</em>
            </h1>
            <p className="hero-sub">
              Every month, US streaming services pay songwriter royalties on your music. If your
              ownership was never fully registered, your share is <b>held in a US database</b>{' '}
              instead of paid out — and eventually redistributed to major publishers. Owed reads
              the public registry and shows you exactly what is leaking, song by song, with links
              you can verify yourself.
            </p>
            <div className="hero-ctas">
              <Link className="btn btn-hot btn-big" href="/scan">
                Find my money
              </Link>
              <a className="btn btn-go btn-big" href="#agents">
                Wire your agent
              </a>
            </div>
            <p className="hero-works">Works for: artists · writers · producers · estates</p>
          </div>
          <div className="hero-panel" aria-hidden>
            {LISTING ? (
              <a className="chip panel-chip" href={LISTING} aria-hidden={false}>
                Listed on OKX.AI ↗
              </a>
            ) : (
              <span className="chip panel-chip">Agent #5885 · OKX.AI</span>
            )}
            <span className="shape shape-square" />
            <span className="shape shape-circle" />
            <span className="shape shape-dot" />
            <span className="shape shape-diamond" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-mark" src="/owed-mark.png" alt="" />
          </div>
        </div>
      </section>

      <section className="sec" id="leak">
        <div className="sec-in">
          <h2>What a leak looks like</h2>
          <p className="sec-lead">
            This is a real finding from the public record — song code SB5VH7, July 2026. Anyone
            can verify it; most artists never look.
          </p>
          <div className="slab">
            <div className="src">Real finding · public MLC record · &ldquo;Speedometer&rdquo; — Shallipopi</div>
            <div className="split-labels">
              <span className="l">BEING PAID OUT</span>
              <span className="r">HELD / UNCLAIMED</span>
            </div>
            <div className="bar">
              <div className="claimed" style={{ width: '50%' }}>
                50%
              </div>
              <div className="leaking" style={{ width: '50%' }}>
                50%
              </div>
            </div>
            <p className="caption">
              <b>76 recordings earning</b> across Spotify, Apple Music, YouTube and Audiomack —
              and only half the ownership is registered. The other half of every US songwriter
              dollar it earns is held, reaching no one.
            </p>
          </div>
        </div>
      </section>

      <section className="sec sec-dim" id="how">
        <div className="sec-in">
          <h2>How an audit runs</h2>
          <div className="steps">
            <div className="step">
              <span className="chip chip-ink">Step 01</span>
              <b>Your catalog, verified</b>
              <span>
                We build your song list from public music databases and match it to the registry
                by recording codes — never by name alone, so a same-name artist can&rsquo;t
                pollute your audit.
              </span>
            </div>
            <div className="step">
              <span className="chip chip-ink">Step 02</span>
              <b>Every gap, documented</b>
              <span>
                Song by song: how much ownership is registered, whose share is missing, and a
                link to the public record so you (or your lawyer) can check every claim.
              </span>
            </div>
            <div className="step">
              <span className="chip chip-ink">Step 03</span>
              <b>The fix, mapped</b>
              <span>
                The claim kit turns your audit into an ordered plan — membership, claims,
                registrations, tax forms for non-US writers. Most artists finish it in an
                evening. Claiming itself is free.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="rates">
        <div className="sec-in">
          <h2>Rate card</h2>
          <div className="rates-card">
            <div className="rline">
              <span className="item">
                Quick check
                <span className="sub">Sampled scan · leak score · right here on the site</span>
              </span>
              <span className="dots" />
              <span className="chip chip-go">FREE</span>
            </div>
            <div className="rline">
              <span className="item">
                Full royalty audit
                <span className="sub">Whole catalog · song-by-song statement · evidence links</span>
              </span>
              <span className="dots" />
              <span className="chip chip-hot">$0.50</span>
            </div>
            <div className="rline">
              <span className="item">
                Claim kit
                <span className="sub">Your personal fix plan, built from the audit</span>
              </span>
              <span className="dots" />
              <span className="chip chip-hot">$5</span>
            </div>
          </div>
          <p className="rates-note">
            Prices are what AI agents pay on OKX.AI, settled in USDT on X Layer. On this site,
            scans are free while we launch. Owed charges for finding gaps and mapping the fix —
            never for &ldquo;registration.&rdquo; The registry itself is free to use.
          </p>
        </div>
      </section>

      <section className="sec sec-dim" id="agents">
        <div className="sec-in">
          <h2>Wire your agent</h2>
          <p className="sec-lead">
            Owed is an agent service — any assistant that speaks MCP over HTTP can run audits for
            you. One endpoint, no keys. Paid calls settle over x402.
          </p>
          <CopyBlock
            label="Claude Code"
            text="claude mcp add --transport http owed https://useowed.xyz/mcp"
          />
          <CopyBlock
            label="Any MCP client (config JSON)"
            text={`{ "mcpServers": { "owed": { "url": "https://useowed.xyz/mcp" } } }`}
          />
          <CopyBlock
            label="Raw HTTP (see the tools)"
            text={`curl -X POST https://useowed.xyz/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
          />
          <p className="wire-note">
            Then ask your agent: <em>&ldquo;run a royalty quick check on Shallipopi.&rdquo;</em>{' '}
            On OKX.AI, Owed is Agent&nbsp;#5885.
          </p>
        </div>
      </section>

      <Footer />
    </>
  );
}
