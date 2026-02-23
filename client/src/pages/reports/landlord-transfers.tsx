import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, FileDown, Calendar, Building2, User, Printer, CheckCircle2, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PermissionGuard } from "@/components/permission-guard";
import type { LandlordTransfer, Landlord, Receipt, Contract, Property } from "@shared/schema";

const months = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" }, { value: "3", label: "Março" },
  { value: "4", label: "Abril" }, { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" }, { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" }, { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "outline" },
  paid: { label: "Pago", variant: "default" },
  failed: { label: "Falhou", variant: "destructive" },
  reversed: { label: "Estornado", variant: "secondary" },
};

export default function LandlordTransfersReportPage() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(currentMonth);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"ref" | "paid">("ref");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(currentYear, currentMonth - 1, 1);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(currentYear, currentMonth, 0);
    return d.toISOString().split("T")[0];
  });
  const [filterLandlordId, setFilterLandlordId] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { toast } = useToast();

  // Queries
  const { data: transfers, isLoading: isLoadingTransfers } = useQuery<LandlordTransfer[]>({
    queryKey: ["/api/reports/landlord-transfers", filterType, filterYear, filterMonth, startDate, endDate, filterLandlordId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("type", filterType);
      if (filterType === "ref") {
        params.set("year", String(filterYear));
        params.set("month", String(filterMonth));
      } else {
        params.set("start", startDate);
        params.set("end", endDate);
        if (filterLandlordId !== "all") params.set("landlordId", filterLandlordId);
      }
      const res = await fetch(`/api/reports/landlord-transfers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    }
  });

  const { data: landlords } = useQuery<Landlord[]>({ queryKey: ["/api/landlords"] });
  const { data: contracts } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: receipts } = useQuery<Receipt[]>({ 
    queryKey: ["/api/receipts", filterYear, filterMonth],
    queryFn: async () => {
      const res = await fetch(`/api/receipts?year=${filterYear}&month=${filterMonth}`);
      if (!res.ok) throw new Error("Failed to fetch receipts");
      return res.json();
    }
  });

  const isLoading = isLoadingTransfers || !landlords || !contracts || !properties || !receipts;

  const bulkManualPaymentMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/transfers/bulk-manual", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/landlord-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ 
        title: "Sucesso", 
        description: `${data.success} repasses pagos manualmente. ${data.errors > 0 ? `${data.errors} erros.` : ''}` 
      });
      setSelectedIds([]);
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("DELETE", "/api/transfers/bulk-delete", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports/landlord-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ 
        title: "Sucesso", 
        description: `${data.success} repasses excluídos. ${data.errors > 0 ? `${data.errors} erros.` : ''}` 
      });
      setSelectedIds([]);
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  // Helpers
  const getLandlordInfo = (landlordId: string) => landlords?.find(l => l.id === landlordId);
  const getReceiptInfo = (receiptId: string) => receipts?.find(r => r.id === receiptId);
  const getPropertyInfo = (contractId: string) => {
    const contract = contracts?.find(c => c.id === contractId);
    return properties?.find(p => p.id === contract?.propertyId);
  };

  // Filter logic
  const filteredTransfers = transfers?.filter(t => {
    const landlord = getLandlordInfo(t.landlordId);
    const receipt = getReceiptInfo(t.receiptId);
    const property = receipt ? getPropertyInfo(receipt.contractId) : undefined;
    
    const search = searchTerm.toLowerCase();
    const landlordName = landlord?.name?.toLowerCase() || "";
    const propertyTitle = property?.title?.toLowerCase() || "";
    
    return landlordName.includes(search) || propertyTitle.includes(search);
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (!filteredTransfers) return;
    // Only select pending or failed transfers
    const selectableTransfers = filteredTransfers.filter(t => t.status === 'pending' || t.status === 'failed');
    
    const allSelected = selectableTransfers.every(t => selectedIds.includes(t.id));
    
    if (allSelected) {
      // Unselect all currently visible
      const visibleIds = selectableTransfers.map(t => t.id);
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      // Select all selectable
      const newIds = selectableTransfers.map(t => t.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...newIds])));
    }
  };

  const totalAmount = filteredTransfers?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;
  const totalPending = filteredTransfers?.filter(t => t.status === 'pending').reduce((sum, t) => sum + Number(t.amount), 0) || 0;
  const totalPaid = filteredTransfers?.filter(t => t.status === 'paid').reduce((sum, t) => sum + Number(t.amount), 0) || 0;

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
            @page { margin: 1cm; size: landscape; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
            
            /* Esconder elementos padrão da interface e Sidebar do Shadcn */
            aside, nav, header, .sidebar, .print\\:hidden,
            div[data-slot="sidebar"],
            div[data-slot="sidebar-container"],
            div[data-slot="sidebar-gap"] { 
              display: none !important; 
            }

            /* Garantir que o container principal ocupe tudo e sobreponha qualquer layout flex */
            main { 
              padding: 0 !important; 
              margin: 0 !important; 
              overflow: visible !important; 
              width: 100vw !important; 
              max-width: 100vw !important;
              position: absolute !important;
              top: 0 !important;
              left: 0 !important;
              background: white !important;
              z-index: 9999 !important;
              border: none !important;
            }

            /* Resetar cores e sombras para impressão limpa */
            * { box-shadow: none !important; }
          }
      `}</style>

      {/* --- MODO TELA --- */}
      <div className="space-y-6 print:hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Relatório de Repasses</h1>
            <p className="text-muted-foreground">Repasses por mês de referência do recibo</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <FileDown className="mr-2 h-4 w-4" />
              Gerar PDF
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Filtros
              </CardTitle>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={filterType} onValueChange={(v) => setFilterType(v as "ref" | "paid")}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ref">Por Mês de Referência</SelectItem>
                    <SelectItem value="paid">Por Data de Pagamento</SelectItem>
                  </SelectContent>
                </Select>

                {filterType === "ref" ? (
                  <div className="flex gap-2">
                    <Select value={String(filterMonth)} onValueChange={(v) => setFilterMonth(parseInt(v))}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {months.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input 
                      type="number" 
                      className="w-24" 
                      value={filterYear} 
                      onChange={(e) => setFilterYear(parseInt(e.target.value))} 
                    />
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input type="date" className="w-[160px]" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    <Input type="date" className="w-[160px]" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    <Select value={filterLandlordId} onValueChange={(v) => setFilterLandlordId(v)}>
                      <SelectTrigger className="w-[260px]">
                        <SelectValue placeholder="Proprietário (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os proprietários</SelectItem>
                        {landlords?.map(l => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por proprietário ou imóvel..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : filteredTransfers && filteredTransfers.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">
                          <Checkbox 
                            checked={
                              filteredTransfers && 
                              filteredTransfers.some(t => t.status === 'pending' || t.status === 'failed') &&
                              filteredTransfers
                                .filter(t => t.status === 'pending' || t.status === 'failed')
                                .every(t => selectedIds.includes(t.id))
                            }
                            onCheckedChange={toggleAll}
                            aria-label="Selecionar todos"
                          />
                        </TableHead>
                        <TableHead>Proprietário</TableHead>
                        <TableHead>Imóvel</TableHead>
                        <TableHead>Ref. Recibo</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Data Pagamento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredTransfers.map((transfer) => {
                        const landlord = getLandlordInfo(transfer.landlordId);
                        const receipt = getReceiptInfo(transfer.receiptId);
                        const property = receipt ? getPropertyInfo(receipt.contractId) : undefined;
                        const isSelectable = transfer.status === 'pending' || transfer.status === 'failed';
                        
                        return (
                          <TableRow key={transfer.id}>
                            <TableCell className="w-[50px]">
                              <Checkbox 
                                checked={selectedIds.includes(transfer.id)}
                                onCheckedChange={() => toggleSelection(transfer.id)}
                                disabled={!isSelectable}
                                aria-label={`Selecionar repasse ${transfer.id}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <User className="h-4 w-4 text-muted-foreground" />
                                {landlord?.name || "-"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                                {property?.title || "-"}
                              </div>
                            </TableCell>
                            <TableCell>
                              {receipt ? `${String(receipt.refMonth).padStart(2, '0')}/${receipt.refYear}` : "-"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={statusLabels[transfer.status]?.variant || "outline"}>
                                {statusLabels[transfer.status]?.label || transfer.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {transfer.paidAt ? new Date(transfer.paidAt).toLocaleDateString("pt-BR") : "-"}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              R$ {Number(transfer.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-col items-end gap-2 pt-4 border-t">
                  <div className="flex justify-end items-center gap-4">
                     <span className="text-sm text-muted-foreground">Pendente:</span>
                     <span className="text-base font-semibold text-orange-600">
                       R$ {totalPending.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                     </span>
                  </div>
                  <div className="flex justify-end items-center gap-4">
                     <span className="text-sm text-muted-foreground">Pago:</span>
                     <span className="text-base font-semibold text-green-600">
                       R$ {totalPaid.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                     </span>
                  </div>
                  <div className="flex justify-end items-center gap-4 mt-2 border-t pt-2">
                    <span className="text-sm font-medium">Total Geral:</span>
                    <span className="text-xl font-bold">
                      R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum repasse encontrado para este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-popover text-popover-foreground shadow-lg border rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <span className="text-sm font-medium">{selectedIds.length} selecionado(s)</span>
          <div className="h-4 w-px bg-border" />
          
          <PermissionGuard permission="manual_transfer">
            <Button 
              variant="default" 
              size="sm"
              className="rounded-full bg-green-600 hover:bg-green-700"
              onClick={() => {
                if (confirm(`Confirmar pagamento manual para ${selectedIds.length} repasses?`)) {
                  bulkManualPaymentMutation.mutate(selectedIds);
                }
              }}
              disabled={bulkManualPaymentMutation.isPending || bulkDeleteMutation.isPending}
            >
              {bulkManualPaymentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Pagar Manualmente
            </Button>
          </PermissionGuard>

          <PermissionGuard permission="delete_transfer">
            <Button 
              variant="destructive" 
              size="sm"
              className="rounded-full"
              onClick={() => {
                if (confirm(`Tem certeza que deseja excluir ${selectedIds.length} repasses?`)) {
                  bulkDeleteMutation.mutate(selectedIds);
                }
              }}
              disabled={bulkManualPaymentMutation.isPending || bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Excluir
            </Button>
          </PermissionGuard>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full ml-2"
            onClick={() => setSelectedIds([])}
            title="Cancelar seleção"
          >
            <span className="sr-only">Cancelar</span>
            <span aria-hidden="true">✕</span>
          </Button>
        </div>
      )}

      {/* --- MODO IMPRESSÃO (RELATÓRIO FORMAL) --- */}
      <div className="hidden print:block space-y-6">
        <div className="border-b pb-4 mb-6">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-wider text-black">Relatório de Repasses</h1>
              <p className="text-sm text-gray-500 mt-1">Imobiliária Demo System</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Referência: <span className="font-semibold text-black">{months.find(m => m.value === String(filterMonth))?.label} / {filterYear}</span></p>
              <p className="text-xs text-gray-400 mt-1">Gerado em: {new Date().toLocaleString('pt-BR')}</p>
            </div>
          </div>
        </div>

        <div className="min-h-[500px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-2 font-bold text-black uppercase">Proprietário</th>
                <th className="text-left py-2 font-bold text-black uppercase">Imóvel</th>
                <th className="text-center py-2 font-bold text-black uppercase">Ref.</th>
                <th className="text-center py-2 font-bold text-black uppercase">Status</th>
                <th className="text-right py-2 font-bold text-black uppercase">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredTransfers?.map((transfer) => {
                const landlord = getLandlordInfo(transfer.landlordId);
                const receipt = getReceiptInfo(transfer.receiptId);
                const property = receipt ? getPropertyInfo(receipt.contractId) : undefined;
                
                return (
                  <tr key={transfer.id}>
                    <td className="py-2 text-black">{landlord?.name || "-"}</td>
                    <td className="py-2 text-gray-600">{property?.title || "-"}</td>
                    <td className="py-2 text-center text-gray-600">
                      {receipt ? `${String(receipt.refMonth).padStart(2, '0')}/${receipt.refYear}` : "-"}
                    </td>
                    <td className="py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs border ${
                        transfer.status === 'paid' ? 'border-green-600 text-green-700' :
                        transfer.status === 'pending' ? 'border-orange-600 text-orange-700' :
                        'border-gray-400 text-gray-700'
                      }`}>
                        {statusLabels[transfer.status]?.label || transfer.status}
                      </span>
                    </td>
                    <td className="py-2 text-right font-medium text-black">
                      R$ {Number(transfer.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
              {(!filteredTransfers || filteredTransfers.length === 0) && (
                 <tr>
                   <td colSpan={5} className="py-8 text-center text-gray-500 italic">Nenhum registro encontrado.</td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t-2 border-black pt-4 mt-8 break-inside-avoid">
          <div className="flex justify-end gap-12">
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Pendente</p>
              <p className="text-lg font-bold text-gray-700">R$ {totalPending.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Pago</p>
              <p className="text-lg font-bold text-gray-700">R$ {totalPaid.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Geral</p>
              <p className="text-xl font-bold text-black">R$ {totalAmount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
        
        <div className="fixed bottom-0 left-0 w-full text-center border-t border-gray-200 pt-2 pb-2">
          <p className="text-[10px] text-gray-400">Imob Simple - Sistema de Gestão Imobiliária</p>
        </div>
      </div>
    </div>
  );
}
