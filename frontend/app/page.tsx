import { QuickCheck } from './QuickCheck';

// Every number on this page is from a real scan (Speedometer fixture,
// July 2026) — no invented metrics, per the honest-copy rule.

export default function Page() {
  return (
    <main className="sheet">
      <div className="band">
        <div className="brand">
          OW<span>ED</span> · ROYALTY AUDIT
        </div>
        <div className="meta">
          FOR ARTISTS, WRITERS &amp; PRODUCERS
          <br />
          SOURCES: PUBLIC US REGISTRY DATA
        </div>
      </div>

      <section className="verdict">
        <div className="eyebrow">Africa-first · works worldwide</div>
        <h1>
          Money is waiting on songs <em>you already wrote</em>.
        </h1>
        <p>
          Every month, US streaming services pay songwriter royalties on your music. If your
          ownership was never fully registered, your share is held in a US database instead of
          paid out — and eventually redistributed to major publishers. Owed reads the public
          registry and shows you exactly what is leaking, song by song, with links you can verify
          yourself.
        </p>
      </section>

      <QuickCheck />

      <section className="specimen">
        <h2>What a leak looks like</h2>
        <div className="src">Real finding · public MLC record, song code SB5VH7 · July 2026</div>
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
          <b>&ldquo;Speedometer&rdquo; — Shallipopi.</b> 76 recordings earning across Spotify,
          Apple Music, YouTube and Audiomack — and only half the ownership is registered. The
          other half of every US songwriter dollar it earns is held, reaching no one. Anyone can
          verify this on the public record; most artists never look.
        </p>
      </section>

      <section className="procedure">
        <h2>How an audit runs</h2>
        <div className="steps">
          <div className="pstep">
            <span className="side">A1</span>
            <div className="pt">
              <b>Your catalog, verified</b>
              <span>
                We build your song list from public music databases and match it to the registry
                by recording codes — never by name alone, so a same-name artist can&rsquo;t pollute
                your audit.
              </span>
            </div>
          </div>
          <div className="pstep">
            <span className="side">A2</span>
            <div className="pt">
              <b>Every gap, documented</b>
              <span>
                Song by song: how much ownership is registered, whose share is missing, and a link
                to the public record so you (or your lawyer) can check every claim.
              </span>
            </div>
          </div>
          <div className="pstep">
            <span className="side">B1</span>
            <div className="pt">
              <b>The fix, mapped</b>
              <span>
                The claim kit turns your audit into an ordered plan — membership, claims,
                registrations, tax forms for non-US writers — most artists finish it in an
                evening. Claiming itself is free.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="rates">
        <h2>Rate card</h2>
        <div className="rline">
          <span className="item">
            Quick check
            <span className="sub">Your first one, right here, on the house</span>
          </span>
          <span className="dots" />
          <span className="price free">FREE</span>
        </div>
        <div className="rline">
          <span className="item">
            Full royalty audit
            <span className="sub">Whole catalog · song-by-song statement · evidence links</span>
          </span>
          <span className="dots" />
          <span className="price">$0.50</span>
        </div>
        <div className="rline">
          <span className="item">
            Claim kit
            <span className="sub">Your personal fix plan, built from the audit</span>
          </span>
          <span className="dots" />
          <span className="price">$5</span>
        </div>
        <p className="where">
          Paid tools run through the Owed agent on OKX.AI — your AI assistant can call them
          directly. The registry itself is free to use; Owed charges for finding gaps and mapping
          the fix, never for &ldquo;registration.&rdquo;
        </p>
      </section>

      <div className="footband">
        <p>
          <b>Owed</b> is not affiliated with The MLC. Registered-share percentages come from
          public records and every finding links to its source. Joining The MLC and claiming are
          free. Reports are educational guidance, not legal advice.
        </p>
      </div>
    </main>
  );
}
