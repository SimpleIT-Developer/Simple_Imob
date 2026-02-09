import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, FileText, Loader2, Calendar, DollarSign, FileMinus, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Contract, Property, Landlord, Tenant, Guarantor } from "@shared/schema";
import { ContractRecurringItems } from "@/components/contract-recurring-items";
import { cn } from "@/lib/utils";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "Ativo", variant: "default" },
  inactive: { label: "Inativo", variant: "secondary" },
  terminated: { label: "Encerrado", variant: "destructive" },
};

export default function ContractsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const { data: contracts, isLoading, refetch } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: landlords } = useQuery<Landlord[]>({ queryKey: ["/api/landlords"] });
  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });
  const { data: guarantors } = useQuery<Guarantor[]>({ queryKey: ["/api/guarantors"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/contracts", data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      await refetch();
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Contrato cadastrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/contracts/${id}`, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      await refetch();
      setIsDialogOpen(false);
      setEditingContract(null);
      toast({ title: "Sucesso", description: "Contrato atualizado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/contracts/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      await refetch();
      toast({ title: "Sucesso", description: "Contrato excluído com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteDraftReceiptsMutation = useMutation({
    mutationFn: async (contractId: string) => apiRequest("DELETE", `/api/contracts/${contractId}/draft-receipts`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Recibos em rascunho excluídos com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const [formData, setFormData] = useState({
    propertyId: "",
    landlordId: "",
    tenantId: "",
    guarantorId: "",
    guaranteeType: "guarantor",
    startDate: "",
    duration: 30, // Default duration in months
    endDate: "",
    firstDueDate: "",
    dueDay: 5,
    rentAmount: "",
    adminFeePercent: 10,
    status: "active",
    insuranceValue: "",
  });

  const calculateEndDate = (start: string, months: number) => {
    if (!start) return "";
    const [year, month, day] = start.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    
    // Add months with clamp
    date.setMonth(date.getMonth() + months);
    if (date.getDate() !== day) {
      date.setDate(0);
    }
    
    // Subtract 1 day
    date.setDate(date.getDate() - 1);
    
    // Format back to YYYY-MM-DD
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const calculateDuration = (start: string, end: string) => {
    if (!start || !end) return 30;
    const [sY, sM, sD] = start.split('-').map(Number);
    const [eY, eM, eD] = end.split('-').map(Number);
    
    const startDate = new Date(sY, sM - 1, sD);
    const endDate = new Date(eY, eM - 1, eD);
    
    // Add 1 day to end date to include the last day in calculation
    endDate.setDate(endDate.getDate() + 1);
    
    let months = (endDate.getFullYear() - startDate.getFullYear()) * 12;
    months -= startDate.getMonth();
    months += endDate.getMonth();
    
    return months <= 0 ? 30 : months;
  };

  const handleEditClick = (contract: Contract) => {
    setEditingContract(contract);
    const duration = calculateDuration(contract.startDate, contract.endDate);
    setFormData({
      propertyId: contract.propertyId,
      landlordId: contract.landlordId,
      tenantId: contract.tenantId,
      guarantorId: contract.guarantorId || "",
      guaranteeType: contract.guaranteeType || "guarantor",
      startDate: contract.startDate,
      duration: duration,
      endDate: contract.endDate,
      firstDueDate: contract.firstDueDate || "",
      dueDay: contract.dueDay,
      rentAmount: contract.rentAmount.toString(),
      adminFeePercent: Number(contract.adminFeePercent),
      status: contract.status,
      insuranceValue: contract.insuranceValue ? contract.insuranceValue.toString() : "",
    });
    setIsDialogOpen(true);
  };

  const handleNewClick = () => {
    setEditingContract(null);
    setFormData({
      propertyId: "",
      landlordId: "",
      tenantId: "",
      guarantorId: "",
      guaranteeType: "guarantor",
      startDate: "",
      duration: 30,
      endDate: "",
      firstDueDate: "",
      dueDay: 5,
      rentAmount: "",
      adminFeePercent: 10,
      status: "active",
      insuranceValue: "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = {
      ...formData,
      dueDay: Number(formData.dueDay),
      rentAmount: formData.rentAmount,
      adminFeePercent: formData.adminFeePercent.toString(),
      guarantorId: formData.guarantorId || null,
      guaranteeType: formData.guaranteeType,
      insuranceValue: formData.insuranceValue || null,
    };

    if (editingContract) {
      updateMutation.mutate({ id: editingContract.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const getPropertyTitle = (id: string) => properties?.find((p) => p.id === id)?.title || "-";
  const getLandlordName = (id: string) => landlords?.find((l) => l.id === id)?.name || "-";
  const getTenantName = (id: string) => tenants?.find((t) => t.id === id)?.name || "-";
  const getGuarantorName = (id: string) => guarantors?.find((g) => g.id === id)?.name || "-";

  const filteredContracts = contracts?.filter((c) =>
    getPropertyTitle(c.propertyId).toLowerCase().includes(searchTerm.toLowerCase()) ||
    getTenantName(c.tenantId).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    // If it's a full ISO string, parse it as date
    if (dateStr.includes('T')) {
      return new Date(dateStr).toLocaleDateString("pt-BR");
    }
    // If it's YYYY-MM-DD, split and format manually to avoid timezone issues
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };
  const isFormValid = () => {
    const basicFieldsValid = 
      formData.propertyId &&
      formData.landlordId &&
      formData.tenantId &&
      formData.startDate &&
      formData.firstDueDate &&
      formData.dueDay &&
      formData.rentAmount &&
      formData.adminFeePercent !== undefined &&
      formData.status;

    if (!basicFieldsValid) return false;

    if (formData.guaranteeType === 'insurance') {
      if (!formData.insuranceValue || Number(formData.insuranceValue) <= 0) return false;
    }

    return true;
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contratos de Locação</h1>
          <p className="text-muted-foreground">Gerencie os contratos de aluguel</p>
        </div>
        <Button onClick={handleNewClick} data-testid="button-new-contract">
          <Plus className="mr-2 h-4 w-4" />
          Novo Contrato
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Lista de Contratos
              </CardTitle>
              <CardDescription>{contracts?.length || 0} contratos cadastrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-contracts" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredContracts && filteredContracts.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Imóvel</TableHead>
                    <TableHead className="hidden md:table-cell">Proprietário</TableHead>
                    <TableHead className="hidden md:table-cell">Locatário</TableHead>
                    <TableHead className="hidden lg:table-cell">Período</TableHead>
                    <TableHead>Aluguel</TableHead>
                    <TableHead className="hidden md:table-cell">Taxa Adm.</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.map((contract) => (
                    <TableRow key={contract.id} data-testid={`row-contract-${contract.id}`}>
                      <TableCell className="font-medium">{getPropertyTitle(contract.propertyId)}</TableCell>
                      <TableCell className="hidden md:table-cell">{getLandlordName(contract.landlordId)}</TableCell>
                      <TableCell className="hidden md:table-cell">{getTenantName(contract.tenantId)}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex items-center gap-1 text-sm">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {formatDate(contract.startDate)} - {formatDate(contract.endDate)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          R$ {Number(contract.rentAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{Number(contract.adminFeePercent)}%</TableCell>
                      <TableCell>
                        <Badge variant={statusLabels[contract.status]?.variant || "secondary"}>
                          {statusLabels[contract.status]?.label || contract.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => handleEditClick(contract)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteDraftReceiptsMutation.mutate(contract.id)} title="Excluir Recibos em Rascunho">
                            <FileMinus className="h-4 w-4 text-orange-500" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(contract.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum contrato encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo contrato.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingContract ? "Editar Contrato" : "Novo Contrato"}</DialogTitle>
            <DialogDescription>{editingContract ? "Atualize os dados do contrato." : "Preencha os dados do novo contrato."}</DialogDescription>
          </DialogHeader>
          <form id="contract-form" key={editingContract ? editingContract.id : 'new'} onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="propertyId">Imóvel *</Label>
              <SearchableSelect
                options={properties?.map(p => ({
                  value: p.id,
                  label: `${p.code} - ${p.title}${!p.landlordId ? ' (SEM PROPRIETÁRIO)' : ''}`,
                  description: p.address,
                  searchTerms: `${p.code} - ${p.title} ${p.address}`
                })) || []}
                value={formData.propertyId}
                onValueChange={(value) => {
                  const property = properties?.find(p => p.id === value);
                  
                  if (property && !property.landlordId) {
                    toast({
                      title: "Imóvel sem proprietário",
                      description: "Não é possível selecionar um imóvel sem proprietário vinculado. Por favor, edite o imóvel e vincule um proprietário primeiro.",
                      variant: "destructive"
                    });
                    return;
                  }

                  setFormData({ 
                    ...formData, 
                    propertyId: value,
                    landlordId: property?.landlordId || formData.landlordId 
                  });
                }}
                placeholder="Selecione o imóvel..."
                searchPlaceholder="Buscar imóvel (nome, código, endereço)..."
                testId="select-contract-property"
              />
              <input 
                type="hidden" 
                name="propertyId" 
                value={formData.propertyId} 
                required 
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="landlordId">Proprietário *</Label>
                <SearchableSelect
                  options={landlords?.map(l => ({ value: l.id, label: l.name })) || []}
                  value={formData.landlordId}
                  onValueChange={(value) => setFormData({ ...formData, landlordId: value })}
                  placeholder="Selecione..."
                  searchPlaceholder="Buscar proprietário..."
                  testId="select-contract-landlord"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenantId">Locatário *</Label>
                <SearchableSelect
                  options={tenants?.map(t => ({ value: t.id, label: t.name })) || []}
                  value={formData.tenantId}
                  onValueChange={(value) => setFormData({ ...formData, tenantId: value })}
                  placeholder="Selecione..."
                  searchPlaceholder="Buscar locatário..."
                  testId="select-contract-tenant"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="guarantorId">Fiador / Garantia</Label>
                <SearchableSelect
                  options={[
                    { value: "none", label: "Nenhum" },
                    { value: "insurance", label: "SEGURO FIANÇA" },
                    ...(guarantors?.map(g => ({ value: g.id, label: g.name })) || [])
                  ]}
                  value={formData.guaranteeType === 'insurance' ? 'insurance' : (formData.guarantorId || 'none')}
                  onValueChange={(value) => {
                    if (value === 'insurance') {
                      setFormData({ ...formData, guaranteeType: 'insurance', guarantorId: '' });
                    } else if (value === 'none') {
                      setFormData({ ...formData, guaranteeType: 'none', guarantorId: '' });
                    } else {
                      setFormData({ ...formData, guaranteeType: 'guarantor', guarantorId: value });
                    }
                  }}
                  placeholder="Selecione (Opcional)..."
                  searchPlaceholder="Buscar fiador ou opção..."
                  testId="select-contract-guarantor"
                />
              </div>
              {formData.guaranteeType === 'insurance' && (
                <div className="space-y-2">
                  <Label htmlFor="insuranceValue">Valor Seguro Fiança (R$) *</Label>
                  <Input
                    id="insuranceValue"
                    name="insuranceValue"
                    type="number"
                    step="0.01"
                    value={formData.insuranceValue}
                    onChange={(e) => setFormData({ ...formData, insuranceValue: e.target.value })}
                    required
                    data-testid="input-contract-insurance-value"
                  />
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Data Início *</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    const newEnd = calculateEndDate(newStart, formData.duration);
                    setFormData({ ...formData, startDate: newStart, endDate: newEnd });
                  }}
                  required
                  data-testid="input-contract-start"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration">Prazo *</Label>
                <Select
                  name="duration"
                  value={formData.duration.toString()}
                  onValueChange={(value) => {
                    const newDuration = Number(value);
                    const newEnd = calculateEndDate(formData.startDate, newDuration);
                    setFormData({ ...formData, duration: newDuration, endDate: newEnd });
                  }}
                >
                  <SelectTrigger data-testid="select-contract-duration">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12 meses (1 ano)</SelectItem>
                    <SelectItem value="24">24 meses (2 anos)</SelectItem>
                    <SelectItem value="30">30 meses (2,5 anos)</SelectItem>
                    <SelectItem value="36">36 meses (3 anos)</SelectItem>
                    <SelectItem value="48">48 meses (4 anos)</SelectItem>
                    <SelectItem value="60">60 meses (5 anos)</SelectItem>
                    {/* Add custom option if the current duration is not in the list */}
                    {![12, 24, 30, 36, 48, 60].includes(formData.duration) && (
                      <SelectItem value={formData.duration.toString()}>{formData.duration} meses</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">Data Fim</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  value={formData.endDate}
                  readOnly
                  className="bg-muted"
                  data-testid="input-contract-end"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firstDueDate" className="whitespace-nowrap">Primeiro Vencimento *</Label>
                <Input
                  id="firstDueDate"
                  name="firstDueDate"
                  type="date"
                  value={formData.firstDueDate}
                  onChange={(e) => setFormData({ ...formData, firstDueDate: e.target.value })}
                  required
                  data-testid="input-contract-first-due"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="dueDay">Dia Vencimento *</Label>
                <Input
                  id="dueDay"
                  name="dueDay"
                  type="number"
                  min="1"
                  max="31"
                  value={formData.dueDay}
                  onChange={(e) => setFormData({ ...formData, dueDay: Number(e.target.value) })}
                  required
                  data-testid="input-contract-due"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rentAmount">Aluguel (R$) *</Label>
                <Input
                  id="rentAmount"
                  name="rentAmount"
                  type="number"
                  step="0.01"
                  value={formData.rentAmount}
                  onChange={(e) => setFormData({ ...formData, rentAmount: e.target.value })}
                  required
                  data-testid="input-contract-rent"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminFeePercent">Taxa Adm. (%) *</Label>
                <Input
                  id="adminFeePercent"
                  name="adminFeePercent"
                  type="number"
                  step="0.01"
                  value={formData.adminFeePercent}
                  onChange={(e) => setFormData({ ...formData, adminFeePercent: Number(e.target.value) })}
                  required
                  data-testid="input-contract-fee"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select
                name="status"
                value={formData.status}
                onValueChange={(value) => setFormData({ ...formData, status: value })}
              >
                <SelectTrigger data-testid="select-contract-status">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                  <SelectItem value="terminated">Encerrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>

          {editingContract && (
            <div className="space-y-2 border-t pt-4">
               <div className="flex flex-col space-y-1">
                 <h4 className="font-medium leading-none">Itens Recorrentes</h4>
                 <p className="text-sm text-muted-foreground">
                   Adicione despesas ou serviços fixos (ex: Condomínio, IPTU) que serão lançados automaticamente todo mês.
                 </p>
               </div>
               <ContractRecurringItems contractId={editingContract.id} />
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button type="submit" form="contract-form" disabled={isPending || !isFormValid()} data-testid="button-save-contract">
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingContract ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
