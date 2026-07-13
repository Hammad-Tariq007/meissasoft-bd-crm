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

// A stable id for THIS browser, persisted in localStorage. The push endpoint can rotate
// (VAPID change / re-subscribe); sending a stable device id lets the backend update the
// same subscription row instead of orphaning the old one — orphaned rows were causing the
// same notification to be delivered (and pop) more than once.
const DEVICE_ID_KEY = "plane_push_device_id";

const getPushDeviceId = (): string | undefined => {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  let deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
};

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
 * Whether an existing browser subscription was created with the server's current
 * VAPID public key. A subscription is permanently bound to the `applicationServerKey`
 * it was created with; if the server key later changes, the push service still
 * accepts messages (2xx) but the browser silently drops them because the VAPID
 * signature no longer verifies. Detecting the mismatch lets us re-subscribe.
 */
const subscriptionMatchesVapidKey = (subscription: PushSubscription, vapidPublicKey: string): boolean => {
  const existingKey = subscription.options?.applicationServerKey;
  // No key to compare against -> treat as a mismatch so we re-subscribe cleanly.
  if (!existingKey) return false;
  const existing = new Uint8Array(existingKey);
  const expected = urlBase64ToUint8Array(vapidPublicKey);
  if (existing.length !== expected.length) return false;
  for (let i = 0; i < existing.length; i += 1) {
    if (existing[i] !== expected[i]) return false;
  }
  return true;
};

const saveSubscriptionToBackend = async (subscription: PushSubscription): Promise<void> => {
  const payload = subscription.toJSON();
  await pushNotificationService.saveSubscription({
    endpoint: payload.endpoint ?? "",
    keys: {
      p256dh: payload.keys?.p256dh ?? "",
      auth: payload.keys?.auth ?? "",
    },
    device_id: getPushDeviceId(),
  });
};

/**
 * Ensure the browser holds a valid push subscription bound to the server's current
 * VAPID key and that the backend has that exact subscription persisted.
 *
 * This self-heals the two ways the browser and backend drift apart:
 *  - the browser rotated its subscription (endpoint changed) but the backend still
 *    has the old endpoint — we re-save the live one, and
 *  - the stored subscription was created with a now-stale VAPID key — we unsubscribe
 *    and re-subscribe with the current key.
 *
 * Returns the active subscription, or `null` when notification permission has not
 * been granted (so callers can decide whether to prompt).
 */
export const ensurePushSubscription = async (
  registration: ServiceWorkerRegistration
): Promise<PushSubscription | null> => {
  const { vapid_public_key } = await pushNotificationService.getVapidKey();
  if (!vapid_public_key) throw new Error("VAPID public key is not configured on the server");

  let subscription = await registration.pushManager.getSubscription();

  // Drop a subscription bound to a stale VAPID key so it can be rebound below.
  if (subscription && !subscriptionMatchesVapidKey(subscription, vapid_public_key)) {
    await subscription.unsubscribe();
    subscription = null;
  }

  if (!subscription) {
    // Only mint a new subscription once the user has granted permission.
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return null;
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid_public_key),
    });
  }

  // Always persist so the backend endpoint matches the live browser subscription.
  await saveSubscriptionToBackend(subscription);
  return subscription;
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

  await saveSubscriptionToBackend(subscription);
  return subscription;
};
