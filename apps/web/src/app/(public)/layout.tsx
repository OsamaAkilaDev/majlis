import type { ReactNode } from 'react';
import { ShellBrand } from '@/components/shell/ShellBrand';

/**
 * The one anonymous shell in the product, and deliberately not a shell: no tab
 * bar, no side nav, no account menu, no link into the signed-in product at all.
 * Whoever is reading a page under here is checking a document somebody handed
 * them, not visiting an application, and the issuer's name is the only thing
 * they need from us besides the answer.
 *
 * Nothing here calls requireUser. `/verify` is in PUBLIC_PREFIXES, so the
 * middleware lets it through with no session.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-6 px-5 py-12"
    >
      <ShellBrand />
      {children}
    </main>
  );
}
