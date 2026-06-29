/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// services
import { PushNotificationService } from "@/services/push-notification.service";

const pushNotificationService = new PushNotificationService();

// dedicated push service worker, served from apps/web/public
const PUSH_SERVICE_WORKER_URL = "/push-sw.js";

/** Whether the current browser can receive web push notifications. */
export const isPushNotificationSupported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Register the push service worker and wait for it to become active. */
export const registerPushServiceWorker = async (): Promise<ServiceWorkerRegistration | undefined> => {
  if (!isPushNotificationSupported()) return undefined;
  const registration = await navigator.serviceWorker.register(PUSH_SERVICE_WORKER_URL);
  // ensure the worker is active before we attempt to subscribe through it
  await navigator.serviceWorker.ready;
  return registration;
};

export const getExistingPushSubscription = (
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> => registration.pushManager.getSubscription();

/** Convert a base64 url-safe VAPID key into the Uint8Array the Push API expects. */
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

/**
 * Subscribe the browser to push using the server's VAPID key and persist the
 * subscription on the backend. Assumes notification permission was granted.
 */
export const subscribeToPushNotifications = async (
  registration: ServiceWorkerRegistration
): Promise<PushSubscription> => {
  const { vapid_public_key } = await pushNotificationService.getVapidKey();
  if (!vapid_public_key) throw new Error("VAPID public key is not configured on the server");

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid_public_key),
  });

  const payload = subscription.toJSON();
  await pushNotificationService.saveSubscription({
    endpoint: payload.endpoint ?? "",
    keys: {
      p256dh: payload.keys?.p256dh ?? "",
      auth: payload.keys?.auth ?? "",
    },
  });

  return subscription;
};
