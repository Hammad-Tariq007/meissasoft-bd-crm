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

const analyticsService = new AnalyticsService();

// Custom-field names resolved within the scoped project (resolve-by-name).
const SPENT_FIELD = "Total Connects Spent";
const RATE_FIELD = "Rate";
const WEEKS_FIELD = "No. of Weeks";
const CONTRACT_FIELD = "Contract Type";

type TEconRow = {
  key: string;
  name: string;
  leads: number;
  wins: number;
  closed: number;
  win_rate: number | null;
  spent_total: number;
  spent_on_won: number;
  connects_per_win: number | null;
  won_value: number | null;
  revenue_per_connect: number | null;
  won_value_excluded: number;
};

type TEconResponse = { revenue_enabled: boolean; hours_per_week: number; data: TEconRow[] };

type Props = {
  /** Single-select field to slice the economics by (Profile / Country). */
  fieldName: string;
  title: string;
};

const NEUTRAL = "#1192E8";
const WASTED = "#DA1E28"; // connects spent, zero wins

const money = (value: number | null): string => {
  if (value === null) return "—";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value.toFixed(0)}`;
};

/**
 * Connects ROI for one segment: where connects are going (total spent, as a bar),
 * how many wins they bought (connects-per-win), and the estimated revenue each
 * connect returned. Rows with spend but no wins are flagged as wasted connects.
 */
export const EconomicsBySegment = observer(function EconomicsBySegment(props: Props) {
  const { fieldName, title } = props;
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const segField = scopedProjectId ? findField(fieldName, "single_select") : undefined;
  const spentField = scopedProjectId ? findField(SPENT_FIELD, "number") : undefined;
  const rateField = scopedProjectId ? findField(RATE_FIELD, "text") : undefined;
  const weeksField = scopedProjectId ? findField(WEEKS_FIELD, "number") : undefined;
  const contractField = scopedProjectId ? findField(CONTRACT_FIELD, "single_select") : undefined;

  const canQuery = ws && segField?.id && spentField?.id;
  const revenueKey = `${rateField?.id ?? "-"}-${weeksField?.id ?? "-"}-${contractField?.id ?? "-"}`;

  const { data, isLoading } = useSWR(
    canQuery ? `bd-economics-${ws}-${segField!.id}-${spentField!.id}-${revenueKey}-${keyFragment}` : null,
    canQuery
      ? () =>
          analyticsService.getBDInsights<TEconResponse>(ws!, {
            type: "economics-by-segment",
            field_id: segField!.id,
            spent_field_id: spentField!.id,
            ...(rateField?.id ? { rate_field_id: rateField.id } : {}),
            ...(weeksField?.id ? { weeks_field_id: weeksField.id } : {}),
            ...(contractField?.id ? { contract_field_id: contractField.id } : {}),
            ...dateFilterParams,
            ...(projectParam ? { project_ids: projectParam } : {}),
          })
      : null
  );

  const renderBody = () => {
    if (!scopedProjectId)
      return (
        <BDMessage
          title="Select a single project"
          description={`Connects economics by ${fieldName} needs one project in focus, because custom fields are project-scoped.`}
        />
      );
    if (isFieldsLoading) return <ChartLoader />;
    if (!segField)
      return (
        <BDMessage
          title={`Field "${fieldName}" not found`}
          description={`No active single-select field named "${fieldName}" in this project.`}
        />
      );
    if (!spentField)
      return (
        <BDMessage
          title={`Field "${SPENT_FIELD}" not found`}
          description={`No active number field named "${SPENT_FIELD}" in this project.`}
        />
      );
    if (isLoading) return <ChartLoader />;
    const rows = data?.data ?? [];
    if (rows.length === 0) return <BDMessage title="No leads" description="No leads matched the selected range." />;

    const maxSpent = Math.max(...rows.map((r) => r.spent_total), 1);
    const totalExcluded = rows.reduce((sum, r) => sum + r.won_value_excluded, 0);

    return (
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto rounded-md border border-subtle">
          <table className="w-full text-13">
            <thead className="border-b border-subtle text-tertiary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{fieldName}</th>
                <th className="px-3 py-2 text-left font-medium">Connects spent</th>
                <th className="px-3 py-2 text-right font-medium">Wins</th>
                <th className="px-3 py-2 text-right font-medium">Connects / win</th>
                {data?.revenue_enabled && <th className="px-3 py-2 text-right font-medium">Rev / connect (est.)</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const wasted = row.spent_total > 0 && row.wins === 0;
                const widthPct = Math.max((row.spent_total / maxSpent) * 100, 2);
                return (
                  <tr key={row.key} className="border-b border-subtle last:border-b-0">
                    <td className="px-3 py-2 text-left text-primary">{row.name}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="relative h-3.5 w-24 shrink-0 overflow-hidden rounded-sm bg-layer-1">
                          <div
                            className="h-full rounded-sm transition-all duration-500"
                            style={{ width: `${widthPct}%`, backgroundColor: wasted ? WASTED : NEUTRAL }}
                          />
                        </div>
                        <span className="text-tertiary tabular-nums">{row.spent_total}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.wins}</td>
                    <td className="px-3 py-2 text-right font-medium text-primary tabular-nums">
                      {wasted ? (
                        <span className="text-danger" title="Connects spent but no wins">
                          wasted
                        </span>
                      ) : (
                        (row.connects_per_win ?? "—")
                      )}
                    </td>
                    {data?.revenue_enabled && (
                      <td className="px-3 py-2 text-right text-primary tabular-nums">
                        {money(row.revenue_per_connect)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <BDCaption>
          {data?.revenue_enabled
            ? `Revenue is an estimate — deal value from Rate × ${data.hours_per_week} h/week × weeks (Hourly) or Rate as flat total (Fixed).`
            : `Add "${RATE_FIELD}" and "${CONTRACT_FIELD}" fields to unlock revenue-per-connect.`}
          {totalExcluded > 0 &&
            ` ${totalExcluded} won lead${totalExcluded === 1 ? "" : "s"} excluded from revenue (unparseable rate).`}
        </BDCaption>
      </div>
    );
  };

  return (
    <AnalyticsSectionWrapper title={title} className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default EconomicsBySegment;
