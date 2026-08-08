import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';

/**
 * Fuente única de verdad de la sesión, usada por el guard de navegación
 * (`withAuthGuard`) y por pantallas que necesitan saber si hay sesión sin
 * volver a golpear la red (`supabase.auth.getUser()` puede fallar por
 * conexión, y eso no es lo mismo que "no hay sesión").
 *
 * En modo demo (sin Supabase configurado) no existe concepto de sesión real:
 * el resto de la app ya está diseñado para funcionar con datos de muestra,
 * así que acá se trata como "autenticado" para no romper ese flujo.
 */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [isReady, setIsReady] = useState(!isSupabaseConfigured);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data?.session ?? null);
      setIsReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession ?? null);
      setIsReady(true);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const setPendingDestination = (destination) => {
    pendingRef.current = destination;
  };

  const consumePendingDestination = () => {
    const destination = pendingRef.current;
    pendingRef.current = null;
    return destination;
  };

  const isAuthenticated = !isSupabaseConfigured || !!session;

  const value = {
    session,
    user: session?.user ?? null,
    isReady,
    isAuthenticated,
    setPendingDestination,
    consumePendingDestination,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  }
  return ctx;
}
