import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Constitution §3: "Zero lint warnings. Zero compile errors." This file is the
 * enforcement half of that rule — it ran for the first time under aic-j18, after
 * 13,399 lines had already been written without it.
 *
 * `npm run lint` runs it standalone; `npm run verify` runs it as a blocking gate
 * (with --max-warnings 0, so a warning is as fatal as an error — §3 says zero).
 *
 * Every relaxation below is scoped and justified in place. There are deliberately
 * NO file-scope `eslint-disable` comments anywhere in the tree: if a rule does not
 * fit, the decision belongs here where a reviewer can see it, not buried in the
 * file it silences.
 */
export default tseslint.config(
  {
    // `node_modules` is a real directory in some worktrees and a SYMLINK in others
    // (see the matching double entry in .gitignore) — a trailing-slash glob alone
    // does not reliably exclude the symlinked form, so it is listed both ways.
    ignores: [
      'node_modules/**',
      'node_modules',
      'dist/**',
      'coverage/**',
      '.beads/**',
      '.scratch/**',
    ],
  },

  // This config file is plain ESM and deliberately outside tsconfig.json's
  // `include`, so type-aware rules cannot run on it. Lint it with the untyped
  // core rules rather than exempting it from review altogether.
  {
    files: ['eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },

  {
    files: ['src/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    extends: [
      js.configs.recommended,
      // Type-aware ruleset. This is the whole point of the gate: `tsc` already
      // catches type errors, so the value here is the rules that need type
      // information — floating promises, misused promises, accidental `any`,
      // dead conditions. A non-type-aware linter would not have caught any of
      // the defects aic-j18 found.
      tseslint.configs.strictTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // projectService resolves each file through tsconfig.json, so the lint
        // program and the `npm run typecheck` program cannot drift apart.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ---------------------------------------------------------------------
      // ADDED on top of the preset — bug classes `tsc` does not report
      // ---------------------------------------------------------------------

      // An unused binding is usually dead logic or a half-finished refactor.
      // (It found exactly that: an unused `validatePlacement` import in the
      // construction<->mission seam test.) Leading underscore is the documented
      // opt-out for intentionally-ignored positional params.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Shadowing is a named concern in the bead. The base rule must be off for
      // the TS-aware version to handle types/enums/overloads correctly.
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      // The sim is arithmetic and comparisons end to end; `==` coercion here
      // would be a defect, not a style preference.
      eqeqeq: ['error', 'always'],
      'no-else-return': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': ['error', 'properties'],

      // ---------------------------------------------------------------------
      // RELAXED, whole-tree — with reasons
      // ---------------------------------------------------------------------

      // restrict-template-expressions: allow `number` only.
      // All 72 original violations were a validated `number` interpolated into a
      // RangeError message (`received: ${value}`). Number -> string is total,
      // lossless and unambiguous, so those are not defects. The rule stays ON
      // for `any`, `never`, nullish and objects — the cases that actually emit
      // "[object Object]" or "undefined" into a user-facing message.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // no-confusing-void-expression: allow the arrow-shorthand form.
      // `expect(() => fn()).toThrow()` is the standard Vitest idiom for asserting
      // a throw, and it is void-returning by construction. The rule ships this
      // exact option for this exact case; the rest of the rule stays on.
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],
    },
  },

  {
    // ---------------------------------------------------------------------
    // RELAXED, TEST FILES ONLY — src/ keeps the strict rules
    // ---------------------------------------------------------------------
    files: ['tests/**/*.ts'],
    rules: {
      // no-non-null-assertion: off in tests, ERROR in src.
      // tsconfig sets `noUncheckedIndexedAccess: true`, so every array index is
      // `T | undefined`. In a test, `arr[0]!` is an assertion about the shape the
      // code under test is expected to produce, and a wrong one throws and fails
      // the test loudly — which is the desired outcome. In src/ a wrong `!` is a
      // production crash, so it stays banned there (currently 0 violations, and
      // this override is what keeps that number meaningful).
      '@typescript-eslint/no-non-null-assertion': 'off',

      // no-unsafe-assignment: off in tests, ERROR in src.
      // Vitest types its asymmetric matchers (`expect.any`, `expect.objectContaining`)
      // as `any` upstream, so `{ terrain: expect.any(Object) }` is unfixable in
      // our code. Scoped to tests and to this one rule: `no-unsafe-argument`,
      // `no-unsafe-call`, `no-unsafe-member-access` and `no-unsafe-return` all
      // stay ON here — no-unsafe-argument is what caught the real `new Array(n)
      // .fill()` -> `any[]` hole in buildability.test.ts.
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
)
