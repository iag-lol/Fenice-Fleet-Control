'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  subject?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** Confirmacion explicita para acciones destructivas e irreversibles. */
export function ConfirmDialog({
  open,
  title,
  description,
  subject,
  confirmLabel = 'Eliminar definitivamente',
  cancelLabel = 'Cancelar',
  loading = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [loading, onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar confirmacion"
        disabled={loading}
        onClick={onClose}
        className="absolute inset-0 bg-overlay/80 backdrop-blur-[2px]"
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="safe-bottom relative z-10 w-full rounded-t-2xl border border-line bg-surface-900 shadow-panel sm:max-w-md sm:rounded-xl"
      >
        <div className="flex items-start gap-3 border-b border-line px-4 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-status-dormant/10 text-status-dormant ring-1 ring-status-dormant/15">
            <AlertTriangle className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-base font-semibold tracking-tight text-ink">
              {title}
            </h2>
            <div id="confirm-dialog-description" className="mt-1 text-xs leading-relaxed text-ink-muted">
              {description}
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            disabled={loading}
            onClick={onClose}
            className="tap -mr-2 -mt-2 flex shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-800 hover:text-ink sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          {subject ? (
            <div className="rounded-lg border border-line bg-surface-800 px-3 py-2.5 text-[13px] font-medium text-ink">
              {subject}
            </div>
          ) : null}

          <p className="text-2xs leading-relaxed text-ink-faint">
            Esta acción no se puede deshacer.
          </p>

          {error ? (
            <p className="rounded-md border border-status-dormant/25 bg-status-dormant/5 px-3 py-2 text-xs text-status-dormant" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-line bg-surface-800/60 px-4 py-3 sm:flex sm:justify-end">
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
