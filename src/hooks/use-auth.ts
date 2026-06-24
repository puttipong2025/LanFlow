"use client";

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LAST_USER_KEY = "lanflow:last-auth-user";
export const OFFLINE_AUTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CachedProfile = {
  profile: Profile;
  validatedAt: string;
};

export type AuthMode = "online" | "offline" | "signed_out";

export type AuthState = {
  profile: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  mode: AuthMode;
  offlineUntil: string | null;
  login: (phone: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<boolean>;
};

function profileCacheKey(userId: string) {
  return `lanflow:auth-profile:${userId}`;
}

function readCachedProfile(): CachedProfile | null {
  if (typeof window === "undefined") return null;

  try {
    const userId = window.localStorage.getItem(LAST_USER_KEY);
    if (!userId) return null;
    const raw = window.localStorage.getItem(profileCacheKey(userId));
    return raw ? (JSON.parse(raw) as CachedProfile) : null;
  } catch {
    return null;
  }
}

function cacheProfile(profile: Profile, validatedAt = new Date().toISOString()) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(LAST_USER_KEY, profile.id);
  window.localStorage.setItem(
    profileCacheKey(profile.id),
    JSON.stringify({ profile, validatedAt } satisfies CachedProfile)
  );
}

function isOfflineCacheValid(cache: CachedProfile | null) {
  if (!cache) return false;
  const validatedAt = new Date(cache.validatedAt).getTime();
  return Number.isFinite(validatedAt) && Date.now() - validatedAt <= OFFLINE_AUTH_MAX_AGE_MS;
}

function offlineDeadline(cache: CachedProfile | null) {
  if (!cache) return null;
  const validatedAt = new Date(cache.validatedAt).getTime();
  if (!Number.isFinite(validatedAt)) return null;
  return new Date(validatedAt + OFFLINE_AUTH_MAX_AGE_MS).toISOString();
}

export function useAuth(): AuthState {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<AuthMode>("signed_out");
  const [offlineUntil, setOfflineUntil] = useState<string | null>(null);

  const applyOfflineCache = useCallback(() => {
    const cached = readCachedProfile();
    if (!isOfflineCacheValid(cached)) return false;

    setProfile(cached!.profile);
    setMode("offline");
    setOfflineUntil(offlineDeadline(cached));
    return true;
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin"
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setProfile(null);
          setMode("signed_out");
          setOfflineUntil(null);
        }
        return false;
      }

      const data = (await response.json()) as { profile: Profile };
      cacheProfile(data.profile);
      setProfile(data.profile);
      setMode("online");
      setOfflineUntil(null);
      return true;
    } catch {
      return applyOfflineCache();
    }
  }, [applyOfflineCache]);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    async function initialize() {
      if (!navigator.onLine) {
        if (active) {
          applyOfflineCache();
          setIsLoading(false);
        }
        return;
      }

      const refreshed = await refreshProfile();
      if (active) {
        if (!refreshed) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            setProfile(null);
            setMode("signed_out");
          }
        }
        setIsLoading(false);
      }
    }

    void initialize();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
        setMode("signed_out");
        setOfflineUntil(null);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void refreshProfile();
      }
    });

    const handleOnline = () => {
      void refreshProfile();
    };
    const handleOffline = () => {
      applyOfflineCache();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [applyOfflineCache, refreshProfile]);

  const login = useCallback(async (phone: string, password: string) => {
    try {
      const loginResponse = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ phone, password })
      });

      const loginData = await loginResponse.json();
      if (!loginResponse.ok) {
        return {
          success: false,
          error: loginData.error || "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง"
        };
      }

      const response = await fetch("/api/auth/me", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const data = await response.json();

      if (!response.ok) {
        const supabase = createSupabaseBrowserClient();
        await supabase.auth.signOut();
        return {
          success: false,
          error: data.error || "บัญชีไม่มีสิทธิ์เข้าใช้งาน"
        };
      }

      cacheProfile(data.profile);
      setProfile(data.profile);
      setMode("online");
      setOfflineUntil(null);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้"
      };
    }
  }, []);

  const logout = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setProfile(null);
    setMode("signed_out");
    setOfflineUntil(null);
    window.location.href = "/login";
  }, []);

  return {
    profile,
    isLoading,
    isAuthenticated: profile !== null && mode !== "signed_out",
    mode,
    offlineUntil,
    login,
    logout,
    refreshProfile
  };
}
