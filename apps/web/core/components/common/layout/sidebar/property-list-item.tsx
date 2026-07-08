/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { cn } from "@plane/utils";

type TSidebarPropertyListItemProps = {
  icon: React.FC<{ className?: string }>;
  label: string;
  children: ReactNode;
  appendElement?: ReactNode;
  childrenClassName?: string;
  className?: string;
};

export function SidebarPropertyListItem(props: TSidebarPropertyListItemProps) {
  const { icon: Icon, label, children, appendElement, childrenClassName, className } = props;

  return (
    <div role="group" aria-label={label} className={cn("flex items-start gap-3", className)}>
      <div className="flex h-7.5 w-40 shrink-0 items-center gap-1.5 text-body-xs-regular text-tertiary">
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        {appendElement}
      </div>
      <div className={cn("flex grow flex-wrap items-center gap-1", childrenClassName)}>{children}</div>
    </div>
  );
}
