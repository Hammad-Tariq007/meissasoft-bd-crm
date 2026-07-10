/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TPresenceManualStatus, TUserPresence } from "@plane/types";
// services
import { APIService } from "./api.service";

type THeartbeatPayload = {
  session_id: string;
  idle: boolean;
  manual_status: TPresenceManualStatus;
};

type THeartbeatResponse = {
  heartbeat_interval: number;
  poll_interval: number;
  ttl: number;
};

type TPresenceResponse = {
  // one entry per user with a durable trail — INCLUDING offline users (each carries
  // last_seen/last_active). A live "appear offline" user is omitted entirely.
  statuses: Record<string, TUserPresence>;
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
