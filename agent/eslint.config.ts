import { includeIgnoreFile } from '@eslint/compat';
import {
  eslintConfig,
  eslintConfigBase,
  eslintConfigPerfectionist,
  eslintConfigPrettier,
  eslintConfigRelative,
} from '@hiddenability/opinionated-defaults/eslint';
import { fileURLToPath } from 'node:url';

export default eslintConfig([
  includeIgnoreFile(
    fileURLToPath(new URL(`../.gitignore`, import.meta.url)),
    ``,
  ),
  ...eslintConfigBase,
  ...eslintConfigPerfectionist,
  ...eslintConfigPrettier,
  ...eslintConfigRelative,
]);
