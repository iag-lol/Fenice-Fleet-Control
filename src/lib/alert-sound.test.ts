import { afterEach, describe, expect, it, vi } from 'vitest';
import { playAlertSound } from './alert-sound';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('tono tras desbloqueo del audio', () => {
  it('espera a que resume termine antes de crear el sonido', async () => {
    const start = vi.fn(); const frequency = { value: 0 };
    const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    const context = { state: 'suspended', currentTime: 0, destination: {},
      resume: async () => { context.state = 'running'; },
      createGain: () => gain,
      createOscillator: () => ({ frequency, type: '', connect: () => gain, start, stop: vi.fn() }),
    };
    vi.stubGlobal('window', { AudioContext: class { constructor() { return context; } } });
    expect(await playAlertSound('critical')).toBe(true); expect(start).toHaveBeenCalledTimes(3);
  });
});
