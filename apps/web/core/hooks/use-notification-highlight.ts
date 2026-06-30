/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const HIGHLIGHT_CLASS = "notification-highlight";
const HIGHLIGHT_DURATION_MS = 3000;
// When arriving from a push notification the page loads cold: the work item,
// its activity and the comments are each fetched before the target comment is
// in the DOM. Wait (via a MutationObserver) up to this long for it to appear.
const GIVE_UP_AFTER_MS = 30000;
// The description editor / activity feed keep growing after the comment first
// mounts, shifting its position, so re-scroll a couple of times once it settles.
const RESCROLL_DELAYS_MS = [400, 1200];

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

    let done = false;
    let observer: MutationObserver | undefined;
    let giveUpTimeout: ReturnType<typeof setTimeout> | undefined;
    let fadeTimeout: ReturnType<typeof setTimeout> | undefined;
    const reScrollTimeouts: ReturnType<typeof setTimeout>[] = [];
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

    const stopWaiting = () => {
      observer?.disconnect();
      observer = undefined;
      if (giveUpTimeout) clearTimeout(giveUpTimeout);
    };

    // Strip only the comment-related params so a refresh / back navigation does
    // not re-trigger the highlight, while preserving any other query params.
    const clearDeepLinkFromUrl = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("commentId");
      url.searchParams.delete("_highlightComment");
      url.hash = "";
      window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}`);
    };

    const scrollToComment = (el: HTMLElement) => el.scrollIntoView({ behavior: "smooth", block: "center" });

    const highlightComment = (el: HTMLElement) => {
      if (done) return;
      done = true;
      stopWaiting();

      scrollToComment(el);
      // Correct the position after late-loading content shifts the layout.
      RESCROLL_DELAYS_MS.forEach((delay) => {
        reScrollTimeouts.push(setTimeout(() => scrollToComment(el), delay));
      });

      // Restart the CSS fade cleanly even if the class is somehow already set.
      el.classList.remove(HIGHLIGHT_CLASS);
      void el.offsetWidth; // force reflow so re-adding the class replays the animation
      el.classList.add(HIGHLIGHT_CLASS);
      highlightedEl = el;
      fadeTimeout = setTimeout(() => el.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS);

      clearDeepLinkFromUrl();
    };

    // The comment may already be present (warm navigation); otherwise watch the
    // DOM until it mounts.
    const existing = findCommentElement();
    if (existing) {
      highlightComment(existing);
    } else {
      observer = new MutationObserver(() => {
        const el = findCommentElement();
        if (el) highlightComment(el);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      giveUpTimeout = setTimeout(stopWaiting, GIVE_UP_AFTER_MS);
    }

    return () => {
      stopWaiting();
      if (fadeTimeout) clearTimeout(fadeTimeout);
      reScrollTimeouts.forEach(clearTimeout);
      if (highlightedEl) highlightedEl.classList.remove(HIGHLIGHT_CLASS);
    };
  }, [commentIdParam]);
};
