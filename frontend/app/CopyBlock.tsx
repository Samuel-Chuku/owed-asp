'use client';

import { useState } from 'react';

export function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyblock">
      <div className="cb-head">
        <span className="cb-label">{label}</span>
        <button
          type="button"
          className="cb-btn"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? 'COPIED ✓' : 'COPY'}
        </button>
      </div>
      <pre className="cb-pre">{text}</pre>
    </div>
  );
}
