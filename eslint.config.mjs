import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import globals from 'globals'

// eslint-config-next's array ships globs relative to a Next app root (e.g. '**/*.tsx')
// and one rules-only entry with no `files` at all — left as-is, both would apply to
// every package in the monorepo. Rooting everything under apps/web/ keeps Next/React/
// a11y rules scoped to the actual Next app instead of leaking into the API or packages.
const nextConfigForWeb = nextCoreWebVitals
  .filter(c => !('ignores' in c && !('rules' in c)))
  .map(c => ({
    ...c,
    files: (c.files ?? ['**/*.{js,jsx,ts,tsx}']).map(f => `apps/web/${f}`),
  }))

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      '**/coverage/**',
      'apps/api/prisma/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Type-aware rules where a single, simple tsconfig makes them cheap to run
  // correctly (apps/api). Not enabled repo-wide yet — Next's own parser/plugin
  // stack on apps/web makes project-service resolution there more fragile; can
  // be extended there later once the basics are clean.
  //
  // apps/api/prisma/**/*.ts (seed/import/export/debug scripts, prisma.config.ts)
  // are excluded — they're run standalone via tsx and aren't in apps/api's
  // tsconfig.json `include`, so the project service can't resolve them.
  ...tseslint.configs.recommendedTypeChecked.map(c => ({
    ...c,
    files:   ['apps/api/**/*.ts'],
    ignores: ['apps/api/prisma/**', 'apps/api/prisma.config.ts'],
  })),
  {
    files:   ['apps/api/**/*.ts'],
    ignores: ['apps/api/prisma/**', 'apps/api/prisma.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
  },
  {
    // Prisma is the one place `any` for the tx/db client param is a deliberate,
    // pervasive choice (PrismaService vs Prisma.TransactionClient share no
    // convenient generic signature) — the unsafe-* family it triggers everywhere
    // downstream isn't actionable noise-for-noise, it's one recurring pattern.
    // Retyping that param properly is tracked as a separate follow-up
    // (docs/TODO.md) rather than fixed call-by-call here.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call':          'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment':    'off',
      '@typescript-eslint/no-unsafe-argument':      'off',
      '@typescript-eslint/no-unsafe-return':        'off',
    },
  },

  {
    files: ['packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  ...nextConfigForWeb,

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      // CLAUDE.md: icons go through resolveIcon()/lib/icons.ts, never a direct
      // lucide-react import in a component; no Radix or other primitive libs —
      // components are hand-rolled in TS + Tailwind.
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'lucide-react', message: 'Import via resolveIcon() from lib/icons.ts instead of lucide-react directly (CLAUDE.md).' },
        ],
        patterns: [
          { group: ['@radix-ui/*'], message: 'No Radix UI — components are hand-rolled in TS + Tailwind (CLAUDE.md).' },
        ],
      }],
    },
  },
  {
    files: ['apps/web/src/lib/icons.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    settings: { next: { rootDir: 'apps/web' } },
  },

  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Same reasoning as the apps/api no-unsafe-* block above: explicit `any` is
      // overwhelmingly the Prisma tx/db param pattern, not case-by-case sloppiness.
      // Kept visible as a warning rather than silenced outright.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
