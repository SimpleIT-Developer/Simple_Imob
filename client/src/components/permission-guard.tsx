import { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";

export interface PermissionGuardProps {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGuard({ permission, children, fallback = null }: PermissionGuardProps) {
  const { user } = useAuth();

  if (!user) return null;

  // Admin tem acesso total
  const hasPermission = user.role === "admin" || (Array.isArray(user.permissions) && user.permissions.includes(permission));

  if (hasPermission) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
