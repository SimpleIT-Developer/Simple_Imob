import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, ArrowUpCircle, ArrowDownCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Service, Contract, Property } from "@shared/schema";
import { PermissionGuard } from "@/components/permission-guard";
import { useAuth } from "@/hooks/use-auth";
import { hasAnyFieldPermission, hasFieldPermission } from "@shared/field-permissions";

const months = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" }, { value: "3", label: "Março" },
  { value: "4", label: "Abril" }, { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" }, { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" }, { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

export default function AdjustmentsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAdjustment, setEditingAdjustment] = useState<Service | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>(String(new Date().getFullYear()));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { toast } = useToast();
  const { user } = useAuth();

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const { data: services, isLoading } = useQuery<Service[]>({ queryKey: ["/api/services"] });
  const { data: contracts } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });

  // Filter only adjustments (no provider)
  const adjustments = services?.filter(s => !s.providerId) || [];

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/services", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Lançamento registrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/services/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setIsDialogOpen(false);
      setEditingAdjustment(null);
      toast({ title: "Sucesso", description: "Lançamento atualizado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/services/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      toast({ title: "Sucesso", description: "Lançamento excluído com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => apiRequest("DELETE", "/api/services/bulk", { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      setSelectedIds([]);
      toast({ title: "Sucesso", description: "Lançamentos excluídos com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const type = formData.get("type") as string; // CREDIT or DEBIT
    const rawAmount = parseFloat(formData.get("amount") as string);
    const finalAmount = type === "CREDIT" ? -rawAmount : rawAmount;

    const data = editingAdjustment
      ? {
          ...(canEditField("contractId") ? { contractId: formData.get("contractId") as string } : {}),
          ...(canEditField("refYear") ? { refYear: parseInt(formData.get("refYear") as string) } : {}),
          ...(canEditField("refMonth") ? { refMonth: parseInt(formData.get("refMonth") as string) } : {}),
          ...(canEditField("description") ? { description: formData.get("description") as string } : {}),
          ...(canEditField("amount") ? { amount: finalAmount.toString() } : {}),
          ...(canEditField("chargedTo") ? { chargedTo: formData.get("chargedTo") as string } : {}),
        }
      : {
          contractId: formData.get("contractId") as string,
          providerId: null, // Always null for adjustments
          refYear: parseInt(formData.get("refYear") as string),
          refMonth: parseInt(formData.get("refMonth") as string),
          description: formData.get("description") as string,
          amount: finalAmount.toString(),
          chargedTo: formData.get("chargedTo") as string,
        };

    if (editingAdjustment) {
      updateMutation.mutate({ id: editingAdjustment.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getContractLabel = (contractId: string) => {
    const contract = contracts?.find((c) => c.id === contractId);
    if (!contract) return "-";
    const property = properties?.find((p) => p.id === contract.propertyId);
    return property?.title || contract.id.slice(0, 8);
  };

  const filteredAdjustments = adjustments.filter((s) =>
    (s.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getContractLabel(s.contractId).toLowerCase().includes(searchTerm.toLowerCase())) &&
    (filterMonth === "all" || s.refMonth === parseInt(filterMonth)) &&
    (filterYear === "" || s.refYear === parseInt(filterYear))
  );

  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === "admin";
  const canEditAnyAdjustmentField =
    isAdmin || (userPermissions.includes("edit_adjustment") && hasAnyFieldPermission("edit_adjustment", userPermissions));
  const canEditField = (field: "contractId" | "refYear" | "refMonth" | "description" | "amount" | "chargedTo" | "type") => {
    if (!editingAdjustment) return true;
    if (isAdmin) return true;
    if (!userPermissions.includes("edit_adjustment")) return false;
    return hasFieldPermission(userPermissions, "edit_adjustment", field);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ajustes e Lançamentos</h1>
          <p className="text-muted-foreground">Lançamento de créditos e débitos nos contratos</p>
        </div>
        <div className="flex gap-2">
          <PermissionGuard permission="create_adjustment">
            <Button onClick={() => { setEditingAdjustment(null); setIsDialogOpen(true); }} data-testid="button-new-adjustment">
              <Plus className="mr-2 h-4 w-4" />
              Novo Lançamento
            </Button>
          </PermissionGuard>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ArrowUpCircle className="h-5 w-5 text-primary" />
                Histórico de Lançamentos
              </CardTitle>
              <CardDescription>{adjustments.length} lançamentos registrados</CardDescription>
            </div>
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <div className="flex gap-2">
                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os Meses</SelectItem>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input 
                  placeholder="Ano" 
                  value={filterYear} 
                  onChange={(e) => setFilterYear(e.target.value)} 
                  className="w-[100px]"
                  type="number"
                />
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-adjustments" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredAdjustments.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Ref.</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAdjustments.map((adjustment) => {
                    const amount = Number(adjustment.amount);
                    const isCredit = amount < 0;
                    return (
                      <TableRow key={adjustment.id} data-testid={`row-adjustment-${adjustment.id}`}>
                        <TableCell>
                          <Checkbox 
                            checked={selectedIds.includes(adjustment.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedIds(prev => [...prev, adjustment.id]);
                              } else {
                                setSelectedIds(prev => prev.filter(id => id !== adjustment.id));
                              }
                            }}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{getContractLabel(adjustment.contractId)}</TableCell>
                        <TableCell>{adjustment.description}</TableCell>
                        <TableCell>{String(adjustment.refMonth).padStart(2, "0")}/{adjustment.refYear}</TableCell>
                        <TableCell>
                          <Badge variant={isCredit ? "secondary" : "default"} className={isCredit ? "bg-green-100 text-green-800 hover:bg-green-200" : "bg-red-100 text-red-800 hover:bg-red-200"}>
                            {isCredit ? "Crédito" : "Débito"}
                          </Badge>
                        </TableCell>
                        <TableCell>R$ {Math.abs(amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {adjustment.chargedTo === "TENANT" ? "Locatário" : adjustment.chargedTo === "LANDLORD" ? "Proprietário" : "Nenhum"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <PermissionGuard permission="edit_adjustment">
                              {canEditAnyAdjustmentField && (
                              <Button size="icon" variant="ghost" onClick={() => { setEditingAdjustment(adjustment); setIsDialogOpen(true); }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              )}
                            </PermissionGuard>
                            <PermissionGuard permission="delete_adjustment">
                              <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(adjustment.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </PermissionGuard>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ArrowUpCircle className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum lançamento encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece registrando um crédito ou débito.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAdjustment ? "Editar Lançamento" : "Novo Lançamento"}</DialogTitle>
            <DialogDescription>{editingAdjustment ? "Atualize os dados do lançamento." : "Preencha os dados do novo crédito ou débito."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contractId">Contrato *</Label>
              <Select name="contractId" defaultValue={editingAdjustment?.contractId || ""} required disabled={!canEditField("contractId")}>
                <SelectTrigger data-testid="select-adjustment-contract" disabled={!canEditField("contractId")}>
                  <SelectValue placeholder="Selecione o contrato..." />
                </SelectTrigger>
                <SelectContent>
                  {contracts?.filter((c) => c.status === "active").map((c) => (
                    <SelectItem key={c.id} value={c.id}>{getContractLabel(c.id)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição *</Label>
              <Input id="description" name="description" placeholder="Ex: Desconto por reparo" defaultValue={editingAdjustment?.description} required disabled={!canEditField("description")} data-testid="input-adjustment-description" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="refMonth">Mês Referência *</Label>
                <Select name="refMonth" defaultValue={String(editingAdjustment?.refMonth || currentMonth)} disabled={!canEditField("refMonth")}>
                  <SelectTrigger data-testid="select-adjustment-month" disabled={!canEditField("refMonth")}>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="refYear">Ano Referência *</Label>
                <Input id="refYear" name="refYear" type="number" defaultValue={editingAdjustment?.refYear || currentYear} required disabled={!canEditField("refYear")} data-testid="input-adjustment-year" />
              </div>
            </div>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Tipo *</Label>
                <Select name="type" defaultValue={editingAdjustment ? (Number(editingAdjustment.amount) < 0 ? "CREDIT" : "DEBIT") : "DEBIT"} disabled={!canEditField("type")}>
                  <SelectTrigger data-testid="select-adjustment-type" disabled={!canEditField("type")}>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEBIT">Débito (Cobrança)</SelectItem>
                    <SelectItem value="CREDIT">Crédito (Desconto/Bônus)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Valor (R$) *</Label>
                <Input
                  id="amount" 
                  name="amount" 
                  type="number" 
                  step="0.01" 
                  defaultValue={editingAdjustment ? Math.abs(Number(editingAdjustment.amount)) : ""} 
                  required 
                  disabled={!canEditField("amount")}
                  data-testid="input-adjustment-amount" 
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="chargedTo">Destino (Quem recebe o crédito/débito) *</Label>
              <Select name="chargedTo" defaultValue={editingAdjustment?.chargedTo || "TENANT"} disabled={!canEditField("chargedTo")}>
                <SelectTrigger data-testid="select-adjustment-charged" disabled={!canEditField("chargedTo")}>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="NONE">Nenhum</SelectItem>
                    <SelectItem value="TENANT">Locatário</SelectItem>
                    <SelectItem value="LANDLORD">Proprietário</SelectItem>
                  </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Locatário: Afeta o valor do aluguel a pagar. Proprietário: Afeta o valor do repasse a receber.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-adjustment">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingAdjustment ? "Salvar" : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {selectedIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-popover text-popover-foreground shadow-lg border rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <span className="text-sm font-medium">{selectedIds.length} selecionado(s)</span>
          <div className="h-4 w-px bg-border" />
          <PermissionGuard permission="delete_adjustment">
            <Button 
              variant="destructive" 
              size="sm"
              className="rounded-full"
              onClick={() => {
                if (confirm(`Tem certeza que deseja excluir ${selectedIds.length} lançamentos?`)) {
                  bulkDeleteMutation.mutate(selectedIds);
                }
              }}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Excluir Selecionados
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
    </div>
  );
}
