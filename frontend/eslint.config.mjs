import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// eslint-config-next (v15) only ships a legacy `.eslintrc`-style config, and this
// workspace's pnpm install doesn't hoist `@eslint/eslintrc` as a direct
// dependency of `frontend`. It IS present as a transitive dependency of
// `eslint` itself, so resolve it relative to `eslint`'s own location instead
// of relying on it being hoisted into frontend/node_modules.
const require = createRequire(import.meta.url);
const { FlatCompat } = require(
  require.resolve("@eslint/eslintrc", { paths: [require.resolve("eslint")] })
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
