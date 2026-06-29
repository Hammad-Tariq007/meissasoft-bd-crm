/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Service worker dedicated to web push notifications. It renders professional,
 * Slack/WhatsApp-style notifications and deep-links to specific messages with
 * highlighting when clicked.
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

  // Build professional notification format
  const issueIdentifier = payload.issueIdentifier || "Issue";
  const title = `${issueIdentifier}: ${payload.title || "Update"}`;
  const body = payload.body || "You have a new notification";

  const options = {
    body: body,
    icon: payload.icon || DEFAULT_ICON,
    badge: payload.badge || DEFAULT_ICON,
    tag: payload.tag || "plane-notification", // Group notifications by issue
    requireInteraction: false, // Auto-dismiss after a while

    // Professional visual styling
    vibrate: [200, 100, 200], // Subtle vibration pattern
    silent: false,

    // Actions for user interaction (optional, not all browsers support)
    actions: [
      {
        action: "open",
        title: "Open",
      },
      {
        action: "close",
        title: "Dismiss",
      },
    ],

    // Carry metadata through to the notificationclick handler
    data: {
      url: payload.url || "/",
      issueId: payload.issueId,
      commentId: payload.commentId,
      projectId: payload.projectId,
      workspaceSlug: payload.workspaceSlug,
      issueIdentifier: payload.issueIdentifier,
      timestamp: Date.now(),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = data.url || "/";

  // Build URL with anchor to comment if available
  if (data.commentId) {
    // Ensure commentId is properly anchored for frontend routing
    if (!targetUrl.includes("#")) {
      targetUrl = `${targetUrl}#comment-${data.commentId}`;
    }
  }

  // Include metadata in URL for frontend to handle highlighting
  const urlWithMetadata = new URL(targetUrl, self.location.origin);
  urlWithMetadata.searchParams.set("_highlightComment", data.commentId || "");
  const finalUrl = urlWithMetadata.href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Try to focus existing window/tab and navigate to the URL
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            client.navigate(finalUrl);
          }
          return client.focus();
        }
      }

      // If no window exists, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(finalUrl);
      }
      return undefined;
    })
  );
});

// Handle notification action clicks (for buttons)
self.addEventListener("notificationclose", (event) => {
  // Optional: Track when notifications are dismissed
  console.log("[SW] Notification dismissed:", event.notification.data);
});
