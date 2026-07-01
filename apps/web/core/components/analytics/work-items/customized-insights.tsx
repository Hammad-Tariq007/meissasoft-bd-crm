/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import useSWR from "swr";
// plane package imports
import { useTranslation } from "@plane/i18n";
import type { IAnalyticsParams } from "@plane/types";
import { ChartXAxisProperty, ChartYAxisMetric } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
import { useCustomField } from "@/hooks/store/use-custom-field";
// plane web components
import AnalyticsSectionWrapper from "../analytics-section-wrapper";
import { AnalyticsSelectParams } from "../select/analytics-params";
import PriorityChart from "./priority-chart";

const CustomizedInsights = observer(function CustomizedInsights({
  peekView,
  isEpic,
}: {
  peekView?: boolean;
  isEpic?: boolean;
}) {
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const { selectedProjects } = useAnalytics();
  const { fetchCustomFields, getProjectCustomFields } = useCustomField();
  const { control, watch, setValue } = useForm<IAnalyticsParams>({
    defaultValues: {
      x_axis: ChartXAxisProperty.PRIORITY,
      y_axis: isEpic ? ChartYAxisMetric.EPIC_WORK_ITEM_COUNT : ChartYAxisMetric.WORK_ITEM_COUNT,
    },
  });

  const params = {
    x_axis: watch("x_axis"),
    y_axis: watch("y_axis"),
    group_by: watch("group_by"),
  };

  // Custom fields are project-scoped; offer them as grouping dimensions only when a
  // single project is in focus, so the option list is unambiguous.
  const scopedProjectId = selectedProjects.length === 1 ? selectedProjects[0] : undefined;
  useSWR(
    scopedProjectId ? ["ANALYTICS_CUSTOM_FIELDS", workspaceSlug.toString(), scopedProjectId] : null,
    scopedProjectId ? () => fetchCustomFields(workspaceSlug.toString(), scopedProjectId) : null
  );
  const customFieldOptions = scopedProjectId
    ? (getProjectCustomFields(scopedProjectId) ?? [])
        .filter((field) => field.field_type === "single_select" && field.is_active)
        .map((field) => ({ value: `CUSTOM_FIELD_${field.id}`, label: field.name }))
    : [];

  return (
    <AnalyticsSectionWrapper
      title={t("workspace_analytics.customized_insights")}
      className="col-span-1"
      headerClassName={cn(peekView ? "flex-col items-start" : "")}
      actions={
        <AnalyticsSelectParams
          control={control}
          setValue={setValue}
          params={params}
          workspaceSlug={workspaceSlug.toString()}
          isEpic={isEpic}
          customFieldOptions={customFieldOptions}
        />
      }
    >
      <PriorityChart x_axis={params.x_axis} y_axis={params.y_axis} group_by={params.group_by} />
    </AnalyticsSectionWrapper>
  );
});

export default CustomizedInsights;
