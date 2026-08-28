'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import NextLink from 'next/link';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900 disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        // Sobre fondo claro el estado activo OSCURECE: aclarar al pasar el
        // cursor hundiria el contraste del texto blanco.
        primary: 'bg-brand-600 text-white shadow-card hover:bg-brand-700 active:bg-brand-800',
        secondary:
          'border border-line-strong bg-surface-900 text-ink shadow-card hover:bg-surface-800 hover:border-brand-500',
        ghost: 'text-ink-muted hover:bg-surface-800 hover:text-ink',
        outline: 'border border-line-strong text-ink-muted hover:text-ink hover:border-brand-500',
        danger: 'bg-status-dormant text-white shadow-card hover:bg-red-700',
        subtle: 'bg-surface-750 text-ink-muted hover:bg-surface-700 hover:text-ink',
      },
      size: {
        // 44 px de alto: objetivo tactil minimo en movil.
        md: 'h-11 px-4 text-sm sm:h-9 sm:text-[13px]',
        // En movil ningun boton baja del objetivo tactil de 44 px, ni
        // siquiera los secundarios: el dedo no distingue jerarquias.
        sm: 'h-11 px-3.5 text-sm sm:h-8 sm:px-3 sm:text-xs',
        lg: 'h-12 px-6 text-[15px]',
        icon: 'h-11 w-11 sm:h-9 sm:w-9',
        'icon-sm': 'h-11 w-11 sm:h-8 sm:w-8',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export { buttonVariants };

export interface LinkButtonProps extends VariantProps<typeof buttonVariants> {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  title?: string;
  target?: string;
  rel?: string;
}

/**
 * Enlace con apariencia de boton.
 *
 * Existe como componente propio en vez de `asChild` para que el elemento
 * renderizado sea siempre un `<a>` real: la navegacion debe funcionar con
 * clic medio, teclado y lectores de pantalla.
 */
export function LinkButton({
  href,
  children,
  icon,
  className,
  variant,
  size,
  block,
  ...props
}: LinkButtonProps) {
  return (
    <NextLink href={href} className={cn(buttonVariants({ variant, size, block }), className)} {...props}>
      {icon}
      {children}
    </NextLink>
  );
}
