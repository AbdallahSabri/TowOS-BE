import { UserRole } from '../roles/user-role.enum.js';
import { PermissionAction } from './permission-action.enum.js';

/**
 * TowOS_MVP.md §6.5, encoded as data rather than scattered if-checks
 * (BE-SPEC §10). §6.5 has five roles (owner, manager, dispatcher, driver,
 * readonly); Phase 0 only has two (BE-SPEC §10 / ADR-006). By explicit
 * product decision for this slice: `admin` takes the **manager** column,
 * not owner - owner is unconditionally ✅ on every row, which would make
 * admin a blanket superuser the source table doesn't actually grant to
 * managers (notably: no integration-credential access). `dispatcher` is
 * the dispatcher column, unchanged.
 *
 * "Manage users & roles" is ⚠️ "non-owner only" for manager in the source -
 * since no user in this system can hold the owner role at all right now,
 * that restriction is vacuous and collapses to a plain ✅ for admin.
 *
 * "View own jobs only" is the driver role's defining scope, not a
 * capability either remaining role has - both are false.
 */
export const PERMISSIONS_MATRIX: Readonly<Record<PermissionAction, Readonly<Record<UserRole, boolean>>>> = {
  [PermissionAction.ViewDispatchBoard]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.CreateEditJob]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.AssignReassignDispatch]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.AdvanceOwnDispatchStatus]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.AdvanceAnyDispatchStatus]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.ForceIllegalTransition]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: false },
  [PermissionAction.CancelJob]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.UploadPhotosNotesOnAssignedJob]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.ViewOwnJobsOnly]: { [UserRole.Admin]: false, [UserRole.Dispatcher]: false },
  [PermissionAction.ConvertCallToJob]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
  [PermissionAction.ManageDriversTrucksLocations]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: false },
  [PermissionAction.ManageUsersAndRoles]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: false },
  [PermissionAction.ExportDataToCsv]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: false },
  [PermissionAction.ViewAuditLog]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: false },
  [PermissionAction.ManageIntegrationCredentials]: { [UserRole.Admin]: false, [UserRole.Dispatcher]: false },
  [PermissionAction.TriggerSwoopSync]: { [UserRole.Admin]: true, [UserRole.Dispatcher]: true },
};

export function can(role: UserRole, action: PermissionAction): boolean {
  return PERMISSIONS_MATRIX[action][role];
}
