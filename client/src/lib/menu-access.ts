import type { User } from "@shared/schema";

type MenuAccessItem = {
  url: string;
  permission: string | null;
  adminOnly?: boolean;
};

const orderedMenuAccessItems: MenuAccessItem[] = [
  { url: "/", permission: "menu_dashboard", adminOnly: true },
  { url: "/properties", permission: "menu_properties" },
  { url: "/landlords", permission: "menu_landlords" },
  { url: "/tenants", permission: "menu_tenants" },
  { url: "/guarantors", permission: "menu_guarantors" },
  { url: "/providers", permission: "menu_providers" },
  { url: "/contracts", permission: "menu_contracts" },
  { url: "/services", permission: "menu_services" },
  { url: "/receipts", permission: "menu_receipts" },
  { url: "/cash", permission: "menu_cash" },
  { url: "/transfers", permission: "menu_transfers" },
  { url: "/expenses", permission: "menu_expenses" },
  { url: "/invoices", permission: "menu_invoices" },
  { url: "/adjustments", permission: "menu_adjustments" },
  { url: "/nfse/config", permission: "menu_settings" },
  { url: "/accounting/export-nfse", permission: "menu_accounting_export_nfs" },
  { url: "/reports/landlord-transfers", permission: "menu_report_transfers" },
  { url: "/reports/revenue", permission: "menu_report_revenue" },
  { url: "/reports/insurance", permission: "menu_report_insurance" },
  { url: "/reports/invoices-issued", permission: "menu_report_invoices_issued" },
  { url: "/profile", permission: null },
  { url: "/system/audit", permission: "menu_audit" },
  { url: "/system/logs", permission: "menu_logs" },
  { url: "/users", permission: "menu_users" },
];

export function canAccessMenuItem(user: User | null | undefined, item: MenuAccessItem) {
  if (!user) return false;
  if (item.adminOnly) return user.role === "admin";
  if (!item.permission) return true;
  if (user.role === "admin") return true;
  return Array.isArray(user.permissions) && user.permissions.includes(item.permission);
}

export function getFirstAccessibleRoute(user: User | null | undefined) {
  if (!user) return "/login";
  const firstItem = orderedMenuAccessItems.find((item) => canAccessMenuItem(user, item));
  return firstItem?.url || "/profile";
}
