import type { IconWeight } from '@phosphor-icons/react';

/**
 * One weight for every icon in the product.
 *
 * Import icons from `@phosphor-icons/react/ssr`, never the package root: the
 * root's IconBase calls `useContext` and throws in a Server Component. The SSR
 * build has no hooks, at the cost of taking `weight` as a prop.
 */
export const ICON_WEIGHT: IconWeight = 'bold';
