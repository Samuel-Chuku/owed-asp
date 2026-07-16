'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('owed-theme');
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved);
    } else {
      setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('owed-theme', next);
  }

  return (
    <button
      type="button"
      className="chip"
      onClick={toggle}
      disabled={theme === null}
      aria-label="Toggle dark mode"
    >
      {theme === 'dark' ? '☀ Light' : '● Dark'}
    </button>
  );
}
