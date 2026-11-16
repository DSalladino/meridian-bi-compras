import globals from "globals";

/**
 * ESLint do painel (zero dependências em runtime; ESLint é só de desenvolvimento).
 * O objetivo não é estilo — é pegar o que os testes não pegam: variável morta,
 * global implícita, comparação frouxa e `var`.
 */
export default [
  {
    ignores: ["data/**", "etl/out/**", "_site/**", "node_modules/**", "powerbi/**", "dax/**"],
  },
  {
    files: ["app/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-undef": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs", "server.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-undef": "error",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
];
