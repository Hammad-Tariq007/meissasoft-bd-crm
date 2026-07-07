/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext } from "react";
// plane imports
import type { TUserPresenceStatus } from "@plane/types";
// mobx store
import { StoreContext } from "@/lib/store-context";
// types
import type { IPresenceStore } from "@/store/presence.store";

export const usePresence = (): IPresenceStore => {
  const context = useContext(StoreContext);
  if (context === undefined) throw new Error("usePresence must be used within StoreProvider");
  return context.presence;
};

/**
 * Resolve a user's live presence status. Reads observable presence state, so the
 * consuming component must be an `observer` to react to updates.
 */
export const useUserStatus = (userId: string | undefined): TUserPresenceStatus => {
  const presence = usePresence();
  return presence.getUserStatus(userId);
};
