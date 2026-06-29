/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense } from "react";
import { observer } from "mobx-react";

const ProfileSettingsModal = lazy(() =>
  import("@/components/settings/profile/modal").then((module) => ({
    default: module.ProfileSettingsModal,
  }))
);

const PushNotificationPrompt = lazy(() =>
  import("@/components/workspace-notifications/push-permission-prompt").then((module) => ({
    default: module.PushNotificationPrompt,
  }))
);

type TGlobalModalsProps = {
  workspaceSlug: string;
};

/**
 * GlobalModals component manages all workspace-level modals across Plane applications.
 *
 * This includes:
 * - Profile settings modal
 * - Desktop (web push) notification opt-in prompt
 */
export const GlobalModals = observer(function GlobalModals(_props: TGlobalModalsProps) {
  return (
    <Suspense fallback={null}>
      <ProfileSettingsModal />
      <PushNotificationPrompt />
    </Suspense>
  );
});
