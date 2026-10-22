import { LoaderCircle } from "lucide-react";

export function LoadingIcon({ className = "size-4" }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`shrink-0 animate-spin ${className}`}
    />
  );
}
