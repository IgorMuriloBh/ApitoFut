import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ApitoFut', template: '%s · ApitoFut' },
  description: 'Competições de futebol: tabelas, classificação e súmula ao vivo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
