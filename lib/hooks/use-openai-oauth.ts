/**
 * Client-side hook for OpenAI OAuth login/logout/status.
 *
 * - On mount: fetches connection status from /api/auth/openai/status
 * - login(): opens a popup window for the OAuth flow
 * - logout(): disconnects and clears tokens
 * - Proactive refresh: if token expires within 10 minutes, auto-refreshes
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useOAuthStatusStore } from '@/lib/store/oauth-status';

const REFRESH_BUFFER_MS = 10 * 60 * 1000; // 10 minutes before expiry
const STATUS_POLL_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

export function useOpenAIOAuth() {
  const { enabled, isConnected, expiresAt, isLoading, setStatus, reset } = useOAuthStatusStore();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/openai/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch {
      // Silently fail — status will be rechecked
    }
  }, [setStatus]);

  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/openai/refresh', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setStatus({ enabled: true, connected: true, expiresAt: data.expiresAt });
          return;
        }
      }
      // Refresh failed — user needs to re-login
      reset();
    } catch {
      // Network error — don't reset, will retry on next poll
    }
  }, [setStatus, reset]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!expiresAt) return;

    const timeUntilRefresh = expiresAt - Date.now() - REFRESH_BUFFER_MS;
    if (timeUntilRefresh <= 0) {
      // Token is about to expire or already expired — refresh now
      refreshToken();
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      refreshToken();
    }, timeUntilRefresh);
  }, [expiresAt, refreshToken]);

  const login = useCallback(() => {
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;

    const popup = window.open(
      '/api/auth/openai/login',
      'openai-oauth',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    );

    // Listen for the callback message from the popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'openai-oauth-success') {
        window.removeEventListener('message', handleMessage);
        fetchStatus();
      }
    };
    window.addEventListener('message', handleMessage);

    // Also poll in case postMessage doesn't work (e.g. cross-origin issues)
    const pollTimer = setInterval(() => {
      if (popup && popup.closed) {
        clearInterval(pollTimer);
        window.removeEventListener('message', handleMessage);
        fetchStatus();
      }
    }, 500);

    // Cleanup after 5 minutes max
    setTimeout(() => {
      clearInterval(pollTimer);
      window.removeEventListener('message', handleMessage);
    }, 5 * 60 * 1000);
  }, [fetchStatus]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/openai/logout', { method: 'POST' });
    } catch {
      // Ignore errors — cookies may already be cleared
    }
    reset();
  }, [reset]);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Schedule token refresh when connected
  useEffect(() => {
    if (isConnected && expiresAt) {
      scheduleRefresh();
    }
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [isConnected, expiresAt, scheduleRefresh]);

  // Periodic status check
  useEffect(() => {
    const interval = setInterval(fetchStatus, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return {
    enabled,
    isConnected,
    isLoading,
    expiresAt,
    login,
    logout,
  };
}
