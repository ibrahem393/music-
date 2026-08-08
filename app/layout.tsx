import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Public_Sans, Space_Mono } from 'next/font/google';

import './globals.css';

/**
 * Display large and tight-tracked; body in Public Sans; timestamps, chord
 * symbols and BPM in Space Mono. Self-hosted by next/font, so no external font
 * request at runtime.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
  weight: ['600', '700', '800'],
});

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  variable: '--font-space-mono',
  display: 'swap',
  weight: ['400', '700'],
});

export const metadata: Metadata = {
  title: 'Cadence — musical analysis and piano scores',
  description:
    'Paste a music video link, get a musical analysis and a playable piano score at three difficulty levels.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf8ff' },
    { media: '(prefers-color-scheme: dark)', color: '#100c1e' },
  ],
};

/**
 * Applies the stored theme before first paint. Without this a reader who has
 * chosen dark gets a flash of the light page on every navigation.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('cadence:theme');
    var theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${publicSans.variable} ${spaceMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
