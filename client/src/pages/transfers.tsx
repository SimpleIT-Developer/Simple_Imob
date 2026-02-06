import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, Send, Loader2, Check, AlertCircle, Clock, Trash2, RotateCcw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { LandlordTransfer, Landlord, Receipt, Contract, Property } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  pending: { label: "Pendente", variant: "outline", icon: Clock },
  paid: { label: "Pago", variant: "default", icon: Check },
  failed: { label: "Falhou", variant: "destructive", icon: AlertCircle },
  reversed: { label: "Estornado", variant: "secondary", icon: RotateCcw },
};

export default function TransfersPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [transferToPay, setTransferToPay] = useState<LandlordTransfer | null>(null);
  const { toast } = useToast();

  const { data: transfers, isLoading } = useQuery<(LandlordTransfer & { propertyName?: string; refMonth?: number; refYear?: number })[]>({ queryKey: ["/api/transfers"] });
  const { data: landlords } = useQuery<Landlord[]>({ queryKey: ["/api/landlords"] });
  const { data: receipts } = useQuery<Receipt[]>({ queryKey: ["/api/receipts"] });
  const { data: contracts } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });

  const executeTransferMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/transfers/${id}/pix-execute`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ 
        title: "Pagamento Iniciado", 
        description: data.message || "Pagamento PIX realizado com sucesso.",
      });
      setTransferToPay(null);
    },
    onError: (error: any) => toast({ title: "Erro no Pagamento", description: error.message, variant: "destructive" }),
  });

  const manualTransferMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/transfers/${id}/manual`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Repasse manual registrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteTransferMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/transfers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Sucesso", description: "Repasse excluído com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const reverseTransferMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/transfers/${id}/reverse`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Sucesso", description: "Repasse estornado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const getLandlordInfo = (landlordId: string) => {
    const landlord = landlords?.find((l) => l.id === landlordId);
    return {
      name: landlord?.name || "-",
      pix: landlord?.pixKey ? `${landlord.pixKeyType}: ${landlord.pixKey}` : "Não cadastrado",
    };
  };

  const getReceiptInfo = (receiptId: string) => {
    const receipt = receipts?.find((r) => r.id === receiptId);
    if (!receipt) return { property: "-", ref: "-" };
    const contract = contracts?.find((c) => c.id === receipt.contractId);
    const property = properties?.find((p) => p.id === contract?.propertyId);
    return {
      property: property?.title || "-",
      ref: `${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}`,
    };
  };

  const filteredTransfers = transfers?.filter((t) => {
    const landlord = getLandlordInfo(t.landlordId);
    // Prefer enriched data from API, fallback to local lookup
    const propertyName = t.propertyName || getReceiptInfo(t.receiptId).property;
    
    return (
      landlord.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      propertyName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const pendingCount = transfers?.filter((t) => t.status === "pending").length || 0;
  const totalPending = transfers?.filter((t) => t.status === "pending").reduce((sum, t) => sum + Number(t.amount), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repasses para Proprietários</h1>
          <p className="text-muted-foreground">Gerencie os repasses via PIX</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Repasses Pendentes</CardTitle>
            <div className="p-2 rounded-md bg-yellow-500/10">
              <Clock className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">R$ {totalPending.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} a repassar</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total de Repasses</CardTitle>
            <div className="p-2 rounded-md bg-primary/10">
              <Send className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{transfers?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Repasses registrados</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5 text-primary" />
                Lista de Repasses
              </CardTitle>
              <CardDescription>{transfers?.length || 0} repasses registrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-transfers" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredTransfers && filteredTransfers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proprietário</TableHead>
                    <TableHead className="hidden md:table-cell">Imóvel</TableHead>
                    <TableHead>Referência</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead className="hidden lg:table-cell">Chave PIX</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransfers.map((transfer) => {
                    const landlord = getLandlordInfo(transfer.landlordId);
                    // Prefer enriched data from API, fallback to local lookup
                    const propertyName = transfer.propertyName || getReceiptInfo(transfer.receiptId).property;
                    const ref = (transfer.refMonth && transfer.refYear) 
                      ? `${String(transfer.refMonth).padStart(2, "0")}/${transfer.refYear}`
                      : getReceiptInfo(transfer.receiptId).ref;

                    const StatusIcon = statusLabels[transfer.status]?.icon || Clock;
                    return (
                      <TableRow key={transfer.id} data-testid={`row-transfer-${transfer.id}`}>
                        <TableCell className="font-medium">{landlord.name}</TableCell>
                        <TableCell className="hidden md:table-cell">{propertyName}</TableCell>
                        <TableCell>{ref}</TableCell>
                        <TableCell className="font-medium">R$ {Number(transfer.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{landlord.pix}</TableCell>
                        <TableCell>
                          <Badge variant={statusLabels[transfer.status]?.variant || "secondary"} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {statusLabels[transfer.status]?.label || transfer.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 items-center">
                            {transfer.status === "pending" && (
                              <>
                                <Button
                                size="sm"
                                onClick={() => setTransferToPay(transfer)}
                                disabled={executeTransferMutation.isPending || manualTransferMutation.isPending}
                                data-testid={`button-execute-transfer-${transfer.id}`}
                              >
                                {executeTransferMutation.isPending && transferToPay?.id === transfer.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Send className="mr-2 h-4 w-4" />
                                )}
                                Executar PIX
                              </Button>

                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => manualTransferMutation.mutate(transfer.id)}
                                  disabled={executeTransferMutation.isPending || manualTransferMutation.isPending}
                                  data-testid={`button-manual-transfer-${transfer.id}`}
                                >
                                  {manualTransferMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                                  Pagamento Manual
                                </Button>
                              </>
                            )}

                            {transfer.status === "paid" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (confirm("Tem certeza que deseja estornar este repasse? Isso irá reverter o status do recibo e criar uma entrada no caixa.")) {
                                    reverseTransferMutation.mutate(transfer.id);
                                  }
                                }}
                                disabled={reverseTransferMutation.isPending}
                                title="Estornar repasse"
                              >
                                {reverseTransferMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                Estornar
                              </Button>
                            )}
                            
                            {(transfer.status === "pending" || transfer.status === "failed") && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => {
                                  if (confirm("Tem certeza que deseja excluir este repasse?")) {
                                    deleteTransferMutation.mutate(transfer.id);
                                  }
                                }}
                                disabled={deleteTransferMutation.isPending}
                                title="Excluir repasse"
                              >
                                {deleteTransferMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                          {transfer.status === "failed" && transfer.errorMessage && (
                            <div className="text-xs text-destructive mt-1">{transfer.errorMessage}</div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Send className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum repasse encontrado</h3>
              <p className="text-sm text-muted-foreground">Os repasses são gerados a partir dos recibos pagos.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!transferToPay} onOpenChange={(open) => !open && setTransferToPay(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Pagamento PIX</AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <div className="space-y-1">
                <p>Você está prestes a realizar uma transferência PIX para:</p>
                <p className="font-bold text-foreground text-lg">
                  {transferToPay && getLandlordInfo(transferToPay.landlordId).name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Chave PIX: {transferToPay && getLandlordInfo(transferToPay.landlordId).pix}
                </p>
              </div>
              
              <div className="flex items-baseline gap-2">
                <span>Valor:</span>
                <span className="font-bold text-foreground text-xl">
                  {transferToPay && Number(transferToPay.amount).toLocaleString("pt-BR", { style: 'currency', currency: 'BRL' })}
                </span>
              </div>

              <div className="rounded-md bg-amber-500/10 p-3 text-amber-600 dark:text-amber-400 text-sm border border-amber-500/20">
                <div className="font-semibold flex items-center gap-2 mb-1">
                  <AlertCircle className="h-4 w-4" />
                  Atenção Financeira
                </div>
                Esta operação é irreversível. O dinheiro será debitado imediatamente da conta da imobiliária e transferido para a conta do proprietário.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={executeTransferMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (transferToPay) executeTransferMutation.mutate(transferToPay.id);
              }}
              disabled={executeTransferMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {executeTransferMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Confirmar Pagamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
