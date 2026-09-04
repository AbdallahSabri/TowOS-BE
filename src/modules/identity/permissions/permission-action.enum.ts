/**
 * One key per row of TowOS_MVP.md §6.5's permissions matrix, in table order.
 * Most of these guard resources that don't exist yet in Phase 0 (jobs,
 * dispatches, exports, audit log, Swoop) - encoded now as pure data so the
 * policy is correct and tested from day one (BE-SPEC §9's "one enum"
 * philosophy), wired into real guards as those modules are built.
 */
export enum PermissionAction {
  ViewDispatchBoard = 'view_dispatch_board',
  CreateEditJob = 'create_edit_job',
  AssignReassignDispatch = 'assign_reassign_dispatch',
  AdvanceOwnDispatchStatus = 'advance_own_dispatch_status',
  AdvanceAnyDispatchStatus = 'advance_any_dispatch_status',
  ForceIllegalTransition = 'force_illegal_transition',
  CancelJob = 'cancel_job',
  UploadPhotosNotesOnAssignedJob = 'upload_photos_notes_on_assigned_job',
  ViewOwnJobsOnly = 'view_own_jobs_only',
  ConvertCallToJob = 'convert_call_to_job',
  ManageDriversTrucksLocations = 'manage_drivers_trucks_locations',
  ManageUsersAndRoles = 'manage_users_and_roles',
  ExportDataToCsv = 'export_data_to_csv',
  ViewAuditLog = 'view_audit_log',
  ManageIntegrationCredentials = 'manage_integration_credentials',
  TriggerSwoopSync = 'trigger_swoop_sync',
}
