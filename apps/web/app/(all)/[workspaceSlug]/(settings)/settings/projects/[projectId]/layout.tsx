/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { usePathname } from "next/navigation";
import { Outlet } from "react-router";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { getProjectActivePath } from "@/components/settings/helper";
import { SettingsMobileNav } from "@/components/settings/mobile/nav";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
import { useUserPermissions } from "@/hooks/store/user";
// layouts
import { ProjectAuthWrapper } from "@/layouts/auth-layout/project-wrapper";
// types
import type { Route } from "./+types/layout";
import { ProjectSettingsSidebarRoot } from "@/components/settings/project/sidebar";

function ProjectDetailSettingsLayout({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId } = params;
  // router
  const pathname = usePathname();
  const router = useAppRouter();
  // store hooks
  const { allowPermissions, getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();

  // BD CRM: project Settings is admin-only — a workspace admin/owner OR a project admin of THIS
  // project. Everyone else (team leads and regular members who are not a project admin here) is
  // hard-redirected off, matching the workspace-settings guard's strictness.
  const isWorkspaceAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE, workspaceSlug);
  const isProjectAdmin = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const canAccess = isWorkspaceAdmin || isProjectAdmin;
  const projectRole = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);
  // Decide only once the user's standing is known (a ws-admin is known immediately; otherwise wait
  // for the project role to load) so a project admin is never bounced mid-load.
  const denied = (isWorkspaceAdmin || projectRole !== undefined) && !canAccess;

  useEffect(() => {
    if (denied) router.replace(`/${workspaceSlug}/`);
  }, [denied, workspaceSlug, router]);

  if (denied) return null;

  return (
    <>
      <SettingsMobileNav
        hamburgerContent={(props) => <ProjectSettingsSidebarRoot {...props} projectId={projectId} />}
        activePath={getProjectActivePath(pathname) || ""}
      />
      <div className="inset-y-0 flex h-full w-full flex-row">
        <div className="relative flex size-full">
          <div className="hidden h-full shrink-0 md:block">
            <ProjectSettingsSidebarRoot projectId={projectId} />
          </div>
          <ProjectAuthWrapper workspaceSlug={workspaceSlug} projectId={projectId}>
            <Outlet />
          </ProjectAuthWrapper>
        </div>
      </div>
    </>
  );
}

export default observer(ProjectDetailSettingsLayout);
