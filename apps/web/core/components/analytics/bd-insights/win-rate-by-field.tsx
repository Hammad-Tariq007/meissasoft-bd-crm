/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
// services
import { AnalyticsService } from "@/services/analytics.service";
// local
import AnalyticsSectionWrapper from "../analytics-section-wrapper";
import { ChartLoader } from "../loaders";
import { BDCaption, BDMessage, useBDInsightsKey, useScopedProjectFields } from "./common";
import { WinRateBars } from "./win-rate-bars";

const analyticsService = new AnalyticsService();

type TByFieldRow = { key: string; name: string; leads: number; wins: number; closed: number; win_rate: number | null };
type TByField = { field_id: string; data: TByFieldRow[] };

type Props = {
  /** The single-select custom field to slice win rate by, resolved by name. */
  fieldName: string;
  title: string;
};

/** Win rate sliced by a single-select custom field (Profile / Lead Source / Country / Contract Type). */
export const WinRateByField = observer(function WinRateByField(props: Props) {
  const { fieldName, title } = props;
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const field = scopedProjectId ? findField(fieldName, "single_select") : undefined;
  const fieldId = field?.id;

  const { data, isLoading } = useSWR(
    ws && fieldId ? `bd-win-rate-by-field-${ws}-${fieldId}-${keyFragment}` : null,
    ws && fieldId
      ? () =>
          analyticsService.getBDInsights<TByField>(ws, {
            type: "by-field",
            field_id: fieldId,
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const renderBody = () => {
    if (!scopedProjectId) {
      return (
        <BDMessage
          title="Select a single project"
          description={`Win rate by ${fieldName} needs one project in focus, because custom fields are project-scoped.`}
        />
      );
    }
    if (isFieldsLoading) return <ChartLoader />;
    if (!field) {
      return (
        <BDMessage
          title={`Field "${fieldName}" not found`}
          description={`No active single-select field named "${fieldName}" in this project (it may have been renamed or deactivated).`}
        />
      );
    }
    if (isLoading) return <ChartLoader />;
    return (
      <>
        <BDCaption>Win rate = won / (won + lost) per {fieldName}. Slices with no closed leads show “—”.</BDCaption>
        <WinRateBars
          rows={(data?.data ?? []).map((r) => ({
            key: r.key,
            name: r.name,
            won: r.wins,
            closed: r.closed,
            win_rate: r.win_rate,
          }))}
          emptyTitle="No leads"
          emptyDescription="No leads matched the selected range."
        />
      </>
    );
  };

  return (
    <AnalyticsSectionWrapper title={title} className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default WinRateByField;
