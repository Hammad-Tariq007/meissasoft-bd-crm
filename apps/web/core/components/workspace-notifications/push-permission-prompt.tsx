/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { BellRing, X } from "lucide-react";
// plane imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// hooks
import { useUser } from "@/hooks/store/user";
// lib
import {
  ensurePushSubscription,
  isPushNotificationSupported,
  registerPushServiceWorker,
} from "@/lib/push-notifications";

// remember a dismissal so we don't nag the user every time the app loads
const DISMISS_STORAGE_KEY = "plane-push-prompt-dismissed";

export const PushNotificationPrompt = observer(function PushNotificationPrompt() {
  // store hooks
  const { data: currentUser } = useUser();
  // states
  const [isVisible, setIsVisible] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    // only consider an authenticated user in a push-capable browser
    if (!currentUser?.id || !isPushNotificationSupported()) return;
    // can't ask again once the user has blocked notifications
    if (Notification.permission === "denied") return;

    let cancelled = false;
    const evaluate = async () => {
      try {
        const registration = await registerPushServiceWorker();
        if (!registration || cancelled) return;

        if (Notification.permission === "granted") {
          // Reconcile every load: re-save the live subscription and re-subscribe
          // if it was bound to a stale VAPID key, so the backend never pushes to a
          // subscription the browser can no longer decrypt.
          await ensurePushSubscription(registration);
          return;
        }

        // permission === "default" -> show the in-app opt-in prompt (unless dismissed)
        if (localStorage.getItem(DISMISS_STORAGE_KEY) === "true") return;
        if (!cancelled) setIsVisible(true);
      } catch (error) {
        console.error("Unable to initialize push notifications", error);
      }
    };

    evaluate();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const handleEnable = async () => {
    setIsSubscribing(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setIsVisible(false);
        return;
      }

      const registration = await registerPushServiceWorker();
      if (!registration) throw new Error("Service worker is unavailable");

      await ensurePushSubscription(registration);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Notifications enabled",
        message: "You'll now receive desktop notifications from Plane.",
      });
      setIsVisible(false);
    } catch (error) {
      console.error("Unable to subscribe to push notifications", error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Something went wrong",
        message: "We couldn't enable desktop notifications. Please try again.",
      });
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_STORAGE_KEY, "true");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="shadow-lg fixed right-4 bottom-4 z-50 w-80 rounded-lg border border-subtle bg-layer-1 p-4">
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-tertiary transition-colors hover:text-primary"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-accent-primary">
          <BellRing className="h-4 w-4" />
        </span>
        <div className="space-y-1 pr-4">
          <h4 className="text-body-sm-medium text-primary">Enable desktop notifications</h4>
          <p className="text-caption-sm-regular text-secondary">
            Get notified about mentions and updates to your work items, even when Plane is in the background.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="tertiary" onClick={handleDismiss} disabled={isSubscribing}>
          Not now
        </Button>
        <Button variant="primary" onClick={handleEnable} loading={isSubscribing}>
          Enable
        </Button>
      </div>
    </div>
  );
});
