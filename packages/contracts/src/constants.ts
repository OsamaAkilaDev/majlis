/**
 * Scalars the web app needs in a client component, and nothing else.
 *
 * This module imports nothing, deliberately. It is exported on its own
 * subpath (`@majlis/contracts/constants`) so a client component can read one
 * of these without importing the barrel, which re-exports all fifteen schema
 * modules and so drags Zod and every schema into the client bundle. The
 * barrel still re-exports them, so a server-side import keeps working.
 */

/** The signup form states the rule from the schema that enforces it. */
export const PASSWORD_MIN = 12;
