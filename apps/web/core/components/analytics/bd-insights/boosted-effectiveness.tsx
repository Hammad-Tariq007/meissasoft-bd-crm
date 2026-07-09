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

const FLAG_FIELD = "Boosted Proposal?";
const SPENT_FIELD = "Total Connects Spent";

type TBoostRow = {
  key: string;
  name: string;
  leads: number;
  won: number;
  closed: number;
  win_rate: number | null;
  connects_per_win: number | null;
};

type TBoostResponse = { data: TBoostRow[] };

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
const cpw = (value: number | null) => (value === null ? "—" : String(value));

/** Reads the verdict off the two buckets so the headline answers the question. */
function verdict(rows: TBoostRow[]): string | null {
  const boosted = rows.find((r) => r.key === "Boosted");
  const plain = rows.find((r) => r.key === "Not boosted");
  if (!boosted || !plain || boosted.win_rate === null || plain.win_rate === null) return null;
  const delta = Math.round((boosted.win_rate - plain.win_rate) * 10) / 10;
  if (delta > 0) return `Boosting adds +${delta} pts of win rate.`;
  if (delta < 0) return `Boosting isn't paying off — ${delta} pts of win rate.`;
  return "Boosting shows no win-rate difference.";
}

/** Boosted vs non-boosted, side by side, so "does boosting pay off?" is answerable at a glance. */
export const BoostedEffectiveness = observer(function BoostedEffectiveness() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { dateFilterParams } = useAnalytics();
  const { projectParam, keyFragment } = useBDInsightsKey();
  const { scopedProjectId, findField, isFieldsLoading } = useScopedProjectFields();

  const flagField = scopedProjectId ? findField(FLAG_FIELD, "checkbox") : undefined;
  const spentField = scopedProjectId ? findField(SPENT_FIELD, "number") : undefined;
  const canQuery = ws && flagField?.id && spentField?.id;

  const { data, isLoading } = useSWR(
    canQuery ? `bd-boosted-${ws}-${flagField!.id}-${spentField!.id}-${keyFragment}` : null,
    canQuery
      ? () =>
          analyticsService.getBDInsights<TBoostResponse>(ws!, {
            type: "boosted",
            flag_field_id: flagField!.id,
            spent_field_id: spentField!.id,
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
          description="Boosted-proposal analysis needs one project in focus, because custom fields are project-scoped."
        />
      );
    if (isFieldsLoading) return <ChartLoader />;
    if (!flagField)
      return (
        <BDMessage
          title={`Field "${FLAG_FIELD}" not found`}
          description={`No active checkbox field named "${FLAG_FIELD}" in this project.`}
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

    const message = verdict(rows);
    return (
      <div className="flex flex-col gap-4">
        {message && (
          <div className="rounded-md border border-subtle bg-layer-1 px-4 py-2.5 text-13 font-medium text-primary">
            {message}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-3 rounded-md border border-subtle p-4">
              <div className="text-13 font-medium text-primary">{row.name}</div>
              <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-20 font-bold text-primary">{pct(row.win_rate)}</span>
                  <span className="text-11 text-tertiary">
                    win rate ({row.won}/{row.closed} closed)
                  </span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-20 font-bold text-primary">{cpw(row.connects_per_win)}</span>
                  <span className="text-11 text-tertiary">connects / win</span>
                </div>
              </div>
              <div className="text-11 text-tertiary">{row.leads} leads</div>
            </div>
          ))}
        </div>
        <BDCaption>
          “{FLAG_FIELD}” splits the leads; higher win rate at lower connects-per-win means boosting pays off.
        </BDCaption>
      </div>
    );
  };

  return (
    <AnalyticsSectionWrapper title="Does boosting pay off?" className="col-span-1">
      {renderBody()}
    </AnalyticsSectionWrapper>
  );
});

export default BoostedEffectiveness;
