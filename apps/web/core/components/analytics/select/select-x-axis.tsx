/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane package imports
import type { TChartDimension } from "@plane/types";
import { CustomSelect } from "@plane/ui";

type Props = {
  value?: TChartDimension;
  onChange: (val: TChartDimension | null) => void;
  options: { value: TChartDimension; label: string }[];
  placeholder?: string;
  hiddenOptions?: TChartDimension[];
  allowNoValue?: boolean;
  label?: string | React.ReactNode;
};

export function SelectXAxis(props: Props) {
  const { value, onChange, options, hiddenOptions, allowNoValue, label } = props;
  return (
    <CustomSelect value={value} label={label} onChange={onChange} maxHeight="lg">
      {allowNoValue && <CustomSelect.Option value={null}>No value</CustomSelect.Option>}
      {options.map((item) => {
        if (hiddenOptions?.includes(item.value)) return null;
        return (
          <CustomSelect.Option key={item.value} value={item.value}>
            {item.label}
          </CustomSelect.Option>
        );
      })}
    </CustomSelect>
  );
}
