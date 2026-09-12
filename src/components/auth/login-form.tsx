'use client';

import { IdCard, LockKeyhole } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { LoginShowcase } from '@/components/auth/login-showcase';
import { BrandLockup } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isValidRut, normalizeRut } from '@/lib/rut';

/**
 * Evita que `?next=` se use para redirigir fuera del sitio (open redirect).
 * Solo se acepta una ruta interna que empiece por `/` y no sea protocolo
 * relativo (`//evil.com`) ni intente escapar con backslashes.
 */
function sanitizeNextPath(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeNextPath(searchParams.get('next'));

  const [rut, setRut] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!isValidRut(rut)) {
      setError('Ingresa un RUT valido, con su digito verificador.');
      return;
    }
    if (password.length === 0) {
      setError('Ingresa tu contrasena.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rut: normalizeRut(rut) ?? rut, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'No fue posible iniciar sesion.');
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError('No fue posible conectar con el servidor. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-app items-center justify-center overflow-hidden bg-surface-950 p-4 sm:p-6 lg:p-10">
      {/* Resplandor de fondo sutil: le da profundidad al blanco/gris plano
          sin competir con el contenido, visible incluso donde no llega el
          panel de marca (movil y tablet). */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-brand-300/20 blur-3xl"
        aria-hidden
      />

      <div className="relative flex w-full max-w-4xl animate-fade-in items-stretch gap-6">
        <LoginShowcase />

        <div className="flex w-full flex-col justify-center rounded-2xl border border-line bg-surface-900 p-6 shadow-panel animate-slide-up sm:p-9 lg:max-w-sm lg:shrink-0">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <BrandLockup />
          </div>

          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-ink">Iniciar sesion</h1>
            <p className="mt-1 text-[13px] text-ink-faint">
              Ingresa con tu RUT y contrasena de Fenice Fleet Control.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <label className="block">
              <span className="field-label">RUT</span>
              <Input
                autoFocus
                autoComplete="username"
                inputMode="text"
                placeholder="12345678-9"
                icon={<IdCard className="h-4 w-4" />}
                value={rut}
                onChange={(event) => setRut(event.target.value)}
                disabled={submitting}
              />
            </label>

            <label className="block">
              <span className="field-label">Contrasena</span>
              <Input
                type="password"
                autoComplete="current-password"
                icon={<LockKeyhole className="h-4 w-4" />}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </label>

            {error ? (
              <p role="alert" className="rounded-md bg-status-dormant/10 px-3 py-2 text-xs text-status-dormant">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="primary" size="lg" block loading={submitting} className="shadow-glow">
              Entrar
            </Button>
          </form>

          <p className="mt-6 text-center text-2xs text-ink-faint">
            ¿Problemas para ingresar? Contacta a tu administrador de flota.
          </p>
        </div>
      </div>
    </div>
  );
}
