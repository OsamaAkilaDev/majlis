/**
 * Imports nothing, deliberately, and is exported on its own subpath so a
 * client component can read a scalar without pulling the barrel, which
 * re-exports all fifteen schema modules and drags Zod into the bundle.
 */

export const PASSWORD_MIN = 12;
