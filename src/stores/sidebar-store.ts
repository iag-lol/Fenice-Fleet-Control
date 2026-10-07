'use client';

import { create } from 'zustand';

const STORAGE_KEY = 'fenice.sidebar.collapsed';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
interface SidebarState {
  collapsedPreference: boolean;
  hydrated: boolean;
  hydratePreference: () => void;
  togglePreference: () => void;
}

const browserStorage = (): PreferenceStorage | null =>
  typeof window === 'undefined' ? null : window.localStorage;

/** Una sola preferencia por sesión del navegador, compartida por todas las páginas. */
export function createSidebarStore(
  getStorage: () => PreferenceStorage | null = browserStorage,
) {
  return create<SidebarState>((set, get) => ({
    collapsedPreference: false,
    hydrated: false,
    hydratePreference: () => {
      if (get().hydrated) return;
      let collapsedPreference = false;
      try {
        collapsedPreference = getStorage()?.getItem(STORAGE_KEY) === '1';
      } catch {
        /* El menú también funciona con almacenamiento bloqueado. */
      }
      set({ collapsedPreference, hydrated: true });
    },
    togglePreference: () => {
      get().hydratePreference();
      const collapsedPreference = !get().collapsedPreference;
      try {
        getStorage()?.setItem(STORAGE_KEY, collapsedPreference ? '1' : '0');
      } catch {
        /* La preferencia sigue viva durante la navegación. */
      }
      set({ collapsedPreference });
    },
  }));
}

export const useSidebarStore = createSidebarStore();
