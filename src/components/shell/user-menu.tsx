'use client';

import { useQuery } from '@tanstack/react-query';
import { LogOut, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

interface MeResponse {
  authenticated: boolean;
  openAccess: boolean;
  displayName: string | null;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  administrador: 'Administrador',
  supervisor: 'Supervisor',
  operador: 'Operador',
  invitado: 'Invitado',
};

/** Identidad de la sesion actual y salida. Inerte (no se muestra) en modo abierto. */
export function UserMenu() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const { data } = useQuery({
    queryKey: ['auth', 'me'],
    staleTime: 60_000,
    queryFn: async (): Promise<MeResponse> => {
      const response = await fetch('/api/auth/me');
      if (!response.ok) throw new Error('Sesion no disponible');
      return (await response.json()) as MeResponse;
    },
  });

  if (!data || data.openAccess || !data.authenticated) return null;

  async function handleLogout() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden items-center gap-1.5 text-xs text-ink-muted lg:flex">
        <User className="h-3.5 w-3.5" aria-hidden />
        <span className="max-w-[140px] truncate">{data.displayName ?? 'Sesion activa'}</span>
        <span className="text-ink-faint">· {ROLE_LABEL[data.role] ?? data.role}</span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Cerrar sesion"
        aria-label="Cerrar sesion"
        onClick={handleLogout}
        loading={signingOut}
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
