import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['packages/**/*.ts', 'packages/**/*.tsx'],
  extends: [tseslint.configs.base],
  linterOptions: {
    // Pre-existing eslint-disable comments reference rules (e.g. react-hooks/exhaustive-deps)
    // that are not configured yet. Suppress "Definition for rule X was not found" errors.
    reportUnusedDisableDirectives: 'off',
  },
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'JSXAttribute[name.name="asChild"]',
        message:
          'Do not use asChild -- @base-ui/react uses the render prop pattern instead. See packages/shared/components/ui/alert-dialog.tsx AlertDialogCancel for the correct pattern.',
      },
    ],
  },
});
