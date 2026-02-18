import { Building2, FileText, Receipt, DollarSign, TrendingUp, AlertCircle, Users, Send, CheckCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";

interface DashboardStats {
  activeContracts: number;
  totalProperties: number;
  openReceipts: number;
  paidReceipts: number;
  pendingPayments: number;
  pendingTransfers: number;
  monthlyRevenue: string;
  totalLandlords: number;
  totalTenants: number;
}

function StatCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  trend,
  variant = "default" 
}: { 
  title: string; 
  value: string | number; 
  description?: string; 
  icon: any;
  trend?: string;
  variant?: "default" | "warning" | "success";
}) {
  const bgColors = {
    default: "bg-primary/10 text-primary",
    warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`p-2 rounded-md ${bgColors[variant]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
        {trend && (
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="h-3 w-3 text-green-500" />
            <span className="text-xs text-green-500">{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-8 rounded-md" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-32 mt-2" />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const currentMonth = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do sistema - {currentMonth}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              title="Contratos Ativos"
              value={stats?.activeContracts || 0}
              description="Em vigor atualmente"
              icon={FileText}
              variant="success"
            />
            <StatCard
              title="Imóveis Cadastrados"
              value={stats?.totalProperties || 0}
              description={`${stats?.totalLandlords || 0} proprietários`}
              icon={Building2}
            />
            <StatCard
              title="Recibos do Mês"
              value={stats?.openReceipts || 0}
              description="Aguardando fechamento"
              icon={Receipt}
              variant={stats?.openReceipts && stats.openReceipts > 0 ? "warning" : "default"}
            />
            <StatCard
              title="Recibos Pagos"
              value={stats?.paidReceipts || 0}
              description="Pagos neste mês"
              icon={CheckCircle}
              variant="success"
            />
            <StatCard
              title="Repasses Pendentes"
              value={stats?.pendingTransfers || 0}
              description="Aguardando pagamento"
              icon={Send}
              variant={stats?.pendingTransfers && stats.pendingTransfers > 0 ? "warning" : "default"}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Resumo Financeiro
            </CardTitle>
            <CardDescription>Valores do mês atual</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-green-500/10">
                      <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Receita Estimada</p>
                      <p className="text-xs text-muted-foreground">Baseado nos recibos fechados</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-600 dark:text-green-400">
                      R$ {stats?.monthlyRevenue || "0,00"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-yellow-500/10">
                      <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Pagamentos Pendentes</p>
                      <p className="text-xs text-muted-foreground">Recibos não pagos</p>
                    </div>
                  </div>
                  <Badge variant="secondary">{stats?.pendingPayments || 0} recibos</Badge>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Cadastros
            </CardTitle>
            <CardDescription>Total de registros no sistema</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Building2 className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{stats?.totalProperties || 0}</p>
                    <p className="text-xs text-muted-foreground">Imóveis</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{stats?.totalLandlords || 0}</p>
                    <p className="text-xs text-muted-foreground">Proprietários</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{stats?.totalTenants || 0}</p>
                    <p className="text-xs text-muted-foreground">Locatários</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <div className="p-2 rounded-md bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{stats?.activeContracts || 0}</p>
                    <p className="text-xs text-muted-foreground">Contratos</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
