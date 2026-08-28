'use client';

import { create } from 'zustand';

/**
 * Apertura del menu movil.
 *
 * Vive fuera de los componentes porque hay DOS entradas al mismo menu: el
 * boton del encabezado y el boton "Mas" de la barra inferior. Con estado
 * local cada uno abriria su propia copia del panel.
 */
interface MobileMenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useMobileMenu = create<MobileMenuState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
