'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

export function WorkOrderDownload({ workOrderId, number, className, compact = false }: { workOrderId: string; number: string; className?: string; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/ordenes/${encodeURIComponent(workOrderId)}/documento`, { signal: AbortSignal.timeout(20000) });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'No se pudo descargar la OT. Intenta nuevamente.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${number.replace(/[^a-zA-Z0-9_-]/g, '_') || 'orden-de-trabajo'}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo descargar la OT.'); }
    finally { setLoading(false); }
  };
  return <div className={className}>
    <button type="button" disabled={loading} onClick={() => void download()} className={cn('flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60', compact && 'h-7 gap-1 rounded-md px-2 py-0 text-[10px]')}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {loading ? 'Preparando PDF…' : 'Descargar OT'}
    </button>
    {error ? <p role="alert" className="mt-2 text-xs text-red-700">{error}</p> : null}
  </div>;
}
