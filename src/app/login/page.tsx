import { Suspense } from 'react';

import { LoginForm } from '@/components/auth/login-form';

export const metadata = {
  title: 'Iniciar sesion',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-app bg-surface-950" />}>
      <LoginForm />
    </Suspense>
  );
}
