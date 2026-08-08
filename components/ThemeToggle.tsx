'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * Light by default, dark on request. The inline script in the layout has
 * already applied the stored choice before paint; this only reads it back so
 * the button can show the right label.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('cadence:theme', next);
    } catch {
      // Private mode. The choice simply will not persist.
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // Rendered before hydration knows the theme; the label fills in after.
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`print-hide rounded-md border px-2.5 py-1.5 text-xs ${className}`}
      style={{ borderColor: 'var(--line)', color: 'var(--ink-soft)' }}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
