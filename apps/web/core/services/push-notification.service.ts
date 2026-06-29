/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable no-useless-catch */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TWebPushSubscriptionPayload = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export class PushNotificationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getVapidKey(): Promise<{ vapid_public_key: string | null }> {
    try {
      const { data } = await this.get("/api/users/me/web-push/vapid-key/");
      return data;
    } catch (error) {
      throw error;
    }
  }

  async saveSubscription(payload: TWebPushSubscriptionPayload) {
    try {
      const { data } = await this.post("/api/users/me/web-push/subscriptions/", payload);
      return data;
    } catch (error) {
      throw error;
    }
  }
}
