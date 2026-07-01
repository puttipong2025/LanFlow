"use client";

import { createContext, useContext } from "react";
import { useAuth, type AuthState } from "@/hooks/use-auth";

const AuthContext = createContext<AuthState | null>(null);

import type { Profile } from "@/types";

export function AuthProvider({ 
  children, 
  initialProfile = null 
}: { 
  children: React.ReactNode;
  initialProfile?: Profile | null;
}) {
  const auth = useAuth(initialProfile);
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}
