"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPumpEventHistory, type PumpEventReading } from "@/lib/api";
import { type ChartTimePeriod, PERIOD_TO_MINUTES } from "@/lib/chart-periods";

const PERIOD_TO_LIMIT: Record<ChartTimePeriod, number> = {
  "3h": 200,
  "6h": 400,
  "12h": 600,
  "24h": 1000,
  "3d": 2000,
  "7d": 3500,
  "14d": 5000,
  "30d": 5000,
};

export interface UseLegacyPumpEventsReturn {
  events: PumpEventReading[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/** Preserves the pump request behavior used by the legacy Recharts dashboard. */
export function useLegacyPumpEvents(
  period: ChartTimePeriod,
): UseLegacyPumpEventsReturn {
  const [events, setEvents] = useState<PumpEventReading[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  const fetchData = useCallback(async () => {
    const generation = ++fetchGenRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const data = await getPumpEventHistory(
        PERIOD_TO_MINUTES[period],
        PERIOD_TO_LIMIT[period],
      );
      if (generation === fetchGenRef.current) {
        setEvents(data.events);
      }
    } catch (caughtError) {
      if (generation === fetchGenRef.current) {
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Failed to load pump events",
        );
      }
    } finally {
      if (generation === fetchGenRef.current) {
        setIsLoading(false);
      }
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { events, isLoading, error, refetch: fetchData };
}
