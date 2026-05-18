// eslint.config.js
// eslint v9 使用 Flat Config（替代旧版 .eslintrc.js）
// @typescript-eslint v8 已内置对 eslint v9 的完整支持

import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // ── 全局忽略 ────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "sidecar/**",
      "node_modules/**",
      "*.config.js",
    ],
  },

  // ── TypeScript + React 源码检查 ─────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      // 继承 typescript-eslint 推荐规则
      ...tseslint.configs.recommended.rules,

      // React Hooks 规则
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // 允许非空断言（Tauri IPC 结果处理中常用）
      "@typescript-eslint/no-non-null-assertion": "warn",

      // 允许 any（逐步迁移时可放宽）
      "@typescript-eslint/no-explicit-any": "warn",

      // 未使用变量：_前缀的允许忽略
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];
