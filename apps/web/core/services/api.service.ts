/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import axios from "axios";

export abstract class APIService {
  protected baseURL: string;
  private axiosInstance: AxiosInstance;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.axiosInstance = axios.create({
      baseURL,
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error.response?.status;
        if (status === 401) {
          const currentPath = window.location.pathname;
          window.location.replace(`/${currentPath ? `?next_path=${currentPath}` : ``}`);
        } else if (status === 403) {
          // Access revoked mid-session: a WRITE on a Settings page came back forbidden because
          // the acting user's OWN role no longer permits the endpoint (e.g. an admin demoted
          // while the stale admin UI is still open). Reload to the workspace home, which refetches
          // member-info and applies the demoted role.
          //
          // Narrowed (see project-role-promotion investigation): only fire when the 403 is a
          // GENERIC permission-layer denial — the allow_permission decorator's exact message, or
          // a DRF permission-class `detail`. Action-specific 403s (which still mean "you're an
          // admin, but THIS action is disallowed", e.g. project-role "cannot assign a role >= your
          // own") carry their own `error` message and must surface as a normal toast, NOT a silent
          // reload. Judgment call: 403 alone can't perfectly separate "my access was revoked" from
          // "this action was never allowed", so we key on the permission LAYER's generic denials;
          // a rare never-allowed action routed through a permission class could still redirect, but
          // that's an access-shaped error and harmless (no data change). A dedicated backend marker
          // would make this exact — noted for follow-up.
          const method = (error.config?.method ?? "").toLowerCase();
          const path = window.location.pathname;
          const isWrite = !!method && method !== "get";
          const data = error.response?.data as { error?: unknown; detail?: unknown } | undefined;
          const isAccessRevoked =
            data?.error === "You don't have the required permissions." || typeof data?.detail === "string";
          if (isWrite && path.includes("/settings") && isAccessRevoked) {
            const slug = path.split("/").find(Boolean);
            window.location.replace(slug ? `/${slug}` : "/");
          }
        }
        return Promise.reject(error);
      }
    );
  }

  get(url: string, params = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.get(url, {
      ...params,
      ...config,
    });
  }

  post(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.post(url, data, config);
  }

  put(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.put(url, data, config);
  }

  patch(url: string, data = {}, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.patch(url, data, config);
  }

  delete(url: string, data?: any, config: AxiosRequestConfig = {}) {
    return this.axiosInstance.delete(url, { data, ...config });
  }

  request(config = {}) {
    return this.axiosInstance(config);
  }
}
