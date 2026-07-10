/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
import { v4 as uuidv4 } from "uuid";
// plane imports
import type { TPresenceManualStatus, TUserPresence, TUserPresenceStatus } from "@plane/types";
// services
import { PresenceService } from "@/services/presence.service";
// store
import type { CoreRootStore } from "./root.store";

// Cadences (ms). Defaults; heartbeat/poll can be re-tuned from the server response.
// Poll is what gates how fast *other* clients see a status change (your own tab updates
// optimistically, so a slow poll only ever delays presence for everyone else). 10s is
// imperceptible for "who's around" yet ~10x lighter than 1s on the shared prod box — the
// right trade for a per-tab loop. Heartbeat stays high (it only refreshes the TTL + asserts
// idle; manual changes fire an immediate beat) so backgrounded tabs whose timers get
// throttled don't flap offline.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const IDLE_THRESHOLD_MS = 5 * 60_000;
const IDLE_CHECK_INTERVAL_MS = 20_000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "focus", "visibilitychange"];

const MANUAL_STATUSES = new Set<TPresenceManualStatus>(["online", "away", "dnd", "offline"]);

const nowEpoch = () => Math.floor(Date.now() / 1000);

export interface IPresenceStore {
  // observables
  presenceMap: Record<string, TUserPresence>;
  manualStatus: TPresenceManualStatus;
  isIdle: boolean;
  // resolvers
  getUserStatus: (userId: string | undefined) => TUserPresenceStatus;
  getUserPresence: (userId: string | undefined) => TUserPresence | undefined;
  // lifecycle
  start: (workspaceSlug: string) => void;
  stop: () => void;
  // actions
  setManualStatus: (status: TPresenceManualStatus) => Promise<void>;
}

export class PresenceStore implements IPresenceStore {
  // observables — one entry per user with a durable trail, offline included.
  presenceMap: Record<string, TUserPresence> = {};
  manualStatus: TPresenceManualStatus = "online";
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
      presenceMap: observable,
      manualStatus: observable,
      isIdle: observable,
      start: action,
      stop: action,
      setManualStatus: action,
    });
  }

  /** Single resolver every avatar/consumer reads. Absence from the map == offline. */
  getUserStatus = (userId: string | undefined): TUserPresenceStatus =>
    (userId ? this.presenceMap[userId]?.status : undefined) || "offline";

  /** Full presence entry (status + last_seen/last_active) for label rendering. */
  getUserPresence = (userId: string | undefined): TUserPresence | undefined =>
    userId ? this.presenceMap[userId] : undefined;

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
    // hydrate the manual override from the current user so it is asserted from the very
    // first heartbeat (unknown/legacy values fall back to the "online" auto default).
    const manual = this.rootStore.user?.data?.presence_manual_status;
    runInAction(() => {
      this.manualStatus = MANUAL_STATUSES.has(manual as TPresenceManualStatus)
        ? (manual as TPresenceManualStatus)
        : "online";
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
    if (this.manualStatus === status) return;
    // Local-first, zero-await: flip the menu selection AND our own avatar dot in the same
    // synchronous action, so the UI is instant regardless of network/throttle. The heartbeat
    // carries manual_status, so live presence for everyone else is asserted immediately too;
    // the durable POST below is best-effort persistence only (no rollback, no flicker).
    runInAction(() => {
      this.manualStatus = status;
      this.applyOwnStatusLocally(status);
    });
    void this.heartbeat().then(() => this.poll());
    this.service.updateManualStatus(status).catch(() => {
      // durable persist failed (offline/throttled) — the per-beat heartbeat keeps live
      // presence correct, and it re-persists on the next successful call.
    });
  };

  // -------- internals --------

  /** Optimistically reflect our own manual status in the shared presenceMap so every avatar
   *  dot for the current user updates instantly, before the next poll confirms it. */
  private applyOwnStatusLocally(status: TPresenceManualStatus) {
    const userId = this.rootStore.user?.data?.id;
    if (!userId) return;
    const next = { ...this.presenceMap };
    if (status === "offline") {
      delete next[userId]; // appear offline -> no dot
    } else {
      // auto mode: idle still shows away. Keep any known timestamps, defaulting to now
      // (we are, by definition, active right now unless idle).
      const derived: TUserPresenceStatus = status === "online" ? (this.isIdle ? "away" : "online") : status;
      const prev = next[userId];
      next[userId] = {
        status: derived,
        last_seen: nowEpoch(),
        last_active: this.isIdle ? (prev?.last_active ?? null) : nowEpoch(),
      };
    }
    this.presenceMap = next;
  }

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
        manual_status: this.manualStatus,
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
        const next: Record<string, TUserPresence> = { ...response?.statuses };
        // We are the source of truth for our own *sticky* status (away / dnd / offline):
        // the server only mirrors it from our heartbeat, so a poll that raced our last
        // change could otherwise briefly revert our own dot. Overlay the status (keeping
        // the server's fresh timestamps). "online" is auto mode -> trust the server.
        const userId = this.rootStore.user?.data?.id;
        if (userId && this.manualStatus !== "online") {
          if (this.manualStatus === "offline") delete next[userId];
          else
            next[userId] = {
              status: this.manualStatus,
              last_seen: next[userId]?.last_seen ?? nowEpoch(),
              last_active: next[userId]?.last_active ?? nowEpoch(),
            };
        }
        this.presenceMap = next;
      });
    } catch {
      // keep last-known statuses on a transient failure
    }
  }
}
