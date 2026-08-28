'use client';

import { Check, Copy, Link2, Loader2, X } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatSmartDateTime } from '@/lib/format';

/**
 * Emision del enlace de la jornada para el conductor.
 *
 * El enlace se genera aqui y se envia por el canal que ya usa la operacion
 * (WhatsApp, SMS, radio). No se guarda en pantalla ni se reutiliza entre
 * jornadas: cada emision produce uno nuevo, y el anterior se puede anular.
 */

interface IssuedLink {
  token: string;
  path: string;
  expiresAt: string;
}

export function DriverLinkAction({ routeId }: { routeId: string }) {
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const issue = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRevoked(false);
    try {
      const response = await fetch(`/api/rutas/${routeId}/enlace-conductor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'No fue posible generar el enlace.');
        return;
      }
      setIssued((await response.json()) as IssuedLink);
    } catch {
      setError('No fue posible generar el enlace.');
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  const revoke = useCallback(async () => {
    if (!issued) return;
    await fetch(
      `/api/rutas/${routeId}/enlace-conductor?token=${encodeURIComponent(issued.token)}`,
      { method: 'DELETE' },
    );
    setRevoked(true);
  }, [issued, routeId]);

  const absoluteUrl = issued
    ? `${typeof window === 'undefined' ? '' : window.location.origin}${issued.path}`
    : '';

  const copy = useCallback(async () => {
    if (!absoluteUrl) return;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin permiso de portapapeles el conductor puede seleccionar el texto:
      // el campo se muestra completo justamente por eso.
      setError('Copia el enlace manualmente desde el campo.');
    }
  }, [absoluteUrl]);

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        icon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
        onClick={() => void issue()}
        disabled={loading}
      >
        {issued ? 'Generar enlace nuevo' : 'Enlace para el conductor'}
      </Button>

      {error ? <p className="text-xs text-status-dormant">{error}</p> : null}

      {issued ? (
        <div className="w-full max-w-md rounded-lg border border-line bg-surface-900 p-3 shadow-card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Enviar al conductor
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              readOnly
              value={absoluteUrl}
              onFocus={(event) => event.currentTarget.select()}
              className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface-800 px-2 text-xs text-ink-muted"
            />
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Copiar enlace"
              onClick={() => void copy()}
            >
              {copied ? <Check className="h-4 w-4 text-status-active" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Da acceso solo a esta ruta y caduca el {formatSmartDateTime(issued.expiresAt)}.
            Quien tenga el enlace puede cerrar las paradas: envialo solo al conductor asignado.
          </p>
          <button
            type="button"
            onClick={() => void revoke()}
            disabled={revoked}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-status-dormant disabled:text-ink-faint"
          >
            <X className="h-3 w-3" />
            {revoked ? 'Enlace anulado' : 'Anular este enlace'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
