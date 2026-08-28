'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Nombre de la seccion, usado en el mensaje al operador. */
  section: string;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Limite de error por seccion.
 *
 * Deliberadamente granular: si falla el mapa, la ficha de un vehiculo o el
 * panel de alertas, el resto del centro de control sigue operativo. Un unico
 * boundary en la raiz convertiria cualquier fallo en una pantalla en blanco.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.section}]`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-lg border border-status-warning/25 bg-status-warning/5 p-6 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-status-warning/15 text-status-warning">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">
            No fue posible mostrar {this.props.section}.
          </p>
          <p className="max-w-md text-xs text-ink-faint">
            El resto de la plataforma sigue operativo. Puedes reintentar sin recargar la pagina.
          </p>
        </div>
        <Button size="sm" variant="secondary" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={this.reset}>
          Reintentar
        </Button>
      </div>
    );
  }
}
