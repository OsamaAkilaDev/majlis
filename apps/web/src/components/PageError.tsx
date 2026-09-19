export function PageError({ title }: { title: string }) {
  return (

    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16 text-center">
      <h1 className="max-w-xl font-display text-display text-balance text-ink">{title}</h1>
    </main>
  );
}
