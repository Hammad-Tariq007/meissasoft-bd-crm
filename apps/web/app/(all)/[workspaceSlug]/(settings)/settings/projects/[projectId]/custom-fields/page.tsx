/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { CustomFieldList } from "@/components/custom-fields";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
// constants
import { PROJECT_CUSTOM_FIELDS } from "@/constants/fetch-keys";
// hooks
import { useCustomField } from "@/hooks/store/use-custom-field";
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { CustomFieldsProjectSettingsHeader } from "./header";

function CustomFieldsSettingsPage() {
  // router
  const { workspaceSlug, projectId } = useParams();
  // store hooks
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions, getProjectRoleByWorkspaceSlugAndProjectId } = useUserPermissions();
  const { fetchCustomFields } = useCustomField();

  const ws = workspaceSlug?.toString();
  const pid = projectId?.toString();
  const currentProjectRole = ws && pid ? getProjectRoleByWorkspaceSlugAndProjectId(ws, pid) : undefined;

  // Definitions are fetched at the project-wrapper level; this shares that SWR
  // cache key so the settings page stays in sync without a duplicate request.
  useSWR(
    ws && pid ? PROJECT_CUSTOM_FIELDS(pid, currentProjectRole) : null,
    ws && pid ? () => fetchCustomFields(ws, pid) : null,
    { revalidateIfStale: false, revalidateOnFocus: false }
  );

  const pageTitle = currentProjectDetails?.name ? `${currentProjectDetails.name} - Custom fields` : undefined;

  const canPerformProjectMemberActions = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT
  );

  if (workspaceUserInfo && !canPerformProjectMemberActions) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<CustomFieldsProjectSettingsHeader />}>
      <PageHead title={pageTitle} />
      <div className="size-full">
        <CustomFieldList />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(CustomFieldsSettingsPage);
