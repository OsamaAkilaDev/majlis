import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/generated/**", "**/.turbo/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }]
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
