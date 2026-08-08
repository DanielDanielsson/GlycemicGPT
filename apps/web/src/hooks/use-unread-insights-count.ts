import { useCallback, useEffect, useState } from "react";

import { getUnreadInsightsCount } from "@/lib/api";

const UNREAD_COUNT_DEDUPE_MS = 1_000;

interface CachedUnreadCount {
  value: number;
  expiresAt: number;
}

interface UnreadCountState {
  userId: string | null;
  value: number;
}

const cachedUnreadCounts = new Map<string, CachedUnreadCount>();
const unreadCountRequests = new Map<string, Promise<number>>();

function readCachedUnreadCount(userId: string) {
  const cached = cachedUnreadCounts.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  return null;
}

function getSharedUnreadInsightsCount(userId: string) {
  const cached = readCachedUnreadCount(userId);
  if (cached !== null) {
    return Promise.resolve(cached);
  }
  const activeRequest = unreadCountRequests.get(userId);
  if (activeRequest) {
    return activeRequest;
  }

  const request = getUnreadInsightsCount()
    .then((value) => {
      cachedUnreadCounts.set(userId, {
        value,
        expiresAt: Date.now() + UNREAD_COUNT_DEDUPE_MS,
      });
      return value;
    })
    .finally(() => {
      unreadCountRequests.delete(userId);
    });
  unreadCountRequests.set(userId, request);
  return request;
}

export function clearUnreadInsightsCountCache(userId?: string) {
  if (userId) {
    cachedUnreadCounts.delete(userId);
    unreadCountRequests.delete(userId);
    return;
  }

  cachedUnreadCounts.clear();
  unreadCountRequests.clear();
}

export function useUnreadInsightsCount(
  enabled: boolean,
  userId: string | null,
) {
  const [unreadCount, setUnreadCount] = useState<UnreadCountState>(() => ({
    userId,
    value: enabled && userId ? (readCachedUnreadCount(userId) ?? 0) : 0,
  }));

  const fetchCount = useCallback(async () => {
    if (!enabled || !userId) {
      return null;
    }

    try {
      return await getSharedUnreadInsightsCount(userId);
    } catch {
      // The badge is optional, so a failed refresh should not interrupt navigation.
      return null;
    }
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) {
      return;
    }

    let active = true;
    const refresh = async () => {
      if (!active) return;
      const count = await fetchCount();
      if (active && count !== null) {
        setUnreadCount({ userId, value: count });
      }
    };

    void refresh();
    const interval = setInterval(refresh, 60_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [enabled, fetchCount, userId]);

  return enabled && unreadCount.userId === userId ? unreadCount.value : 0;
}
