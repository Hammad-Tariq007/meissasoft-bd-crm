/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { isEmpty } from "lodash-es";
import { observer } from "mobx-react";
// plane helpers
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { SidebarWrapper } from "@/components/sidebar/sidebar-wrapper";
import { SidebarActiveMembers } from "@/components/workspace/sidebar/active-members-list";
import { SidebarFavoritesMenu } from "@/components/workspace/sidebar/favorites/favorites-menu";
import { SidebarProjectsList } from "@/components/workspace/sidebar/projects-list";
import { SidebarQuickActions } from "@/components/workspace/sidebar/quick-actions";
import { SidebarMenuItems } from "@/components/workspace/sidebar/sidebar-menu-items";
// hooks
import { useFavorite } from "@/hooks/store/use-favorite";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// plane web components
import { SidebarTeamsList } from "@/plane-web/components/workspace/sidebar/teams-sidebar-list";

export const AppSidebar = observer(function AppSidebar() {
  // store hooks
  const { allowPermissions } = useUserPermissions();
  const { groupedFavorites } = useFavorite();
  const { joinedProjectIds } = useProject();

  // derived values
  const canPerformWorkspaceMemberActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );

  // BD CRM: the workspace-level menu (Workspace heading -> Projects link / Views / Analytics /
  // "More" extended sidebar) is admin-only. Non-admins get just their Projects list below.
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);

  const isFavoriteEmpty = isEmpty(groupedFavorites);
  // Only show the presence "Active" list to members who actually belong to a project. A
  // brand-new workspace member with no project sits at the workspace root, where the widget
  // (active-members-list.tsx) would otherwise fall back to the FULL workspace roster — gate it
  // on project membership so a no-project member never sees the whole member list via presence.
  const hasJoinedProject = joinedProjectIds.length > 0;

  return (
    <SidebarWrapper title="Projects" quickActions={<SidebarQuickActions />}>
      {/* Workspace-level menu (Projects link / Views / Analytics / More) — admins only. */}
      {isWorkspaceAdmin && <SidebarMenuItems />}
      {/* Favorites Menu */}
      {canPerformWorkspaceMemberActions && !isFavoriteEmpty && <SidebarFavoritesMenu />}
      {/* Teams List */}
      <SidebarTeamsList />
      {/* Projects List */}
      <SidebarProjectsList />
      {/* Active members (live presence) — only for members with project context */}
      {hasJoinedProject && <SidebarActiveMembers />}
    </SidebarWrapper>
  );
});
