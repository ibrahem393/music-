import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cadence',
  description:
    'Paste a music video link, get a musical analysis and a playable piano score at three difficulty levels.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
