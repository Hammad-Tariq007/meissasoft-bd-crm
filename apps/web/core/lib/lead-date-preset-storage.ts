/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLeadDatePreset } from "@plane/constants";
import { DEFAULT_LEAD_DATE_PRESET, RELATIVE_LEAD_DATE_PRESETS } from "@plane/constants";
import type { TWorkItemFilterExpression } from "@plane/types";
import { resolveLeadDateRange, upsertCreatedAtRange } from "@plane/utils";
// local storage
import { storage } from "@/lib/local-storage";

/**
 * Per-user-per-project persistence for the leads date-range preset — mirrors the local-storage
 * channel already used for kanban toggle state. We persist the preset *key* (the intent), not a
 * frozen range, so relative presets stay live and "all_time" sticks. See `resolveLeadDateRange`.
 */
const STORAGE_KEY = "lead_date_preset";

type TLeadDatePresetEntry = {
  workspaceSlug: string;
  projectId: string;
  userId: string | undefined;
  preset: TLeadDatePreset;
};

const readAll = (): TLeadDatePresetEntry[] => {
  const raw = storage.get(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const matches = (
  entry: TLeadDatePresetEntry,
  workspaceSlug: string,
  projectId: string,
  userId: string | undefined
): boolean => entry.workspaceSlug === workspaceSlug && entry.projectId === projectId && entry.userId === userId;

export const leadDatePresetStorage = {
  get: (workspaceSlug: string, projectId: string, userId: string | undefined): TLeadDatePreset | undefined =>
    readAll().find((entry) => matches(entry, workspaceSlug, projectId, userId))?.preset,

  set: (workspaceSlug: string, projectId: string, userId: string | undefined, preset: TLeadDatePreset): void => {
    const entries = readAll();
    const index = entries.findIndex((entry) => matches(entry, workspaceSlug, projectId, userId));
    if (index < 0) entries.push({ workspaceSlug, projectId, userId, preset });
    else entries[index] = { ...entries[index], preset };
    storage.set(STORAGE_KEY, JSON.stringify(entries));
  },
};

/**
 * Resolve the leads date-range default into a rich-filter expression, seeding the current-month
 * range on a user's first visit. Called from `fetchFilters` so the store's `richFilters` is *born*
 * with the created_at range applied — never observed in the empty state that the layout's mount
 * fetch and the filter instance would otherwise lock onto (single fetch, no flash, no race).
 *
 * - no persisted preset  -> default to "This Month" (and persist it)
 * - relative preset       -> recompute its range against now and apply it (keeps it live)
 * - "all_time" / "custom" -> return the server expression untouched (respects the user's choice)
 */
export const applyLeadDateDefault = (
  workspaceSlug: string,
  projectId: string,
  userId: string | undefined,
  serverExpression: TWorkItemFilterExpression | undefined
): TWorkItemFilterExpression => {
  let preset = leadDatePresetStorage.get(workspaceSlug, projectId, userId);
  if (!preset) {
    preset = DEFAULT_LEAD_DATE_PRESET;
    leadDatePresetStorage.set(workspaceSlug, projectId, userId, preset);
  }
  const base = serverExpression ?? {};
  if (RELATIVE_LEAD_DATE_PRESETS.includes(preset)) {
    return upsertCreatedAtRange(base, resolveLeadDateRange(preset));
  }
  return base;
};
