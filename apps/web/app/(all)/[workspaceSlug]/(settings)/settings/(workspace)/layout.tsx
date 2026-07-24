/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
import { Outlet } from "react-router";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { getWorkspaceActivePath, pathnameToAccessKey } from "@/components/settings/helper";
import { SettingsMobileNav } from "@/components/settings/mobile/nav";
// plane imports
import { EUserPermissions, EUserPermissionsLevel, WORKSPACE_SETTINGS_ACCESS } from "@plane/constants";
import type { EUserWorkspaceRoles } from "@plane/types";
// components
import { WorkspaceSettingsSidebarRoot } from "@/components/settings/workspace/sidebar";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";

import type { Route } from "./+types/layout";

const WorkspaceSettingLayout = observer(function WorkspaceSettingLayout({ params }: Route.ComponentProps) {
  // router
  const { workspaceSlug } = params;
  const router = useAppRouter();
  // store hooks
  const { allowPermissions, workspaceUserInfo, getWorkspaceRoleByWorkspaceSlug } = useUserPermissions();
  // next hooks
  const pathname = usePathname();
  // derived values
  const { accessKey } = pathnameToAccessKey(pathname);
  const userWorkspaceRole = getWorkspaceRoleByWorkspaceSlug(workspaceSlug);
  // BD CRM: workspace Settings is admin-only. A team lead / member can no longer even VIEW it.
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);

  let isAuthorized: boolean | string = false;
  if (pathname && workspaceSlug && userWorkspaceRole) {
    isAuthorized = WORKSPACE_SETTINGS_ACCESS[accessKey]?.includes(userWorkspaceRole as EUserWorkspaceRoles);
  }

  // Redirect guard: once the member role has loaded, bounce any non-admin (team leads included)
  // off every workspace-settings page to the workspace home, so /settings is unreachable by URL.
  useEffect(() => {
    if (userWorkspaceRole !== undefined && !isWorkspaceAdmin) {
      router.replace(`/${workspaceSlug}/`);
    }
  }, [userWorkspaceRole, isWorkspaceAdmin, workspaceSlug, router]);

  return (
    <>
      <SettingsMobileNav
        hamburgerContent={WorkspaceSettingsSidebarRoot}
        activePath={getWorkspaceActivePath(pathname) || ""}
      />
      <div className="inset-y-0 flex h-full w-full flex-row">
        {workspaceUserInfo && (!isAuthorized || !isWorkspaceAdmin) ? (
          <NotAuthorizedView section="settings" className="h-auto" />
        ) : (
          <div className="relative flex size-full">
            <div className="hidden h-full md:block">
              <WorkspaceSettingsSidebarRoot />
            </div>
            <Outlet />
          </div>
        )}
      </div>
    </>
  );
});

export default WorkspaceSettingLayout;
