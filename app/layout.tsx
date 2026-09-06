import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ThermoScan · Satellite thermal intelligence',
  description: 'Analyze genuine NASA FIRMS thermal observations with XGBoost, Sentinel-2 and OpenStreetMap context. Stack Titans · SIH26162.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
