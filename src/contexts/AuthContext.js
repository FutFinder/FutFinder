import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { isSessionUsable } from '../services/authPolicy';

/**
 * Fuente única de verdad de la sesión, usada por el guard de navegación
 * (`withAuthGuard`) y por pantallas que necesitan saber si hay sesión sin
 * volver a golpear la red (`supabase.auth.getUser()` puede fallar por
 * conexión, y eso no es lo mismo que "no hay sesión").
 *
 * Sin Supabase configurado no hay sesión posible, así que tampoco hay acceso:
 * `isAuthenticated` queda en false y las rutas privadas mandan a Login. Antes
 * este caso se trataba como "autenticado" para que la interfaz renderizara
 * con datos de muestra, y eso abría la app entera en cualquier build al que
 * le faltaran las variables de entorno.
 *
 * "Autenticado" exige una sesión usable: token, usuario y correo verificado
 * (ver `isSessionUsable` en services/authPolicy.js).
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

  const isAuthenticated = isSessionUsable(session);

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
