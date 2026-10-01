import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider } from "@/hooks/use-auth";
import { Switch, Route } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { SidebarProvider } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Properties from "@/pages/properties";
import Tenants from "@/pages/tenants";
import Guarantors from "@/pages/guarantors";
import Owners from "@/pages/landlords";
import Contracts from "@/pages/contracts";
import Maintenance from "@/pages/services";
import Providers from "@/pages/providers";
import Receipts from "@/pages/receipts";
import Cash from "@/pages/cash";
import Transfers from "@/pages/transfers";
import Invoices from "@/pages/invoices";
import Expenses from "@/pages/expenses";
import Adjustments from "@/pages/adjustments";
import AccountingExportNfsePage from "@/pages/accounting-export-nfse";
import NfseConfigPage from "@/pages/nfse-config";
import LandlordTransfersReportPage from "@/pages/reports/landlord-transfers";
import RevenueReportPage from "@/pages/reports/revenue";
import InsuranceReportPage from "@/pages/reports/insurance";
import IssuedInvoicesReportPage from "@/pages/reports/invoices-issued";
import DimobReportPage from "@/pages/reports/dimob";
import SystemLogsPage from "@/pages/system-logs";
import AuditLogsPage from "@/pages/audit-logs";
import UsersPage from "@/pages/users";
import ProfilePage from "@/pages/profile";
import PrintReceiptPage from "@/pages/print-receipt";
import { AppSidebar } from "@/components/app-sidebar";
import { getFirstAccessibleRoute } from "@/lib/menu-access";
import { useEffect } from "react";
import { useLocation } from "wouter";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <Component />
        </main>
      </div>
    </SidebarProvider>
  );
}

function PrintRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return <Component />;
}

function PublicPrintReceiptRoute() {
  return <PrintReceiptPage publicMode />;
}

function HomeRoute() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const targetRoute = getFirstAccessibleRoute(user);

  useEffect(() => {
    if (!isLoading && user && targetRoute !== "/") {
      navigate(targetRoute, { replace: true });
    }
  }, [isLoading, navigate, targetRoute, user]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  if (targetRoute === "/") {
    return <ProtectedRoute component={Dashboard} />;
  }

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={AuthPage} />
      <Route path="/" component={HomeRoute} />
      <Route path="/properties" component={() => <ProtectedRoute component={Properties} />} />
      <Route path="/tenants" component={() => <ProtectedRoute component={Tenants} />} />
      <Route path="/guarantors" component={() => <ProtectedRoute component={Guarantors} />} />
      <Route path="/landlords" component={() => <ProtectedRoute component={Owners} />} />
      <Route path="/contracts" component={() => <ProtectedRoute component={Contracts} />} />
      <Route path="/services" component={() => <ProtectedRoute component={Maintenance} />} />
      <Route path="/providers" component={() => <ProtectedRoute component={Providers} />} />
      <Route path="/receipts" component={() => <ProtectedRoute component={Receipts} />} />
      <Route path="/receipts/:id/print" component={() => <PrintRoute component={PrintReceiptPage} />} />
      <Route path="/public/receipts/:id/print" component={PublicPrintReceiptRoute} />
      <Route path="/cash" component={() => <ProtectedRoute component={Cash} />} />
      <Route path="/transfers" component={() => <ProtectedRoute component={Transfers} />} />
      <Route path="/invoices" component={() => <ProtectedRoute component={Invoices} />} />
      <Route path="/expenses" component={() => <ProtectedRoute component={Expenses} />} />
      <Route path="/adjustments" component={() => <ProtectedRoute component={Adjustments} />} />
      <Route path="/accounting/export-nfse" component={() => <ProtectedRoute component={AccountingExportNfsePage} />} />
      <Route path="/nfse/config" component={() => <ProtectedRoute component={NfseConfigPage} />} />
      <Route path="/system/audit" component={() => <ProtectedRoute component={AuditLogsPage} />} />
      <Route path="/system/logs" component={() => <ProtectedRoute component={SystemLogsPage} />} />
      <Route path="/users" component={() => <ProtectedRoute component={UsersPage} />} />
      <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
      <Route path="/reports/landlord-transfers" component={() => <ProtectedRoute component={LandlordTransfersReportPage} />} />
      <Route path="/reports/revenue" component={() => <ProtectedRoute component={RevenueReportPage} />} />
      <Route path="/reports/insurance" component={() => <ProtectedRoute component={InsuranceReportPage} />} />
      <Route path="/reports/invoices-issued" component={() => <ProtectedRoute component={IssuedInvoicesReportPage} />} />
      <Route path="/reports/dimob" component={() => <ProtectedRoute component={DimobReportPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default AppRoot;
