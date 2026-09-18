import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'
import vibesafe from 'eslint-plugin-vibesafe'

const NO_NON_ASCII = [
  { selector: 'Literal[value=/[^\\x00-\\x7F]/]', message: 'Non-ASCII in string literal.' },
  {
    selector: 'TemplateElement[value.raw=/[^\\x00-\\x7F]/]',
    message: 'Non-ASCII in template literal.',
  },
]
const NO_PROCESS_ENV = {
  selector: 'MemberExpression[object.object.name="process"][object.property.name="env"]',
  message: 'Read config from the env module, not process.env.',
}
const NO_PLAIN_ERROR = {
  selector: "NewExpression[callee.name='Error']",
  message: 'Throw a typed error from the errors module.',
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/.wrangler',
      '**/migrations',
      '**/coverage',
      '**/.stryker-tmp',
      '**/stryker-setup-*.js',
      '**/reports',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.ts'],
    plugins: { sonarjs, vibesafe },
    rules: {
      'vibesafe/ascii-only': 'error',
      'vibesafe/strict-tsconfig': 'error',
      'vibesafe/no-multiline-comments': 'error',
      'vibesafe/comment-max-length': ['error', { max: 100 }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      complexity: ['error', { max: 7 }],
      'sonarjs/cognitive-complexity': ['error', 10],
      'max-lines': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', { max: 4 }],
      'max-params': ['error', { max: 4 }],
      'max-nested-callbacks': ['error', { max: 3 }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'property',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        { selector: 'property', modifiers: ['requiresQuotes'], format: null },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
        { selector: 'import', format: null },
      ],
      'default-case': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: true,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      'no-implicit-coercion': 'error',
      'no-param-reassign': 'error',
      '@typescript-eslint/no-shadow': 'error',
      'guard-for-in': 'error',
      'no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          enforceConst: true,
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'consistent-return': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      'no-nested-ternary': 'error',
      'prefer-template': 'error',
      'no-else-return': ['error', { allowElseIf: false }],
      'no-unneeded-ternary': 'error',
      'object-shorthand': ['error', 'always'],
      'prefer-arrow-callback': ['error', { allowNamedFunctions: false }],
      'no-lonely-if': 'error',
      'no-useless-return': 'error',
      curly: ['error', 'all'],
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...NO_NON_ASCII, NO_PROCESS_ENV, NO_PLAIN_ERROR],
    },
  },
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-namespace': 'off',
    },
  },
  {
    files: ['**/src/env.ts', '**/scripts/**'],
    rules: { 'no-restricted-syntax': ['error', ...NO_NON_ASCII, NO_PLAIN_ERROR] },
  },
  {
    files: [
      '**/src/log.ts',
      '**/scripts/**',
      'mocks/src/main.ts',
      'agent/src/sources.ts',
      'agent/src/backtest.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      'site/src/alpaca.ts',
      'site/src/alpaca-schemas.ts',
      'site/src/social/**',
      'agent/src/sources/{reddit,hn,edgar}.ts',
      'agent/scripts/**',
      'agent/src/backtest/bars.ts',
      'mocks/src/alpaca/**',
      'mocks/src/x.ts',
      'mocks/src/deepinfra.ts',
      'site/src/rewrite.ts',
      'site/src/codex-auth.ts',
      'agent/src/codex.ts',
    ],
    rules: { '@typescript-eslint/naming-convention': 'off' },
  },
  {
    files: [
      '**/*.test.ts',
      '**/test/**',
      '**/*.config.ts',
      '**/vitest.config.ts',
      '**/drizzle.config.ts',
    ],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': 'off',
      complexity: 'off',
      'max-nested-callbacks': 'off',
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-magic-numbers': 'off',
      'no-restricted-syntax': ['error', ...NO_NON_ASCII],
    },
  },
)
