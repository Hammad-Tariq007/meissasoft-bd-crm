/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// types
import type { IIssueDisplayFilterOptions } from "@plane/types";
// hooks
import { useSpreadsheetCustomFieldColumns } from "@/hooks/use-spreadsheet-custom-field-columns";
// types
import type { ICustomField } from "@/types/custom-field";
// local imports
import { SpreadsheetCustomFieldCell, SpreadsheetCustomFieldHeader } from "./columns/custom-field-column";

// Header <th> block appended after the built-in spreadsheet columns.
type HeadersProps = {
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
};

export const SpreadsheetCustomFieldHeaders = observer(function SpreadsheetCustomFieldHeaders(props: HeadersProps) {
  const { displayFilters, handleDisplayFilterUpdate } = props;
  const { projectId } = useParams();
  const { visibleFields } = useSpreadsheetCustomFieldColumns(projectId?.toString());

  return (
    <>
      {visibleFields.map((field) => (
        <SpreadsheetCustomFieldHeaderCell
          key={field.id}
          field={field}
          displayFilters={displayFilters}
          handleDisplayFilterUpdate={handleDisplayFilterUpdate}
        />
      ))}
    </>
  );
});

const SpreadsheetCustomFieldHeaderCell = observer(function SpreadsheetCustomFieldHeaderCell(props: {
  field: ICustomField;
  displayFilters: IIssueDisplayFilterOptions;
  handleDisplayFilterUpdate: (data: Partial<IIssueDisplayFilterOptions>) => void;
}) {
  const { field, displayFilters, handleDisplayFilterUpdate } = props;
  const ref = useRef<HTMLTableCellElement | null>(null);
  return (
    <th
      className="h-11 min-w-36 items-center border border-t-0 border-b-0 border-subtle bg-layer-1 py-1 text-13 font-medium"
      ref={ref}
      tabIndex={0}
    >
      <SpreadsheetCustomFieldHeader
        field={field}
        displayFilters={displayFilters}
        handleDisplayFilterUpdate={handleDisplayFilterUpdate}
        onClose={() => ref.current?.focus()}
      />
    </th>
  );
});

// Per-row <td> block appended after the built-in spreadsheet columns.
type CellsProps = {
  issueId: string;
  projectId: string | null | undefined;
};

export const SpreadsheetCustomFieldCells = observer(function SpreadsheetCustomFieldCells(props: CellsProps) {
  const { issueId, projectId } = props;
  const { visibleFields } = useSpreadsheetCustomFieldColumns(projectId);

  return (
    <>
      {visibleFields.map((field) => (
        <td
          key={field.id}
          tabIndex={0}
          className="h-11 min-w-36 border-r-[1px] border-subtle text-13 after:absolute after:bottom-[-1px] after:w-full after:border after:border-subtle"
        >
          <SpreadsheetCustomFieldCell issueId={issueId} field={field} />
        </td>
      ))}
    </>
  );
});
