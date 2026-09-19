import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { RegisterSW } from '@/components/RegisterSW';
import { RouterCacheInvalidator } from '@/components/RouterCacheInvalidator';
import { ThemeProvider } from '@/components/ThemeProvider';
import { BRAND } from '@/lib/brand';
import { fraunces, plex } from '@/lib/fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.product, template: `%s · ${BRAND.product}` },
  applicationName: BRAND.product,
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${plex.variable} ${fraunces.variable}`}>
      <body>
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg focus:focus-ring"
          >
            Skip to content
          </a>
          {children}
          <RegisterSW />
          <RouterCacheInvalidator />
        </ThemeProvider>
      </body>
    </html>
  );
}
