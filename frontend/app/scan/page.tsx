import type { Metadata } from 'next';
import { Nav, Footer } from '../Chrome';
import { ScanFlow } from './ScanFlow';

export const metadata: Metadata = {
  title: 'Owed — run a royalty scan',
  description:
    'Free quick check and full royalty audit: what your songs earned in the US, what is being held, and how to claim it — every finding linked to the public record.',
};

export default function ScanPage() {
  return (
    <>
      <Nav current="scan" />
      <section className="scan-hero">
        <div className="sec-in">
          <h1 className="scan-title">
            The <em>scanner</em>
          </h1>
          <p className="sec-lead">
            Two steps. The quick check confirms your identity and previews the damage; the full
            audit documents every gap with evidence and prices the leak in dollar ranges.
          </p>
        </div>
      </section>
      <section className="sec">
        <div className="sec-in">
          <ScanFlow />
        </div>
      </section>
      <Footer />
    </>
  );
}
