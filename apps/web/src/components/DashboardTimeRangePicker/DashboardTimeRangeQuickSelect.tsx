"use client";

import { TimeRangeQuickSelect } from "@/components/TimeRangeQuickSelect";
import type { HistorySelection } from "@/lib/glucose/history-selection";
import type {
  DashboardTimeRangeQuickSelectProps,
  QuickTimeRange,
} from "./DashboardTimeRangePicker.types";

interface QuickTimeRangeOption {
  key: QuickTimeRange;
  label: string;
  accessibleLabel: string;
}

const QUICK_TIME_RANGES: QuickTimeRangeOption[] = [
  { key: "3h", label: "3h", accessibleLabel: "Last 3 hours" },
  { key: "6h", label: "6h", accessibleLabel: "Last 6 hours" },
  { key: "12h", label: "12h", accessibleLabel: "Last 12 hours" },
  { key: "24h", label: "24h", accessibleLabel: "Last 24 hours" },
  { key: "3d", label: "3d", accessibleLabel: "Last 3 days" },
  { key: "7d", label: "7d", accessibleLabel: "Last 7 days" },
  { key: "14d", label: "14d", accessibleLabel: "Last 14 days" },
  { key: "30d", label: "30d", accessibleLabel: "Last 30 days" },
  { key: "60d", label: "60d", accessibleLabel: "Last 60 days" },
  { key: "90d", label: "90d", accessibleLabel: "Last 90 days" },
];

const GRID_COLS_BY_COUNT: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-4",
  8: "grid-cols-4",
  9: "grid-cols-5",
  10: "grid-cols-5",
};

function getActiveRange(selection: HistorySelection): QuickTimeRange | null {
  if (selection.kind === "preset") {
    return selection.range;
  }

  return null;
}

export function DashboardTimeRangeQuickSelect({
  ranges,
  selection,
  onChange,
}: DashboardTimeRangeQuickSelectProps) {
  const options = ranges
    ? QUICK_TIME_RANGES.filter((option) => ranges.includes(option.key))
    : QUICK_TIME_RANGES;

  function selectRange(range: QuickTimeRange) {
    onChange({ kind: "preset", range });
  }

  return (
    <TimeRangeQuickSelect
      className={GRID_COLS_BY_COUNT[options.length] ?? "grid-cols-5"}
      onChange={selectRange}
      options={options.map((option) => ({
        accessibleLabel: option.accessibleLabel,
        label: option.label,
        value: option.key,
      }))}
      value={getActiveRange(selection)}
    />
  );
}
