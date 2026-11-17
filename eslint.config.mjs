// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'dist-prod/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'node_modules/**', '*.zip']),
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      // Stubs and interface implementations are often async without awaiting.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // UI + content script: untrusted strings go through textContent / h(). The only HTML sink is
    // setSanitizedHtml() in src/ui/dom.ts (DOMPurify output of model markdown).
    files: ['src/ui/**/*.ts', 'src/content/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: 'Use h()/textContent, or setSanitizedHtml() for sanitised markdown.',
        },
        {
          selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|write|writeln|setHTMLUnsafe|createContextualFragment)$/]",
          message: 'Raw HTML sinks are not allowed in the UI.',
        },
      ],
    },
  },
  {
    // The logger is the one place allowed to touch console.
    files: ['src/shared/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
);
