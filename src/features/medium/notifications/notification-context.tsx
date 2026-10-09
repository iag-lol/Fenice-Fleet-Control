'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { useAlertNotifications, type AlertNotificationsState } from './use-alert-notifications';
const Context = createContext<AlertNotificationsState | null>(null);
export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const state = useAlertNotifications();
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
export function useNotificationCenter(): AlertNotificationsState {
  const context = useContext(Context);
  if (!context) throw new Error('Falta el contexto de notificaciones.');
  return context;
}
