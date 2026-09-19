// The slug is the club's public identifier and is never editable after
// creation: rewriting it breaks every existing link.
export function deriveSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) throw new Error(`Cannot derive a slug from ${JSON.stringify(name)}`);
  return slug.slice(0, 80);
}

export async function uniqueSlug(base: string, taken: (candidate: string) => Promise<boolean>): Promise<string> {
  if (!(await taken(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`No free slug for ${base}`);
}
