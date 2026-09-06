'use client';

import { LockKeyhole } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { BrandLockup } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
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
    <div className="flex min-h-app items-center justify-center bg-surface-950 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader
          title="Iniciar sesion"
          description="Fenice Fleet Control"
          icon={<LockKeyhole className="h-4 w-4" />}
        />
        <CardBody>
          <div className="mb-4 flex justify-center">
            <BrandLockup />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <label className="block">
              <span className="field-label">RUT</span>
              <Input
                autoFocus
                autoComplete="username"
                inputMode="text"
                placeholder="12345678-9"
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

            <Button type="submit" variant="primary" size="lg" block loading={submitting}>
              Entrar
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
