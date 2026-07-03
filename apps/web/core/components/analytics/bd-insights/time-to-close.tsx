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
import { BDCaption, BDMessage, StatTile, useBDInsightsKey } from "./common";

const analyticsService = new AnalyticsService();

type TTimeToCloseRow = {
  assignee_id: string;
  assignee_name: string;
  avg_days: number | null;
  count: number;
};

type TTimeToClose = {
  approximation: string;
  overall: { avg_days: number | null; count: number };
  per_bd: TTimeToCloseRow[];
};

const days = (value: number | null) => (value === null ? "—" : `${value} days`);

export const TimeToCloseInsight = observer(function TimeToCloseInsight() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();

  const { data, isLoading } = useSWR(
    ws ? `bd-time-to-close-${ws}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TTimeToClose>(ws, {
            type: "time-to-close",
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  return (
    <AnalyticsSectionWrapper title="Avg time to close" className="col-span-1">
      <BDCaption>
        Average days from lead creation to win — Won leads only (cancelled leads have no close date).
      </BDCaption>
      {isLoading ? (
        <ChartLoader />
      ) : data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatTile
              label="Overall avg days to win"
              value={days(data.overall.avg_days)}
              hint={`across ${data.overall.count} won lead${data.overall.count === 1 ? "" : "s"}`}
            />
          </div>

          {data.per_bd.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-subtle">
              <table className="w-full text-13">
                <thead className="border-b border-subtle text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">BD</th>
                    <th className="px-4 py-2 text-right font-medium">Avg days to win</th>
                    <th className="px-4 py-2 text-right font-medium">Won leads</th>
                  </tr>
                </thead>
                <tbody>
                  {data.per_bd.map((row) => (
                    <tr key={row.assignee_id} className="border-b border-subtle last:border-b-0">
                      <td className="px-4 py-2 text-left text-primary">{row.assignee_name}</td>
                      <td className="px-4 py-2 text-right font-medium text-primary">{days(row.avg_days)}</td>
                      <td className="px-4 py-2 text-right">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <BDMessage
              title="No won leads yet"
              description="No leads have reached a Won state in the selected range."
            />
          )}
        </div>
      ) : (
        <BDMessage title="No data" description="No leads matched the selected range." />
      )}
    </AnalyticsSectionWrapper>
  );
});

export default TimeToCloseInsight;
