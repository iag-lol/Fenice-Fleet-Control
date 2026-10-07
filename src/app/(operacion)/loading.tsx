import { Skeleton } from '@/components/ui/skeleton';

export default function OperationalLoading() {
  return (
    <div className="space-y-4 p-4" role="status" aria-label="Cargando sección">
      <Skeleton className="h-8 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
