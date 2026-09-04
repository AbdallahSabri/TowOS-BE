/**
 * Mirrors the `user_role` Postgres enum exactly (migration 002). BE-SPEC
 * §10 / CLAUDE.md cut-scope guard: only these two values exist in this
 * phase - no owner, manager, driver, or readonly (ADR-006).
 */
export enum UserRole {
  Admin = 'admin',
  Dispatcher = 'dispatcher',
}
