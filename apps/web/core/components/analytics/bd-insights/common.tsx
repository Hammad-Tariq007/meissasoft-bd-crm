/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
import useSWR from "swr";
// hooks
import { useAnalytics } from "@/hooks/store/use-analytics";
import { useCustomField } from "@/hooks/store/use-custom-field";
// types
import type { ICustomField } from "@/types/custom-field";

/**
 * Custom fields are project-scoped, so the by-field / connects widgets only work
 * when exactly one project is in focus. This hook loads that project's fields and
 * exposes a name-based lookup (BD Insights resolves fields like "Profile" or
 * "Total Connects Spent" by name — see the plan).
 */
export function useScopedProjectFields() {
  const { workspaceSlug } = useParams();
  const ws = workspaceSlug?.toString();
  const { selectedProjects } = useAnalytics();
  const { fetchCustomFields, getProjectCustomFields } = useCustomField();

  const scopedProjectId = selectedProjects.length === 1 ? selectedProjects[0] : undefined;

  const { isLoading } = useSWR(
    ws && scopedProjectId ? ["BD_INSIGHTS_CUSTOM_FIELDS", ws, scopedProjectId] : null,
    ws && scopedProjectId ? () => fetchCustomFields(ws, scopedProjectId) : null
  );

  const fields = scopedProjectId ? (getProjectCustomFields(scopedProjectId) ?? []) : [];

  const findField = (name: string, fieldType: ICustomField["field_type"]): ICustomField | undefined =>
    fields.find((field) => field.name === name && field.field_type === fieldType && field.is_active);

  return { scopedProjectId, findField, isFieldsLoading: isLoading };
}

type BDMessageProps = {
  title: string;
  description?: string;
};

/** Explicit help/empty state — never a silent blank chart. */
export function BDMessage(props: BDMessageProps) {
  const { title, description } = props;
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-subtle px-5 py-10 text-center md:py-16">
      <p className="text-13 font-medium text-primary">{title}</p>
      {description && <p className="max-w-md text-11 text-tertiary">{description}</p>}
    </div>
  );
}

type StatTileProps = {
  label: string;
  value: string;
  hint?: string;
};

export function StatTile(props: StatTileProps) {
  const { label, value, hint } = props;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-subtle p-4">
      <div className="text-13 text-tertiary">{label}</div>
      <div className="text-20 font-bold text-primary">{value}</div>
      {hint && <div className="text-11 text-tertiary">{hint}</div>}
    </div>
  );
}

/** A short muted caption used to flag the approximations to the user. */
export function BDCaption({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-11 text-tertiary">{children}</p>;
}

/** Builds a stable SWR-key fragment from the current date/project selection. */
export function useBDInsightsKey() {
  const { selectedDuration, selectedStartDate, selectedEndDate, selectedProjects } = useAnalytics();
  const projectParam = selectedProjects.length > 0 ? selectedProjects.join(",") : undefined;
  return {
    projectParam,
    keyFragment: `${selectedDuration}-${selectedStartDate}-${selectedEndDate}-${selectedProjects.join(",")}`,
  };
}
