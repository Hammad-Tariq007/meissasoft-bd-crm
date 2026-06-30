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

  // The backend composes the full title ("<ID>: <name> | <sender>"); render it
  // as-is and fall back to the work item identifier or a generic label.
  const title = payload.title || payload.issueIdentifier || "Notification";
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
  // Always dismiss the notification first.
  event.notification.close();

  // Ignore the explicit "Dismiss" action button.
  if (event.action === "close") return;

  const data = event.notification.data || {};

  // Resolve the work item URL from the notification payload and normalize it so
  // the comment reference is carried as a `?commentId=<id>` query param (the
  // frontend reads it from the query string to scroll/highlight the comment).
  const target = new URL(data.url || "/", self.location.origin);
  // Drop any pre-existing `#comment-...` hash from the payload url.
  target.hash = "";
  if (data.commentId) {
    target.searchParams.set("commentId", data.commentId);
  }
  const finalUrl = target.href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // Prefer focusing an already-open window and navigating it to the work item.
      for (const client of clientList) {
        if ("focus" in client) {
          try {
            // `navigate` only works for clients this service worker controls and
            // can reject otherwise — fall back to opening a fresh window below.
            if ("navigate" in client && client.url !== finalUrl) {
              const navigated = await client.navigate(finalUrl);
              if (navigated) return navigated.focus();
            }
            return client.focus();
          } catch (error) {
            // Controlled-client navigation failed; open a new window instead so
            // the work item still opens end-to-end.
            if (self.clients.openWindow) return self.clients.openWindow(finalUrl);
            return undefined;
          }
        }
      }

      // No existing window — open a new one.
      if (self.clients.openWindow) return self.clients.openWindow(finalUrl);
      return undefined;
    })()
  );
});

// Handle notification action clicks (for buttons)
self.addEventListener("notificationclose", (event) => {
  // Optional: Track when notifications are dismissed
  console.log("[SW] Notification dismissed:", event.notification.data);
});
