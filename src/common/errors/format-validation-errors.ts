import type { ValidationError } from 'class-validator';

export interface ValidationDetail {
  field: string;
  issue: string;
}

/**
 * Flattens class-validator's ValidationError tree into the { field, issue }
 * shape from TowOS_MVP.md §7.2's `details` array (one entry per failed
 * constraint, nested properties joined with '.').
 */
export function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): ValidationDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const ownIssues = Object.keys(error.constraints ?? {}).map((issue) => ({ field, issue }));
    const childIssues = error.children?.length
      ? formatValidationErrors(error.children, field)
      : [];
    return [...ownIssues, ...childIssues];
  });
}
