import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedChron AI — Medical Chronology Platform',
  description: 'AI-powered medical chronology and case intelligence for UK law firms',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-slate-50 antialiased">{children}</body>
    </html>
  );
}
