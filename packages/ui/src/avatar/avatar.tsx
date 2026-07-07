/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// ui
import { Tooltip } from "@plane/propel/tooltip";
// helpers
import { cn } from "../utils";
import type { TAvatarSize } from "./helper";
import { getBorderRadius, getSizeInfo, isAValidNumber } from "./helper";

type Props = {
  /**
   * The name of the avatar which will be displayed on the tooltip
   */
  name?: string;
  /**
   * The background color if the avatar image fails to load
   */
  fallbackBackgroundColor?: string;
  /**
   * The text to display if the avatar image fails to load
   */
  fallbackText?: string;
  /**
   * The text color if the avatar image fails to load
   */
  fallbackTextColor?: string;
  /**
   * Whether to show the tooltip or not
   * @default true
   */
  showTooltip?: boolean;
  /**
   * The size of the avatars
   * Possible values: "sm", "md", "base", "lg"
   * @default "md"
   */
  size?: TAvatarSize;
  /**
   * The shape of the avatar
   * Possible values: "circle", "square"
   * @default "circle"
   */
  shape?: "circle" | "square";
  /**
   * The source of the avatar image
   */
  src?: string;
  /**
   * The custom CSS class name to apply to the component
   */
  className?: string;
  /**
   * Optional status-indicator dot color (any CSS color). When provided, a small dot is
   * rendered at the bottom-right corner. When omitted, the avatar renders exactly as before
   * (no wrapper, no dot) — this opt-in gate is what keeps existing usages unchanged.
   */
  statusColor?: string;
  /**
   * The contrast ring around the status dot. Defaults to the base surface so the dot reads
   * against both the avatar and neighbouring avatars.
   */
  statusRingClassName?: string;
  /**
   * Accessible label / title for the status dot.
   */
  statusTitle?: string;
};

export function Avatar(props: Props) {
  const {
    name,
    fallbackBackgroundColor,
    fallbackText,
    fallbackTextColor,
    showTooltip = true,
    size = "md",
    shape = "circle",
    src,
    className = "",
    statusColor,
    statusRingClassName = "border-surface-1",
    statusTitle,
  } = props;

  // get size details based on the size prop
  const sizeInfo = getSizeInfo(size);
  const isNumericSize = isAValidNumber(size);

  // the avatar box is unchanged from before, so the opt-in status path below can reuse it
  // verbatim and the no-status path renders byte-identically to the previous version.
  const avatarBox = (
    <div
      className={cn("grid place-items-center overflow-hidden", getBorderRadius(shape), {
        [sizeInfo.avatarSize]: !isNumericSize,
      })}
      style={isNumericSize ? { height: `${size}px`, width: `${size}px` } : {}}
      tabIndex={-1}
    >
      {src ? (
        <img src={src} className={cn("h-full w-full", getBorderRadius(shape), className)} alt={name} />
      ) : (
        <div
          className={cn(sizeInfo.fontSize, "grid h-full w-full place-items-center", getBorderRadius(shape), className)}
          style={{
            backgroundColor: fallbackBackgroundColor ?? "#028375",
            color: fallbackTextColor ?? "#ffffff",
          }}
        >
          {name?.[0]?.toUpperCase() ?? fallbackText ?? "?"}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip tooltipContent={fallbackText ?? name ?? "?"} disabled={!showTooltip}>
      {statusColor ? (
        <div className="relative inline-grid place-items-center">
          {avatarBox}
          <span
            role="img"
            aria-label={statusTitle}
            title={statusTitle}
            className={cn(
              "absolute right-0 bottom-0 rounded-full border-2",
              statusRingClassName,
              isNumericSize ? "" : sizeInfo.dotSize
            )}
            style={
              isNumericSize
                ? {
                    backgroundColor: statusColor,
                    height: `${Math.max(6, Math.round((size as number) * 0.3))}px`,
                    width: `${Math.max(6, Math.round((size as number) * 0.3))}px`,
                  }
                : { backgroundColor: statusColor }
            }
          />
        </div>
      ) : (
        avatarBox
      )}
    </Tooltip>
  );
}
