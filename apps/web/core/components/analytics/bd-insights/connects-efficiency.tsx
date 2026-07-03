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
import { BDCaption, BDMessage, StatTile, useBDInsightsKey, useScopedProjectFields } from "./common";

const analyticsService = new AnalyticsService();

// Field names resolved within the scoped project (see plan: resolve-by-name).
const SPENT_FIELD_NAME = "Total Connects Spent";
const BOOST_FIELD_NAME = "Boost Connects Bid";

type TConnects = {
  spent_total: number;
  spent_on_won: number;
  spent_on_lost: number;
  won_count: number;
  connects_per_win: number | null;
  boost_total?: number;
  boost_on_won?: number;
};

const num = (value: number | null | undefined) => (value === null || value === undefined ? "—" : String(value));

export const ConnectsEfficiency = observer(function ConnectsEfficiency() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const spentField = scopedProjectId ? findField(SPENT_FIELD_NAME, "number") : undefined;
  const boostField = scopedProjectId ? findField(BOOST_FIELD_NAME, "number") : undefined;
  const spentFieldId = spentField?.id;

  const { data, isLoading } = useSWR(
    ws && spentFieldId ? `bd-connects-${ws}-${spentFieldId}-${boostField?.id ?? "none"}-${keyFragment}` : null,
    ws && spentFieldId
      ? () =>
          analyticsService.getBDInsights<TConnects>(ws, {
            type: "connects",
            spent_field_id: spentFieldId,
            ...(boostField?.id ? { boost_field_id: boostField.id } : {}),
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
          description="Connects efficiency needs one project in focus, because custom fields are project-scoped."
        />
      );
    }
    if (isFieldsLoading) return <ChartLoader />;
    if (!spentField) {
      return (
        <BDMessage
          title={`Field "${SPENT_FIELD_NAME}" not found`}
          description={`No active number field named "${SPENT_FIELD_NAME}" in this project. Check the project's custom-field settings (it may have been renamed or deactivated).`}
        />
      );
    }
    if (isLoading) return <ChartLoader />;
    if (!data) return <BDMessage title="No data" description="No leads matched the selected range." />;
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Connects per win" value={num(data.connects_per_win)} hint={`${data.won_count} won`} />
          <StatTile label="Spent on won" value={num(data.spent_on_won)} />
          <StatTile label="Spent on lost" value={num(data.spent_on_lost)} />
          <StatTile label="Total spent" value={num(data.spent_total)} />
        </div>
        {boostField && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatTile label="Boost connects — total" value={num(data.boost_total)} />
            <StatTile label="Boost connects — on won" value={num(data.boost_on_won)} />
          </div>
        )}
        {!boostField && (
          <p className="text-11 text-tertiary">{`"${BOOST_FIELD_NAME}" field not found — boost metrics hidden.`}</p>
        )}
      </div>
    );
  };

  return (
    <AnalyticsSectionWrapper title="Connects efficiency" className="col-span-1">
      <BDCaption>Sums the &quot;{SPENT_FIELD_NAME}&quot; field across leads in the selected range.</BDCaption>
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default ConnectsEfficiency;
