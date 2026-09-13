import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="auth-field lattice relative grid min-h-dvh place-items-center px-5 py-10 pt-[calc(2.5rem+var(--safe-t))] pb-[calc(2.5rem+var(--safe-b))]"
    >
      <div className="relative w-full max-w-sm rounded-card border border-border bg-surface p-6 shadow-[var(--shadow-float)] sm:p-8">
        {children}
      </div>
    </main>
  );
}
