import { Building2, Home, Users, UserCheck, Wrench, FileText, Receipt, DollarSign, Send, FileCheck, LogOut, ArrowUpDown, BarChart, ShieldCheck, Settings, ScrollText, TrendingUp, User, Shield } from "lucide-react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";

const menuItems = [
  { title: "Dashboard", url: "/", icon: Home, permission: "menu_dashboard" },
  { title: "Imóveis", url: "/properties", icon: Building2, permission: "menu_properties" },
  { title: "Proprietários", url: "/landlords", icon: Users, permission: "menu_landlords" },
  { title: "Locatários", url: "/tenants", icon: UserCheck, permission: "menu_tenants" },
  { title: "Fiadores", url: "/guarantors", icon: ShieldCheck, permission: "menu_guarantors" },
  { title: "Prestadores", url: "/providers", icon: Wrench, permission: "menu_providers" },
  { title: "Contratos", url: "/contracts", icon: FileText, permission: "menu_contracts" },
  { title: "Serviços", url: "/services", icon: Wrench, permission: "menu_services" },
];

const financialItems = [
  { title: "Recibos", url: "/receipts", icon: Receipt, permission: "menu_receipts" },
  { title: "Caixa", url: "/cash", icon: DollarSign, permission: "menu_cash" },
  { title: "Repasses", url: "/transfers", icon: Send, permission: "menu_transfers" },
  { title: "Notas Fiscais", url: "/invoices", icon: FileCheck, permission: "menu_invoices" },
  { title: "Ajustes", url: "/adjustments", icon: ArrowUpDown, permission: "menu_adjustments" },
  { title: "Config. NFS-e", url: "/nfse/config", icon: Settings, permission: "menu_settings" },
];

const reportItems = [
  { title: "Repasse", url: "/reports/landlord-transfers", icon: BarChart, permission: "menu_report_transfers" },
  { title: "Receita", url: "/reports/revenue", icon: TrendingUp, permission: "menu_report_revenue" },
  { title: "Seguro Fiança", url: "/reports/insurance", icon: ShieldCheck, permission: "menu_report_insurance" },
];

const systemItems = [
  { title: "Meu Perfil", url: "/profile", icon: User, permission: null },
  { title: "Logs do Sistema", url: "/system/logs", icon: ScrollText, permission: "menu_logs" },
  { title: "Gestão de Usuários", url: "/users", icon: Shield, permission: "menu_users" },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { logout, user } = useAuth();

  const hasPermission = (permission: string | null) => {
    if (!permission) return true;
    if (!user) return false;
    if (user.role === "admin") return true;
    return Array.isArray(user.permissions) && user.permissions.includes(permission);
  };

  const filterItems = (items: typeof menuItems) => {
    return items.filter(item => hasPermission(item.permission));
  };

  const filteredMenuItems = filterItems(menuItems);
  const filteredFinancialItems = filterItems(financialItems);
  const filteredReportItems = filterItems(reportItems);
  const filteredSystemItems = filterItems(systemItems);

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-sidebar-foreground">Imobiliária</span>
            <span className="text-xs text-sidebar-foreground/70">Simples</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {filteredMenuItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50">Menu Principal</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredMenuItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace("/", "") || "dashboard"}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {filteredFinancialItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50">Financeiro</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredFinancialItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace("/", "")}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {filteredReportItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50">Relatórios</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredReportItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace("/", "")}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {filteredSystemItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50">Sistema</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredSystemItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${item.url.replace("/", "")}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-sidebar-foreground">{user?.name || "Admin"}</span>
            <span className="text-xs text-sidebar-foreground/60">{user?.email}</span>
          </div>
          <SidebarMenuButton onClick={logout} className="w-auto p-2" data-testid="button-logout">
            <LogOut className="h-4 w-4" />
          </SidebarMenuButton>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
