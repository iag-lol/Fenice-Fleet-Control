'use client';
import { Bell, CheckCircle2, Smartphone, Volume2, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotificationCenter } from './notification-context';
import type { AlertSeverity } from '@/types/core';
export function NotificationSettings() {
  const state = useNotificationCenter();
  return (
    <section id="notificaciones" aria-label="Notificaciones de este equipo" className="mb-4 scroll-mt-20 rounded-xl border border-line-strong bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Bell className="h-4 w-4 text-brand-700" /> Notificaciones de este equipo</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-muted">Recibe las alertas en el centro de notificaciones, aunque Fenice esté en segundo plano o cerrada. Se desactivan al cerrar sesión o cuando la sesión vence.</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-2xs font-semibold ${state.pushActive ? 'bg-green-50 text-green-800' : 'bg-surface-750 text-ink-muted'}`}>
          {state.pushActive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          {state.pushActive ? 'Sistema activo' : 'Sistema sin activar'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state.pushActive ? <Button size="sm" onClick={() => state.setPreferences({ desktop: false })} disabled={state.busy}>Desactivar en este equipo</Button>
          : <Button size="sm" variant="primary" icon={<Bell className="h-3.5 w-3.5" />} onClick={() => void state.requestPermission()} loading={state.busy}>Activar notificaciones</Button>}
        <Button size="sm" onClick={() => void state.sendTest()} disabled={!state.pushActive || state.busy}>Enviar prueba al sistema</Button>
        <Button size="sm" icon={<Volume2 className="h-3.5 w-3.5" />} onClick={() => void state.testSound()}>Probar tono de Fenice</Button>
        <span className="inline-flex items-center gap-1.5 text-2xs text-ink-muted"><Wifi className="h-3.5 w-3.5" />{state.connected ? 'Alertas en vivo' : 'Reconectando alertas'}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-ink">
        <label className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={state.preferences.sound} onChange={e => state.setPreferences({ sound: e.target.checked })} className="h-4 w-4 accent-brand-600" />Sonido de avisos</label>
        <label className="inline-flex min-h-9 items-center gap-2"><input type="checkbox" checked={state.preferences.preview} onChange={e => state.setPreferences({ preview: e.target.checked })} className="h-4 w-4 accent-brand-600" />Mostrar detalle en la notificación</label>
        <label className="inline-flex items-center gap-2">Avisarme de<select aria-label="Gravedad mínima para notificaciones" value={state.preferences.minSeverity} onChange={e => state.setPreferences({ minSeverity: e.target.value as AlertSeverity })} className="h-9 rounded-md border border-line-strong bg-white px-2"><option value="info">Todas las alertas</option><option value="warning">Advertencias y críticas</option><option value="critical">Solo críticas</option></select></label>
      </div>
      <p className="mt-2 text-2xs leading-5 text-ink-muted">El detalle puede verse en la pantalla bloqueada. Los avisos del sistema usan el tono predeterminado del equipo y respetan silencio, volumen y concentración; el tono de Fenice funciona con la aplicación abierta.</p>
      {state.installRequired ? <p className="mt-2 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs leading-5 text-brand-900"><Smartphone className="mt-0.5 h-4 w-4 shrink-0" />En iPhone o iPad: abre Fenice en Safari, usa Compartir → Añadir a pantalla de inicio y abre la aplicación instalada para activar las notificaciones.</p> : null}
      {state.permission === 'denied' ? <p className="mt-2 text-xs text-amber-900">Los avisos están bloqueados. Permite las notificaciones de Fenice en los ajustes del navegador y del sistema.</p> : null}
      {state.error ? <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950">{state.error}</p> : null}
      {state.feedback ? <p role="status" className="mt-2 rounded-lg border border-brand-200 bg-brand-50 p-2.5 text-xs text-brand-900">{state.feedback}</p> : null}
    </section>
  );
}
