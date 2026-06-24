"use client";

import { useCallback, useEffect, useState } from "react";
import type { Profile } from "@/types";

const TOKEN_KEY = "lanflow:auth-token";
const PROFILE_KEY = "lanflow:auth-profile";

export type AuthState = {
  token: string | null;
  profile: Profile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  getToken: () => string | null;
};

function saveToken(token: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TOKEN_KEY, token);
    // Also set cookie for Next.js middleware (server-side route guard)
    document.cookie = `lanflow-token=${token}; path=/; max-age=${7 * 86400}; SameSite=Lax`;
  }
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

function clearToken() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(PROFILE_KEY);
    // Clear cookie
    document.cookie = "lanflow-token=; path=/; max-age=0";
  }
}

function saveProfileCache(profile: Profile) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }
}

function readProfileCache(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function useAuth(): AuthState {
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: read token from LocalStorage and verify
  useEffect(() => {
    const storedToken = readToken();
    const cachedProfile = readProfileCache();

    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    // Immediately set cached data for fast UI
    setToken(storedToken);
    if (cachedProfile) {
      setProfile(cachedProfile);
    }
    // Ensure cookie is synced (might be missing after browser restart)
    document.cookie = `lanflow-token=${storedToken}; path=/; max-age=${7 * 86400}; SameSite=Lax`;

    // Verify token with server (if online)
    if (navigator.onLine) {
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${storedToken}` },
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setProfile(data.profile);
            saveProfileCache(data.profile);

            // Try to refresh if token is getting old
            tryRefreshToken(storedToken);
          } else {
            // Token is invalid
            clearToken();
            setToken(null);
            setProfile(null);
          }
        })
        .catch(() => {
          // Network error — keep using cached data (PWA offline mode)
        })
        .finally(() => setIsLoading(false));
    } else {
      // Offline — trust cached data
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tryRefreshToken(currentToken: string) {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        saveToken(data.token);
      }
    } catch {
      // Ignore refresh failures
    }
  }

  const login = useCallback(async (phone: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || "เข้าสู่ระบบไม่สำเร็จ" };
      }

      setToken(data.token);
      setProfile(data.profile);
      saveToken(data.token);
      saveProfileCache(data.profile);

      return { success: true };
    } catch (error) {
      console.error("Login error", error);
      return { success: false, error: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้" };
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setToken(null);
    setProfile(null);
    // Redirect to login page
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
  }, []);

  const getToken = useCallback(() => {
    return readToken();
  }, []);

  return {
    token,
    profile,
    isLoading,
    isAuthenticated: !!token && !!profile,
    login,
    logout,
    getToken,
  };
}
