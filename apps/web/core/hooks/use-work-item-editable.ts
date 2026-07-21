/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EUserPermissions } from "@plane/constants";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useUser, useUserPermissions } from "@/hooks/store/user";

export type TWorkItemPermissions = {
  /** The current user is a project (or workspace) admin. */
  isAdmin: boolean;
  /**
   * The current user may edit this work item's properties (state, priority,
   * custom fields, dates, name, description, ...). True for admins and the
   * work item's assignee(s); false for everyone else.
   */
  isEditable: boolean;
  /**
   * The current user may change the assignee (reassign the lead). Admin-only —
   * the assignee cannot hand off or drop their own ownership.
   */
  canReassign: boolean;
};

/**
 * Ownership-based edit permissions for a work item (CRM lead). Mirrors the
 * backend rule: a project admin, the assigned BD, OR a BD-team member (a BD lead,
 * or a restricted BD viewing one of their profile-assigned leads) can edit;
 * everyone else gets read-only + comments. Reassignment is admin-only.
 *
 * The BD grant is intentionally coarse here (team === "bd"): Phase-3 visibility on
 * the backend guarantees a restricted BD only ever receives their profile leads, so
 * any lead that reaches this hook is one they may edit, and the backend
 * (can_bd_edit_lead) is the authoritative gate regardless.
 */
export const useWorkItemPermissions = (
  workspaceSlug: string | null | undefined,
  projectId: string | null | undefined,
  assigneeIds: string[] | null | undefined
): TWorkItemPermissions => {
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  const {
    workspace: { getWorkspaceMemberDetails },
  } = useMember();

  const projectRole =
    workspaceSlug && projectId ? getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) : undefined;
  // getProjectRoleByWorkspaceSlugAndProjectId already promotes workspace admins
  // to project ADMIN, so this single check covers both.
  const isAdmin = projectRole === EUserPermissions.ADMIN;
  const isAssignee = !!currentUser?.id && !!assigneeIds?.includes(currentUser.id);
  const isBD = !!currentUser?.id && getWorkspaceMemberDetails(currentUser.id)?.team === "bd";

  return {
    isAdmin,
    isEditable: isAdmin || isAssignee || isBD,
    canReassign: isAdmin,
  };
};
