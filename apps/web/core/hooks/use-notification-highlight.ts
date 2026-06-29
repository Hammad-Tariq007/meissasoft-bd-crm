/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";

/**
 * Hook to handle notification comment highlighting when landing from a push notification.
 * Highlights the comment element and scrolls it into view.
 */
export const useNotificationHighlight = () => {
  useEffect(() => {
    // Get comment ID from URL params (set by service worker)
    const params = new URLSearchParams(window.location.search);
    const commentIdToHighlight = params.get("_highlightComment");

    // Also check URL hash for comment anchor
    const hashComment = window.location.hash.replace("#comment-", "");
    const commentId = commentIdToHighlight || hashComment;

    if (!commentId) return;

    // Function to highlight and scroll to comment
    const highlightComment = () => {
      // Try multiple selectors as the comment element might be nested differently
      const selectors = [`[data-comment-id="${commentId}"]`, `#comment-${commentId}`, `[id*="${commentId}"]`];

      let commentElement = null;
      for (const selector of selectors) {
        commentElement = document.querySelector(selector);
        if (commentElement) break;
      }

      if (!commentElement) {
        console.warn(`[Highlight] Comment element not found for ID: ${commentId}`);
        // Retry after a delay in case content is still loading
        setTimeout(highlightComment, 500);
        return;
      }

      // Add highlight animation/styling
      commentElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Add highlight class for visual effect (3 seconds)
      commentElement.classList.add("notification-highlight");
      setTimeout(() => {
        commentElement.classList.remove("notification-highlight");
      }, 3000);

      // Flash background color for immediate visual feedback
      const originalBgColor = window.getComputedStyle(commentElement).backgroundColor;
      commentElement.style.backgroundColor = "rgba(59, 130, 246, 0.2)"; // Light blue highlight
      setTimeout(() => {
        commentElement.style.backgroundColor = originalBgColor;
      }, 2000);

      console.log(`[Highlight] Highlighted comment: ${commentId}`);

      // Clean up URL params
      window.history.replaceState({}, document.title, window.location.pathname);
    };

    // Wait for DOM to settle and then highlight
    highlightComment();
  }, []);
};
