/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EUserPermissions } from "@plane/constants";
// hooks
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
 * backend rule: the assigned BD and any project admin can edit; everyone else
 * gets read-only + comments. Reassignment is admin-only.
 */
export const useWorkItemPermissions = (
  workspaceSlug: string | null | undefined,
  projectId: string | null | undefined,
  assigneeIds: string[] | null | undefined
): TWorkItemPermissions => {
  const { data: currentUser } = useUser();
  const { getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();

  const projectRole =
    workspaceSlug && projectId ? getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId) : undefined;
  // getProjectRoleByWorkspaceSlugAndProjectId already promotes workspace admins
  // to project ADMIN, so this single check covers both.
  const isAdmin = projectRole === EUserPermissions.ADMIN;
  const isAssignee = !!currentUser?.id && !!assigneeIds?.includes(currentUser.id);

  return {
    isAdmin,
    isEditable: isAdmin || isAssignee,
    canReassign: isAdmin,
  };
};
