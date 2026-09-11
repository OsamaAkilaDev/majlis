export function PageError({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="font-display text-display text-ink">{title}</h1>
    </div>
  );
}
