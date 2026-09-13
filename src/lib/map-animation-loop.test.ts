import { describe, expect, it, vi } from 'vitest';
import { startMapAnimationLoop } from './map-animation-loop';

function frames() {
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  return {
    request: (callback: FrameRequestCallback) => { pending.set(++id, callback); return id; },
    cancel: (frame: number) => { pending.delete(frame); },
    tick: (time: number) => {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(time));
    },
    pending,
  };
}

describe('map animation work budget', () => {
  it('draws a stationary fleet once and leaves no background frames', () => {
    const clock = frames();
    const draw = vi.fn(() => false);
    startMapAnimationLoop(draw, clock);
    for (let time = 0; time <= 10_000; time += 16) clock.tick(time);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(clock.pending.size).toBe(0);
  });

  it.each([60, 120, 144])('limits GeoJSON updates on a %i Hz screen and draws the final position', (hz) => {
    const clock = frames();
    const draw = vi.fn((time: number) => time < 1000);
    startMapAnimationLoop(draw, clock);
    for (let frame = 0; frame <= hz * 2; frame++) clock.tick(frame * 1000 / hz);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(32);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(25);
    expect(draw.mock.lastCall![0]).toBeGreaterThanOrEqual(1000);
    expect(clock.pending.size).toBe(0);
  });

  it('cancels on unmount and accepts a new position after becoming idle', () => {
    const clock = frames();
    const draw = vi.fn(() => true);
    const stop = startMapAnimationLoop(draw, clock);
    clock.tick(0);
    stop();
    clock.tick(100);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(clock.pending.size).toBe(0);
    startMapAnimationLoop(() => false, clock);
    clock.tick(200);
    expect(clock.pending.size).toBe(0);
  });
});
