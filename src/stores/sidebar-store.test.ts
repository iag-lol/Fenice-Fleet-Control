import { describe, expect, it, vi } from 'vitest';
import { createSidebarStore } from './sidebar-store';

describe('preferencia de la barra lateral durante navegación', () => {
  it('restaura una vez y mantiene el menú contraído al montar otras páginas', () => {
    const storage = { getItem: vi.fn(() => '1'), setItem: vi.fn() };
    const store = createSidebarStore(() => storage);
    store.getState().hydratePreference();
    const changes: boolean[] = [];
    const unsubscribe = store.subscribe((state) =>
      changes.push(state.collapsedPreference),
    );
    store.getState().hydratePreference();
    store.getState().hydratePreference();
    expect(store.getState()).toMatchObject({
      collapsedPreference: true,
      hydrated: true,
    });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
    unsubscribe();
  });
  it('solo el control de apertura cambia y persiste la preferencia', () => {
    let value = '1';
    const store = createSidebarStore(() => ({
      getItem: () => value,
      setItem: (_key, next) => {
        value = next;
      },
    }));
    store.getState().hydratePreference();
    store.getState().togglePreference();
    expect(store.getState().collapsedPreference).toBe(false);
    expect(value).toBe('0');
    store.getState().hydratePreference();
    expect(store.getState().collapsedPreference).toBe(false);
    store.getState().togglePreference();
    expect(store.getState().collapsedPreference).toBe(true);
    expect(value).toBe('1');
  });
  it('mantiene la selección en memoria si localStorage está bloqueado', () => {
    const store = createSidebarStore(() => {
      throw new Error('Storage disabled');
    });
    store.getState().hydratePreference();
    store.getState().togglePreference();
    store.getState().hydratePreference();
    expect(store.getState()).toMatchObject({
      hydrated: true,
      collapsedPreference: true,
    });
  });
  it('no lee almacenamiento ni preferencias de cliente al construir el estado del servidor', () => {
    const getStorage = vi.fn(() => null);
    const store = createSidebarStore(getStorage);
    expect(store.getInitialState()).toMatchObject({
      hydrated: false,
      collapsedPreference: false,
    });
    expect(getStorage).not.toHaveBeenCalled();
  });
});
