import type { IconWeight } from '@phosphor-icons/react';

/**
 * One weight for every icon in the product. Phosphor's `regular` reads thin
 * beside this UI's semibold labels; `bold` matches their stroke.
 *
 * Icons are imported from `@phosphor-icons/react/ssr`, not the package root:
 * the root's IconBase calls `useContext`, which throws in a Server Component,
 * and ConsoleShell, EmptyState and both nav modules render icons in one. The
 * SSR build is a plain forwardRef with no hooks and works in either, at the
 * cost of taking `weight` as a prop rather than from context.
 */
export const ICON_WEIGHT: IconWeight = 'bold';
