import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        // `^_` on vars as well as args, for the compile-time assertions in
        // auth/permissions.ts: they exist to be typechecked, never read.
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
    }
  },
  {
    // OFF for the API's `src/`, where the rule is not merely noisy but wrong.
    // Nest resolves constructor DI from the emitted `design:paramtypes`
    // metadata, so every injected provider must be a *value* import; writing
    // the `import type` this rule asks for emits `Object` instead and breaks
    // injection at runtime with no type error and no failing unit test.
    //
    // It was suppressed 86 times, once per injection, which is a rule being
    // outvoted by the framework rather than enforced. `test/` and
    // `prisma/seed.ts` have no DI, so they keep it.
    files: ["apps/api/src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off"
    }
  },
  {
    // `PrismaService` has to stay injectable — `TransactionHost` is built on
    // it — so nothing but this rule stops a service writing outside the
    // ambient transaction, which is what would let an action commit while its
    // audit row rolls back. Nest resolves constructor DI from the emitted
    // `design:paramtypes` metadata, so an injection is always a *value*
    // import; `allowTypeImports` therefore bans injection precisely rather
    // than banning the name. Scoped to `src/` — `test/` and `prisma/seed.ts`
    // reach the database directly on purpose.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/prisma/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/prisma/prisma.service"],
          allowTypeImports: true,
          message:
            "Inject TransactionHost, not PrismaService: every write must join the ambient transaction so the audit row commits with the action it records."
        }]
      }]
    }
  },
  prettier
);
