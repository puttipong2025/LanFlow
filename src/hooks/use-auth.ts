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

export function clearOfflineAuthCache() {
  if (typeof window === "undefined") return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('lanflow_bootstrap_cache:') || key.startsWith('lanflow:auth-profile:'))) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem(LAST_USER_KEY);
  } catch { /* skip */ }
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

export function useAuth(initialProfile: Profile | null = null): AuthState {
  // Check if we are hydrating from stale PWA HTML
  const isBrowser = typeof window !== "undefined";
  const initProf = (() => {
    if (isBrowser && initialProfile) {
      const lastUser = window.localStorage.getItem(LAST_USER_KEY);
      if (!lastUser || lastUser !== initialProfile.id) return null;
      // Offline: don't trust initialProfile — let applyOfflineCache() validate expiry
      if (!navigator.onLine) return null;
    }
    return initialProfile;
  })();

  const [profile, setProfile] = useState<Profile | null>(initProf);
  const [isLoading, setIsLoading] = useState(initProf === null);
  const [mode, setMode] = useState<AuthMode>(initProf ? "online" : "signed_out");
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
          clearOfflineAuthCache();
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

  // Refresh profile and sign out if it fails — enforces source-of-truth contract:
  // only /api/auth/me 200 or valid offline cache may keep user authenticated
  const refreshOrSignOut = useCallback(async () => {
    const ok = await refreshProfile();
    if (!ok) {
      clearOfflineAuthCache();
      setProfile(null);
      setMode("signed_out");
      setOfflineUntil(null);
    }
  }, [refreshProfile]);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    async function initialize() {
      const lastUser = window.localStorage.getItem(LAST_USER_KEY);

      if (initialProfile && (!lastUser || lastUser !== initialProfile.id)) {
        // Stale HTML served from PWA cache after logout, OR cross-user mismatch
        if (active) {
          setProfile(null);
          setMode("signed_out");
        }
      }

      if (!navigator.onLine) {
        if (active) {
          const restored = applyOfflineCache();
          if (!restored) {
            // No valid offline cache — stale initialProfile must not survive
            clearOfflineAuthCache();
            setProfile(null);
            setMode("signed_out");
            setOfflineUntil(null);
          }
          setIsLoading(false);
        }
        return;
      }

      // Always revalidate when online — initialProfile may be stale PWA cache
      const refreshed = await refreshProfile();
      if (active) {
        if (!refreshed) {
          // Neither /api/auth/me nor offline cache succeeded — sign out
          clearOfflineAuthCache();
          setProfile(null);
          setMode("signed_out");
          setOfflineUntil(null);
        }
        setIsLoading(false);
      }
    }

    void initialize();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearOfflineAuthCache();
        setProfile(null);
        setMode("signed_out");
        setOfflineUntil(null);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void refreshOrSignOut();
      }
    });

    const handleOnline = () => {
      void refreshOrSignOut();
    };
    const handleOffline = () => {
      const restored = applyOfflineCache();
      if (!restored) {
        clearOfflineAuthCache();
        setProfile(null);
        setMode("signed_out");
        setOfflineUntil(null);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [applyOfflineCache, initialProfile, refreshProfile, refreshOrSignOut]);

  const login = useCallback(async (rawPhone: string, password: string) => {
    try {
      const supabase = createSupabaseBrowserClient();
      
      const phoneStr = rawPhone.replace(/\D/g, '');
      const phoneE164 = phoneStr.startsWith('0') 
        ? '+66' + phoneStr.slice(1) 
        : (phoneStr.startsWith('66') ? '+' + phoneStr : (phoneStr.startsWith('+') ? phoneStr : '+' + phoneStr));

      const { error: authError } = await supabase.auth.signInWithPassword({
        phone: phoneE164,
        password,
      });

      if (authError) {
        return {
          success: false,
          error: authError.message.includes("Invalid login") ? "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง" : authError.message
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
    clearOfflineAuthCache();

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
