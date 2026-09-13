import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpGpsProvider } from './http-gps-provider';

describe('GPS polling under slow network conditions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { removeEventListener: vi.fn() });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('never overlaps requests and resumes polling after a slow response', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const onPositions = vi.fn();
    const provider = new HttpGpsProvider({ preferredTransport: 'polling' });
    const stop = provider.subscribeToPositions({ onPositions });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(Response.json({ positions: [] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onPositions).toHaveBeenCalledWith([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
    resolve(Response.json({ positions: [] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onPositions).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight request on unsubscribe without reporting a GPS failure', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_path: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }));
    const onError = vi.fn();
    const stop = new HttpGpsProvider({ preferredTransport: 'polling' }).subscribeToPositions({
      onPositions: vi.fn(), onError,
    });
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal?.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries after a provider failure', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(Response.json({ positions: [] }));
    vi.stubGlobal('fetch', fetch);
    const onError = vi.fn();
    const onPositions = vi.fn();
    const stop = new HttpGpsProvider({ preferredTransport: 'polling' }).subscribeToPositions({ onError, onPositions });
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onPositions).toHaveBeenCalledWith([]);
    stop();
  });
});

class TestEventSource extends EventTarget {
  static CLOSED = 2;
  static instances: TestEventSource[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 2; });
  constructor(_url: string) { super(); TestEventSource.instances.push(this); }
  positions() { this.dispatchEvent(new MessageEvent('positions', { data: JSON.stringify({ positions: [] }) })); }
}

describe('SSE recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers(); TestEventSource.instances = [];
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('EventSource', TestEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ positions: [] })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('uses polling while SSE is CONNECTING and returns to SSE after valid data', async () => {
    const transport = vi.fn();
    const stop = new HttpGpsProvider().subscribeToPositions({ onPositions: vi.fn(), onTransportChange: transport });
    const stream = TestEventSource.instances[0]!;
    stream.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenLastCalledWith('polling');
    stream.positions();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenLastCalledWith('sse');
    stop(); expect(stream.close).toHaveBeenCalled();
  });
  it('detects a silent stream and reconnects after offline or page cache restoration', async () => {
    const stop = new HttpGpsProvider().subscribeToPositions({ onPositions: vi.fn() });
    await vi.advanceTimersByTimeAsync(35_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(TestEventSource.instances).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    await vi.advanceTimersByTimeAsync(0);
    expect(TestEventSource.instances).toHaveLength(3);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
