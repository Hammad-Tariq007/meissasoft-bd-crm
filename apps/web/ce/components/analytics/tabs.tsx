/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AnalyticsTab } from "@plane/types";
import { BDInsights } from "@/components/analytics/bd-insights";
import { Overview } from "@/components/analytics/overview";
import { WorkItems } from "@/components/analytics/work-items";

// `isAdmin` gates the BD Insights tab, which exposes per-BD performance. The
// endpoint is admin-only too, so this only hides the tab for non-admins.
export const getAnalyticsTabs = (
  t: (key: string, params?: Record<string, any>) => string,
  isAdmin: boolean
): AnalyticsTab[] => [
  { key: "overview", label: t("common.overview"), content: Overview, isDisabled: false },
  { key: "work-items", label: t("sidebar.work_items"), content: WorkItems, isDisabled: false },
  ...(isAdmin ? [{ key: "bd-insights" as const, label: "BD Insights", content: BDInsights, isDisabled: false }] : []),
];
