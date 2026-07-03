/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo } from "react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { useUserPermissions } from "@/hooks/store/user";
import { getAnalyticsTabs } from "./tabs";

export const useAnalyticsTabs = (_workspaceSlug: string) => {
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();

  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);

  const analyticsTabs = useMemo(() => getAnalyticsTabs(t, isAdmin), [t, isAdmin]);

  return analyticsTabs;
};
