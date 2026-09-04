import { UserRole } from '../roles/user-role.enum.js';
import { PermissionAction } from './permission-action.enum.js';
import { can } from './permissions.matrix.js';

/**
 * Transcribed independently from TowOS_MVP.md §6.5's manager/dispatcher
 * columns (admin = manager, per this slice's scope decision - see
 * permissions.matrix.ts) rather than imported from the matrix under test,
 * so this actually catches a wrong cell instead of just re-asserting it.
 */
const EXPECTED: Record<PermissionAction, { admin: boolean; dispatcher: boolean }> = {
  [PermissionAction.ViewDispatchBoard]: { admin: true, dispatcher: true },
  [PermissionAction.CreateEditJob]: { admin: true, dispatcher: true },
  [PermissionAction.AssignReassignDispatch]: { admin: true, dispatcher: true },
  [PermissionAction.AdvanceOwnDispatchStatus]: { admin: true, dispatcher: true },
  [PermissionAction.AdvanceAnyDispatchStatus]: { admin: true, dispatcher: true },
  [PermissionAction.ForceIllegalTransition]: { admin: true, dispatcher: false },
  [PermissionAction.CancelJob]: { admin: true, dispatcher: true },
  [PermissionAction.UploadPhotosNotesOnAssignedJob]: { admin: true, dispatcher: true },
  [PermissionAction.ViewOwnJobsOnly]: { admin: false, dispatcher: false },
  [PermissionAction.ConvertCallToJob]: { admin: true, dispatcher: true },
  [PermissionAction.ManageDriversTrucksLocations]: { admin: true, dispatcher: false },
  [PermissionAction.ManageUsersAndRoles]: { admin: true, dispatcher: false },
  [PermissionAction.ExportDataToCsv]: { admin: true, dispatcher: false },
  [PermissionAction.ViewAuditLog]: { admin: true, dispatcher: false },
  [PermissionAction.ManageIntegrationCredentials]: { admin: false, dispatcher: false },
  [PermissionAction.TriggerSwoopSync]: { admin: true, dispatcher: true },
};

describe('permissions matrix (TowOS_MVP.md §6.5)', () => {
  const cells = Object.values(PermissionAction).flatMap((action) => [
    { action, role: UserRole.Admin, expected: EXPECTED[action].admin },
    { action, role: UserRole.Dispatcher, expected: EXPECTED[action].dispatcher },
  ]);

  it.each(cells)('$role can($action) === $expected', ({ action, role, expected }) => {
    expect(can(role, action)).toBe(expected);
  });

  it('covers every action in the enum, not a subset', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.values(PermissionAction).sort());
  });
});
