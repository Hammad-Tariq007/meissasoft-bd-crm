/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { lazy, Suspense, useEffect } from "react";
import { useTheme } from "next-themes";
import { SWRConfig } from "swr";
// Plane Imports
import { WEB_SWR_CONFIG } from "@plane/constants";
import { TranslationProvider } from "@plane/i18n";
import { Toast } from "@plane/propel/toast";
// helpers
import { resolveGeneralTheme } from "@plane/utils";
// mobx store provider
import { StoreProvider } from "@/lib/store-context";

// lazy imports
const AppProgressBar = lazy(function AppProgressBar() {
  return import("@/lib/b-progress/AppProgressBar");
});

const StoreWrapper = lazy(function StoreWrapper() {
  return import("@/lib/wrappers/store-wrapper");
});

const InstanceWrapper = lazy(function InstanceWrapper() {
  return import("@/lib/wrappers/instance-wrapper");
});

export interface IAppProvider {
  children: React.ReactNode;
}

/**
 * Component to register the push notification service worker
 */
function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Register service worker for push notifications
      navigator.serviceWorker.register("/push-sw.js").catch((error) => {
        console.warn("Push service worker registration failed:", error);
      });
    }
  }, []);

  return null;
}

export function AppProvider(props: IAppProvider) {
  const { children } = props;
  // themes
  const { resolvedTheme } = useTheme();

  return (
    <StoreProvider>
      <>
        <ServiceWorkerRegistration />
        <AppProgressBar />
        <TranslationProvider>
          <Toast theme={resolveGeneralTheme(resolvedTheme)} />
          <StoreWrapper>
            <InstanceWrapper>
              <Suspense>
                <SWRConfig value={WEB_SWR_CONFIG}>{children}</SWRConfig>
              </Suspense>
            </InstanceWrapper>
          </StoreWrapper>
        </TranslationProvider>
      </>
    </StoreProvider>
  );
}
