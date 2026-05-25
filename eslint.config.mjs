import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'terraform/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['collectors/**/src/**/*.ts'],
    rules: {
      ...config.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  })),

  {
    files: ['collectors/**/src/__tests__/**/*.ts', 'collectors/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]
