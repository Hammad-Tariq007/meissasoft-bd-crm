/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TPresenceManualStatus, TUserPresenceStatus } from "@plane/types";
// services
import { APIService } from "./api.service";

type THeartbeatPayload = {
  session_id: string;
  idle: boolean;
  dnd: boolean;
};

type THeartbeatResponse = {
  heartbeat_interval: number;
  poll_interval: number;
  ttl: number;
};

type TPresenceResponse = {
  // present users only; offline users are omitted (absence == offline)
  statuses: Record<string, Exclude<TUserPresenceStatus, "offline">>;
};

export class PresenceService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async sendHeartbeat(workspaceSlug: string, data: THeartbeatPayload): Promise<THeartbeatResponse> {
    return this.post(`/api/workspaces/${workspaceSlug}/presence/heartbeat/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async fetchPresence(workspaceSlug: string): Promise<TPresenceResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/presence/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateManualStatus(manualStatus: TPresenceManualStatus): Promise<{ manual_status: TPresenceManualStatus }> {
    return this.post(`/api/users/me/presence/status/`, { manual_status: manualStatus })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
