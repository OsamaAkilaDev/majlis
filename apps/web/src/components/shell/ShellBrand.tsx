import { BRAND } from '@/lib/brand';

/** The wordmark at the head of a desktop sidebar, where the phone layouts put
 *  the page title in the header instead. */
export function ShellBrand() {
  return (
    <span className="px-2.5 pb-1 pt-0.5 font-display text-h1 text-ink">{BRAND.product}</span>
  );
}
