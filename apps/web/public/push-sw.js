/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Service worker dedicated to web push notifications. It renders the push
 * payload sent by the backend (title / body / icon) and deep-links to the
 * work item when the notification is clicked.
 */

/* eslint-disable no-undef */

const DEFAULT_ICON = "/icons/icon-192x192.png";

self.addEventListener("install", () => {
  // activate this worker immediately, without waiting for old clients to close
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // take control of all open clients as soon as the worker is active
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Plane";
  const options = {
    body: payload.body || "",
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_ICON,
    // carry the deep-link url through to the notificationclick handler
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // focus an existing tab and navigate it to the work item if one is open
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      // otherwise open a new window
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    })
  );
});
