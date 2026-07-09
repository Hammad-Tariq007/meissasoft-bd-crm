/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { BDMessage } from "./common";

export type TWinRateBarRow = {
  key: string;
  name: string;
  won: number;
  closed: number;
  win_rate: number | null;
};

type Props = {
  rows: TWinRateBarRow[];
  /** Reference line drawn across every track (industry benchmark ~21%). */
  benchmark?: number;
  /** Slices at/above this win rate are highlighted as strong performers. */
  highlightAbove?: number;
  emptyTitle?: string;
  emptyDescription?: string;
};

// Brand tokens shared with the other BD widgets.
const STRONG = "#198038"; // green
const NEUTRAL = "#1192E8"; // blue

/**
 * A ranked horizontal bar list of win rate by slice. Bars are sorted descending,
 * each shows its win % and the won/closed counts, a dashed benchmark line sits at
 * the same x across every track, and slices at/above the highlight threshold are
 * coloured green. Slices with no closed leads (win_rate === null) render muted.
 */
export function WinRateBars(props: Props) {
  const { rows, benchmark = 21, highlightAbove = 35, emptyTitle = "No data", emptyDescription } = props;

  // Sort by win rate desc; slices with no closed leads (null) sink to the bottom.
  // Spread already copies, so the in-place sort is safe; toSorted() would need the
  // es2023 lib target, which this project doesn't enable.
  // eslint-disable-next-line unicorn/no-array-sort
  const sorted = [...rows].sort((a, b) => (b.win_rate ?? -1) - (a.win_rate ?? -1));

  if (sorted.length === 0) {
    return <BDMessage title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-11 text-tertiary">
        Dashed line = {benchmark}% benchmark · green = strong (≥{highlightAbove}%)
      </div>
      <div className="flex flex-col gap-2.5">
        {sorted.map((row) => {
          const hasClosed = row.win_rate !== null;
          const value = row.win_rate ?? 0;
          const isStrong = hasClosed && value >= highlightAbove;
          return (
            <div key={row.key} className="flex items-center gap-3">
              <div className="w-28 shrink-0 truncate text-13 text-secondary" title={row.name}>
                {row.name}
              </div>
              <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-layer-1">
                {/* benchmark reference line */}
                <div
                  className="absolute top-0 bottom-0 z-10 border-l border-dashed border-strong/60"
                  style={{ left: `${benchmark}%` }}
                  aria-hidden
                />
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{ width: `${value}%`, backgroundColor: isStrong ? STRONG : NEUTRAL }}
                  role="img"
                  aria-label={`${row.name}: ${hasClosed ? `${value}% win rate` : "no closed leads"}`}
                />
              </div>
              <div className="flex w-24 shrink-0 items-baseline justify-end gap-1.5">
                <span className="text-13 font-medium text-primary">{hasClosed ? `${value}%` : "—"}</span>
                <span className="text-11 text-tertiary">
                  ({row.won}/{row.closed})
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
