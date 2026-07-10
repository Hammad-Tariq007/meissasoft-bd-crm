/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TUserPresence } from "@plane/types";
import { calculateTimeAgoShort } from "@plane/utils";

// A DND user whose last real activity is older than this is treated as genuinely stale,
// so we may append a subtle "· Xm ago". Below it, DND shows no time (they're actively DND
// and a time would wrongly imply they're gone). Mirrors the store's idle threshold.
const DND_STALE_THRESHOLD_S = 5 * 60;

/** Timestamps from the API are epoch SECONDS; the util wants ms. Empty string if absent. */
const ago = (epochSeconds?: number | null): string => (epochSeconds ? calculateTimeAgoShort(epochSeconds * 1000) : "");

/**
 * Professional per-state presence label, shown across ALL states in the sidebar list:
 *   online  -> "Active now"
 *   away    -> "Away · 5m ago"        (since last real activity)
 *   offline -> "Last seen 2h ago"     (since last connected)
 *   dnd     -> "Do Not Disturb"       (+ "· Xm ago" only when genuinely stale)
 */
export function getPresenceLabel(presence: TUserPresence | undefined): string {
  if (!presence) return "";
  const { status, last_active, last_seen } = presence;

  switch (status) {
    case "online":
      return "Active now";
    case "away": {
      const since = ago(last_active);
      return since ? `Away · ${since} ago` : "Away";
    }
    case "dnd": {
      const stale = !!last_active && Math.floor(Date.now() / 1000) - last_active > DND_STALE_THRESHOLD_S;
      const since = ago(last_active);
      return stale && since ? `Do Not Disturb · ${since} ago` : "Do Not Disturb";
    }
    case "offline":
    default: {
      const since = ago(last_seen);
      return since ? `Last seen ${since} ago` : "Offline";
    }
  }
}
