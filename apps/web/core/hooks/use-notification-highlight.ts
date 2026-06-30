/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const HIGHLIGHT_CLASS = "notification-highlight";
const HIGHLIGHT_DURATION_MS = 3000;
// Comments can render slightly after this hook mounts (or the page may still be
// loading when arriving from a push notification), so retry locating the element
// for a bounded window instead of giving up immediately.
const MAX_ATTEMPTS = 20;
const RETRY_INTERVAL_MS = 300;

/**
 * Highlights and scrolls to a comment when the work item is opened from a push
 * notification. The service worker deep-links with `?commentId=<id>`; we also
 * accept a `#comment-<id>` hash and the legacy `_highlightComment` param.
 */
export const useNotificationHighlight = () => {
  const searchParams = useSearchParams();
  const commentIdParam = searchParams.get("commentId");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Resolve the target comment id from the query param, a comment hash, or the
    // legacy param (kept for backwards compatibility with older notifications).
    const hashComment = window.location.hash.startsWith("#comment-")
      ? window.location.hash.replace("#comment-", "")
      : "";
    const legacyParam = new URLSearchParams(window.location.search).get("_highlightComment");
    const targetId = commentIdParam || hashComment || legacyParam;
    if (!targetId) return;

    let attempts = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;
    let fadeTimeout: ReturnType<typeof setTimeout> | undefined;
    let highlightedEl: HTMLElement | null = null;

    const findCommentElement = (): HTMLElement | null => {
      const selectors = [
        `#comment-${targetId}`, // canonical id rendered on each comment card
        `[data-comment-id="${targetId}"]`,
        `#${targetId}`, // legacy/bare id fallback
      ];
      for (const selector of selectors) {
        try {
          const el = document.querySelector<HTMLElement>(selector);
          if (el) return el;
        } catch {
          // invalid selector (e.g. id with unusual chars) — try the next one
        }
      }
      return null;
    };

    // Strip only the comment-related params so a refresh / back navigation does
    // not re-trigger the highlight, while preserving any other query params.
    const clearDeepLinkFromUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("commentId");
      url.searchParams.delete("_highlightComment");
      url.hash = "";
      const cleaned = `${url.pathname}${url.search}`;
      window.history.replaceState(window.history.state, document.title, cleaned);
    };

    const highlight = () => {
      const el = findCommentElement();
      if (!el) {
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) return; // comments never showed up — stop retrying
        retryTimeout = setTimeout(highlight, RETRY_INTERVAL_MS);
        return;
      }

      el.scrollIntoView({ behavior: "smooth", block: "center" });

      // Restart the CSS fade animation cleanly if the class is somehow present.
      el.classList.remove(HIGHLIGHT_CLASS);
      // force reflow so re-adding the class replays the animation
      void el.offsetWidth;
      el.classList.add(HIGHLIGHT_CLASS);
      highlightedEl = el;

      fadeTimeout = setTimeout(() => {
        el.classList.remove(HIGHLIGHT_CLASS);
      }, HIGHLIGHT_DURATION_MS);

      clearDeepLinkFromUrl();
    };

    highlight();

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      if (fadeTimeout) clearTimeout(fadeTimeout);
      if (highlightedEl) highlightedEl.classList.remove(HIGHLIGHT_CLASS);
    };
  }, [commentIdParam]);
};
