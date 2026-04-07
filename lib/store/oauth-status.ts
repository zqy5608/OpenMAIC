/**
 * OAuth Connection Status Store
 *
 * Lightweight, non-persisted Zustand store for tracking
 * whether the user is connected via OpenAI OAuth.
 */

import { create } from 'zustand';

interface OAuthStatusState {
  /** Whether OAuth feature is enabled on the server */
  enabled: boolean;
  /** Whether the user is connected via OAuth */
  isConnected: boolean;
  /** Token expiry timestamp (ms since epoch) */
  expiresAt: number | null;
  /** Whether the status is being loaded */
  isLoading: boolean;

  setStatus: (status: { enabled: boolean; connected: boolean; expiresAt?: number }) => void;
  setLoading: (loading: boolean) => void;
  reset: () => void;
}

export const useOAuthStatusStore = create<OAuthStatusState>((set) => ({
  enabled: false,
  isConnected: false,
  expiresAt: null,
  isLoading: true,

  setStatus: (status) =>
    set({
      enabled: status.enabled,
      isConnected: status.connected,
      expiresAt: status.expiresAt ?? null,
      isLoading: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  reset: () =>
    set({
      isConnected: false,
      expiresAt: null,
      isLoading: false,
    }),
}));
