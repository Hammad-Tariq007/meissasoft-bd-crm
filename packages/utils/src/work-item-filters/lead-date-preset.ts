/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { endOfMonth, startOfMonth, subMonths } from "date-fns";
// plane imports
import type { TLeadDatePreset } from "@plane/constants";
import { LOGICAL_OPERATOR } from "@plane/types";
import type { TWorkItemFilterConditionData, TWorkItemFilterExpression } from "@plane/types";
// local imports
import { renderFormattedPayloadDate } from "../datetime";

/** `[fromISO, toISO]`, e.g. `["2026-07-01", "2026-07-31"]`. */
export type TLeadDateRange = [string, string];

const CREATED_AT_RANGE_KEY = "created_at__range";
const CREATED_AT_CONDITION_PREFIX = "created_at__";

/**
 * Resolve a preset key to an absolute `[from, to]` created_at range.
 * Relative presets are computed against `now`; "all_time" (and "custom", whose range the caller
 * supplies) return `null`, meaning "no created_at filter".
 */
export const resolveLeadDateRange = (preset: TLeadDatePreset, now: Date = new Date()): TLeadDateRange | null => {
  let from: Date;
  let to: Date;
  switch (preset) {
    case "this_month":
      from = startOfMonth(now);
      to = endOfMonth(now);
      break;
    case "last_month": {
      const lastMonth = subMonths(now, 1);
      from = startOfMonth(lastMonth);
      to = endOfMonth(lastMonth);
      break;
    }
    case "last_3_months":
      // the current calendar month plus the two preceding ones
      from = startOfMonth(subMonths(now, 2));
      to = endOfMonth(now);
      break;
    default:
      return null;
  }
  const fromISO = renderFormattedPayloadDate(from);
  const toISO = renderFormattedPayloadDate(to);
  if (!fromISO || !toISO) return null;
  return [fromISO, toISO];
};

/** Whether an expression node is a bare condition object (as opposed to an AND group). */
const isConditionData = (node: TWorkItemFilterExpression): boolean =>
  !!node && typeof node === "object" && !(LOGICAL_OPERATOR.AND in node) && Object.keys(node).length > 0;

/** Flatten the top level of an external expression into its list of condition objects. */
const flattenConditions = (expression: TWorkItemFilterExpression | undefined): TWorkItemFilterConditionData[] => {
  if (!expression || Object.keys(expression).length === 0) return [];
  if (LOGICAL_OPERATOR.AND in expression) {
    const andGroup = expression as { [LOGICAL_OPERATOR.AND]: TWorkItemFilterConditionData[] };
    return Array.isArray(andGroup[LOGICAL_OPERATOR.AND]) ? [...andGroup[LOGICAL_OPERATOR.AND]] : [];
  }
  return isConditionData(expression) ? [expression as TWorkItemFilterConditionData] : [];
};

const isCreatedAtCondition = (condition: TWorkItemFilterConditionData): boolean =>
  Object.keys(condition).some((key) => key.startsWith(CREATED_AT_CONDITION_PREFIX));

/**
 * Replace (or remove) the created_at condition in an external expression while preserving every
 * other condition. Pass `null` to remove the created_at filter entirely ("All Time"). Non-mutating.
 */
export const upsertCreatedAtRange = (
  expression: TWorkItemFilterExpression | undefined,
  range: TLeadDateRange | null
): TWorkItemFilterExpression => {
  const others = flattenConditions(expression).filter((condition) => !isCreatedAtCondition(condition));
  if (range) {
    // ranges serialize as a comma-joined string in the external shape (see workItemFiltersAdapter)
    others.push({ [CREATED_AT_RANGE_KEY]: `${range[0]},${range[1]}` } as TWorkItemFilterConditionData);
  }
  if (others.length === 0) return {};
  return { [LOGICAL_OPERATOR.AND]: others } as TWorkItemFilterExpression;
};

/** Extract the `[from, to]` of a created_at range condition, if one is present. */
export const getCreatedAtRangeFromExpression = (
  expression: TWorkItemFilterExpression | undefined
): TLeadDateRange | null => {
  const createdAt = flattenConditions(expression).find(isCreatedAtCondition);
  const rangeValue = createdAt ? (createdAt as Record<string, unknown>)[CREATED_AT_RANGE_KEY] : undefined;
  if (typeof rangeValue !== "string") return null;
  const [from, to] = rangeValue.split(",");
  return from && to ? [from, to] : null;
};

/**
 * Reverse-map an external expression's created_at condition to the matching preset so the UI can
 * highlight it — keeping the preset pill in sync even when the native filter chip is edited directly.
 * - no created_at condition          -> "all_time"
 * - a range matching a relative preset -> that preset
 * - any other created_at condition     -> "custom"
 */
export const detectLeadDatePreset = (
  expression: TWorkItemFilterExpression | undefined,
  now: Date = new Date()
): TLeadDatePreset => {
  const range = getCreatedAtRangeFromExpression(expression);
  const hasCreatedAt = flattenConditions(expression).some(isCreatedAtCondition);
  if (!hasCreatedAt) return "all_time";
  if (range) {
    const serialized = `${range[0]},${range[1]}`;
    for (const preset of ["this_month", "last_month", "last_3_months"] as const) {
      const resolved = resolveLeadDateRange(preset, now);
      if (resolved && `${resolved[0]},${resolved[1]}` === serialized) return preset;
    }
  }
  return "custom";
};
