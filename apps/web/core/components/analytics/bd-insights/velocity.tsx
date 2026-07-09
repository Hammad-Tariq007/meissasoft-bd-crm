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

const RATE_FIELD = "Rate";
const WEEKS_FIELD = "No. of Weeks";
const CONTRACT_FIELD = "Contract Type";

type TVelocity = {
  revenue_enabled: boolean;
  hours_per_week: number;
  open_opps: number;
  avg_deal_value: number | null;
  win_rate: number | null;
  avg_cycle_days: number | null;
  velocity_per_day: number | null;
  won_value_counted: number;
  won_value_excluded: number;
};

const money = (value: number | null): string => {
  if (value === null) return "—";
  if (value >= 1000) return `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `$${value.toFixed(0)}`;
};

/**
 * Sales velocity in $/day, with the four inputs it's built from shown alongside
 * so the number is legible. Deal value is an estimate (deal-value proxy); the
 * headline is null until every input is available, rather than showing a
 * misleadingly-precise figure.
 */
export const SalesVelocity = observer(function SalesVelocity() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const rateField = scopedProjectId ? findField(RATE_FIELD, "text") : undefined;
  const weeksField = scopedProjectId ? findField(WEEKS_FIELD, "number") : undefined;
  const contractField = scopedProjectId ? findField(CONTRACT_FIELD, "single_select") : undefined;
  const fieldKey = `${rateField?.id ?? "-"}-${weeksField?.id ?? "-"}-${contractField?.id ?? "-"}`;

  const { data, isLoading } = useSWR(
    ws ? `bd-velocity-${ws}-${fieldKey}-${keyFragment}` : null,
    ws
      ? () =>
          analyticsService.getBDInsights<TVelocity>(ws, {
            type: "velocity",
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
          description="Sales velocity needs one project in focus, because deal value comes from project-scoped custom fields."
        />
      );
    if (isFieldsLoading || isLoading) return <ChartLoader />;
    if (!data) return <BDMessage title="No data" description="No leads matched the selected range." />;

    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-md border border-subtle bg-layer-1 p-5">
          <span className="text-11 tracking-wide text-tertiary uppercase">Sales velocity (est.)</span>
          <span className="text-28 font-bold text-primary">
            {data.velocity_per_day === null ? "—" : `${money(data.velocity_per_day)}/day`}
          </span>
          <span className="text-11 text-tertiary">(open opps × avg deal value × win rate) ÷ avg cycle length</span>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Open opportunities" value={String(data.open_opps)} hint="active pipeline" />
          <StatTile
            label="Avg deal value (est.)"
            value={money(data.avg_deal_value)}
            hint={`${data.won_value_counted} won valued`}
          />
          <StatTile label="Win rate" value={data.win_rate === null ? "—" : `${data.win_rate}%`} />
          <StatTile
            label="Avg cycle length"
            value={data.avg_cycle_days === null ? "—" : `${data.avg_cycle_days} days`}
          />
        </div>
        <BDCaption>
          {data.velocity_per_day === null
            ? "Velocity needs all four inputs — a valued win, a win rate, and a cycle length. "
            : ""}
          Deal value is an estimate — Rate × {data.hours_per_week} h/week × weeks (Hourly) or Rate as flat total
          (Fixed).
          {data.won_value_excluded > 0 &&
            ` ${data.won_value_excluded} won lead${data.won_value_excluded === 1 ? "" : "s"} excluded (unparseable rate).`}
        </BDCaption>
      </div>
    );
  };

  return (
    <AnalyticsSectionWrapper title="Sales velocity" className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

type TCycleRow = { key: string; name: string; avg_days: number | null; count: number };
type TCycleResponse = { field_id: string; data: TCycleRow[] };

/** Avg cycle length (creation → Won) per segment, kept separate so slow segments show. */
export const CycleBySegment = observer(function CycleBySegment(props: { fieldName: string; title: string }) {
  const { fieldName, title } = props;
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const field = scopedProjectId ? findField(fieldName, "single_select") : undefined;
  const fieldId = field?.id;

  const { data, isLoading } = useSWR(
    ws && fieldId ? `bd-cycle-${ws}-${fieldId}-${keyFragment}` : null,
    ws && fieldId
      ? () =>
          analyticsService.getBDInsights<TCycleResponse>(ws, {
            type: "cycle-by-field",
            field_id: fieldId,
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
          description={`Cycle length by ${fieldName} needs one project in focus, because custom fields are project-scoped.`}
        />
      );
    if (isFieldsLoading) return <ChartLoader />;
    if (!field)
      return (
        <BDMessage
          title={`Field "${fieldName}" not found`}
          description={`No active single-select field named "${fieldName}" in this project.`}
        />
      );
    if (isLoading) return <ChartLoader />;
    const rows = (data?.data ?? []).filter((r) => r.avg_days !== null);
    if (rows.length === 0)
      return <BDMessage title="No won leads yet" description="No won leads with a close date in the selected range." />;

    const maxDays = Math.max(...rows.map((r) => r.avg_days ?? 0), 1);
    return (
      <>
        <BDCaption>Avg days from creation to Won, per {fieldName}. Won leads only.</BDCaption>
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-3">
              <div className="w-28 shrink-0 truncate text-13 text-secondary" title={row.name}>
                {row.name}
              </div>
              <div className="h-5 flex-1 overflow-hidden rounded-sm bg-layer-1">
                <div
                  className="h-full rounded-sm bg-[#1192E8] transition-all duration-500"
                  style={{ width: `${Math.max(((row.avg_days ?? 0) / maxDays) * 100, 3)}%` }}
                />
              </div>
              <div className="flex w-24 shrink-0 items-baseline justify-end gap-1.5">
                <span className="text-13 font-medium text-primary">{row.avg_days} days</span>
                <span className="text-11 text-tertiary">({row.count})</span>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <AnalyticsSectionWrapper title={title} className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default SalesVelocity;
