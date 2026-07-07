/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { v4 as uuidv4 } from "uuid";
// plane imports
import type { TPresenceManualStatus, TUserPresenceStatus } from "@plane/types";
// services
import { PresenceService } from "@/services/presence.service";
// store
import type { CoreRootStore } from "./root.store";

// Cadences (ms). Defaults; heartbeat/poll can be re-tuned from the server response.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 45_000;
const IDLE_THRESHOLD_MS = 5 * 60_000;
const IDLE_CHECK_INTERVAL_MS = 20_000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "focus", "visibilitychange"];

type TPresentStatus = Exclude<TUserPresenceStatus, "offline">;

export interface IPresenceStore {
  // observables
  statusMap: Record<string, TPresentStatus>;
  manualStatus: TPresenceManualStatus;
  isIdle: boolean;
  // resolver
  getUserStatus: (userId: string | undefined) => TUserPresenceStatus;
  // lifecycle
  start: (workspaceSlug: string) => void;
  stop: () => void;
  // actions
  setManualStatus: (status: TPresenceManualStatus) => Promise<void>;
}

export class PresenceStore implements IPresenceStore {
  // observables
  statusMap: Record<string, TPresentStatus> = {};
  manualStatus: TPresenceManualStatus = "available";
  isIdle = false;

  // non-observable lifecycle handles — exactly one of each can ever exist, which is
  // what guarantees no duplicate loops across re-render / fast workspace-switch.
  private sessionId: string | null = null;
  private activeWorkspaceSlug: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt = 0;
  private activityHandler: (() => void) | null = null;

  private service: PresenceService;
  private rootStore: CoreRootStore;

  constructor(rootStore: CoreRootStore) {
    this.rootStore = rootStore;
    this.service = new PresenceService();
    makeObservable(this, {
      statusMap: observable,
      manualStatus: observable,
      isIdle: observable,
      start: action,
      stop: action,
      setManualStatus: action,
    });
  }

  /** Single resolver every avatar/consumer reads. Absence from the map == offline. */
  getUserStatus = (userId: string | undefined): TUserPresenceStatus => (userId && this.statusMap[userId]) || "offline";

  start = (workspaceSlug: string) => {
    if (typeof window === "undefined") return; // SSR guard
    // idempotent: already running for this workspace -> do nothing (no extra timers)
    if (this.activeWorkspaceSlug === workspaceSlug && this.heartbeatTimer) return;
    // defensive teardown so a workspace-switch / StrictMode double-invoke can never
    // leave a second set of loops running.
    this.teardown();

    this.activeWorkspaceSlug = workspaceSlug;
    if (!this.sessionId) this.sessionId = uuidv4(); // one id per tab, stable for its life
    this.lastActivityAt = Date.now();
    // hydrate DND from the current user so it is asserted from the very first heartbeat
    const manual = this.rootStore.user?.data?.presence_manual_status;
    runInAction(() => {
      this.manualStatus = manual === "dnd" ? "dnd" : "available";
      this.isIdle = false;
    });

    this.activityHandler = () => this.onActivity();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, this.activityHandler!, { passive: true }));

    // immediate beat + read, then the loops
    void this.heartbeat();
    void this.poll();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), DEFAULT_HEARTBEAT_INTERVAL_MS);
    this.pollTimer = setInterval(() => void this.poll(), DEFAULT_POLL_INTERVAL_MS);
    this.idleTimer = setInterval(() => this.checkIdle(), IDLE_CHECK_INTERVAL_MS);
  };

  stop = () => {
    this.teardown();
  };

  setManualStatus = async (status: TPresenceManualStatus) => {
    await this.service.updateManualStatus(status);
    runInAction(() => {
      this.manualStatus = status;
    });
    void this.heartbeat(); // assert immediately rather than waiting for the next beat
  };

  // -------- internals --------

  private teardown() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.idleTimer = null;
    if (this.activityHandler && typeof window !== "undefined") {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, this.activityHandler!));
    }
    this.activityHandler = null;
    this.activeWorkspaceSlug = null;
  }

  private onActivity() {
    this.lastActivityAt = Date.now();
    if (this.isIdle) {
      runInAction(() => {
        this.isIdle = false;
      });
      void this.heartbeat(); // resume to Online immediately
    }
  }

  private checkIdle() {
    if (!this.isIdle && Date.now() - this.lastActivityAt > IDLE_THRESHOLD_MS) {
      runInAction(() => {
        this.isIdle = true;
      });
      void this.heartbeat();
    }
  }

  private async heartbeat() {
    const slug = this.activeWorkspaceSlug;
    if (!slug || !this.sessionId) return;
    try {
      await this.service.sendHeartbeat(slug, {
        session_id: this.sessionId,
        idle: this.isIdle,
        dnd: this.manualStatus === "dnd",
      });
    } catch {
      // transient — the next beat retries; offline is derived server-side via TTL
    }
  }

  private async poll() {
    const slug = this.activeWorkspaceSlug;
    if (!slug) return;
    try {
      const response = await this.service.fetchPresence(slug);
      runInAction(() => {
        this.statusMap = response?.statuses ?? {};
      });
    } catch {
      // keep last-known statuses on a transient failure
    }
  }
}
