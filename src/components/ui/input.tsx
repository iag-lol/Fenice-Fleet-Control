'use client';

import { Search, X } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-md border border-line-strong bg-surface-900 text-ink placeholder:text-ink-faint transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  onClear?: () => void;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, icon, onClear, value, ...props },
  ref,
) {
  const showClear = onClear && typeof value === 'string' && value.length > 0;

  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
          {icon}
        </span>
      ) : null}
      <input
        ref={ref}
        value={value}
        className={cn(
          fieldBase,
          'h-11 px-3 text-sm sm:h-9 sm:text-[13px]',
          icon && 'pl-9',
          showClear && 'pr-9',
          className,
        )}
        {...props}
      />
      {showClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpiar"
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-750 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
});

export const SearchInput = forwardRef<HTMLInputElement, InputProps>(function SearchInput(props, ref) {
  return <Input ref={ref} icon={<Search className="h-4 w-4" />} {...props} />;
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        fieldBase,
        'h-11 cursor-pointer appearance-none bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat px-3 pr-8 text-sm sm:h-9 sm:text-[13px]',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2393a4bd' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...props}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-surface-900">
          {option.label}
        </option>
      ))}
    </select>
  );
});

export interface NumberFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
  suffix?: string;
}

/** Campo numerico etiquetado usado en la configuracion operacional. */
export function NumberField({ label, hint, suffix, className, ...props }: NumberFieldProps) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <div className="relative">
        <input
          type="number"
          className={cn(fieldBase, 'h-11 px-3 text-sm numeric sm:h-9', suffix && 'pr-14', className)}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <span className="mt-1 block text-2xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export interface ToggleProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, hint, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-md border border-line bg-surface-900 p-3 text-left transition-colors hover:border-line-strong disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-2xs text-ink-faint">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'bg-brand-500' : 'bg-surface-700',
        )}
      >
        <span
          className={cn(
            'h-4 w-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
    </button>
  );
}
