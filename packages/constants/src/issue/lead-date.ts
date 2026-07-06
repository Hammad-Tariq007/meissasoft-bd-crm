/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Date-range presets for the leads pipeline (board / list / spreadsheet).
 *
 * These are a convenience control over Plane's native `created_at` rich-filter — NOT a
 * parallel filter. The selected preset *key* is what gets persisted (per-user-per-project,
 * in local storage), so relative presets always resolve to the *current* period on load,
 * while "all_time" is an explicit stored value that never gets re-defaulted.
 */
export const LEAD_DATE_PRESETS = [
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "last_3_months", label: "Last 3 Months" },
  { key: "all_time", label: "All Time" },
  { key: "custom", label: "Custom" },
] as const;

export type TLeadDatePreset = (typeof LEAD_DATE_PRESETS)[number]["key"];

/** Applied on first load when the user has no persisted preset yet. */
export const DEFAULT_LEAD_DATE_PRESET: TLeadDatePreset = "this_month";

/**
 * Presets whose range is derived live from "now" and therefore recomputed on every load.
 * "all_time" and "custom" are left exactly as the server persisted them.
 */
export const RELATIVE_LEAD_DATE_PRESETS: TLeadDatePreset[] = ["this_month", "last_month", "last_3_months"];
