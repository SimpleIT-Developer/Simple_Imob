import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Wrench, Loader2 } from "lucide-react";
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
import type { Service, Contract, ServiceProvider, Property } from "@shared/schema";
import { PermissionGuard } from "@/components/permission-guard";

const months = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" }, { value: "3", label: "Março" },
  { value: "4", label: "Abril" }, { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" }, { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" }, { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

export default function ServicesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [selectedChargedTo, setSelectedChargedTo] = useState<"TENANT" | "LANDLORD" | "NONE">("TENANT");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>(String(new Date().getFullYear()));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { toast } = useToast();

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const { data: services, isLoading } = useQuery<Service[]>({ queryKey: ["/api/services"] });
  const { data: contracts } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: providers } = useQuery<ServiceProvider[]>({ queryKey: ["/api/providers"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/services", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Serviço cadastrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/services/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      setIsDialogOpen(false);
      setEditingService(null);
      toast({ title: "Sucesso", description: "Serviço atualizado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/services/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      toast({ title: "Sucesso", description: "Serviço excluído com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => apiRequest("DELETE", "/api/services/bulk", { ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      setSelectedIds([]);
      toast({ title: "Sucesso", description: "Serviços excluídos com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      contractId: formData.get("contractId") as string,
      providerId: formData.get("providerId") as string || null,
      refYear: parseInt(formData.get("refYear") as string),
      refMonth: parseInt(formData.get("refMonth") as string),
      description: formData.get("description") as string,
      amount: formData.get("amount") as string,
      chargedTo: formData.get("chargedTo") as string,
      passThrough: formData.get("passThrough") === "true",
    };

    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data });
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

  const getProviderName = (id: string | null) => {
    if (!id) return "-";
    return providers?.find((p) => p.id === id)?.name || "-";
  };

  const filteredServices = services?.filter((s) =>
    s.providerId && (
      s.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getContractLabel(s.contractId).toLowerCase().includes(searchTerm.toLowerCase())
    ) &&
    (filterMonth === "all" || s.refMonth === parseInt(filterMonth)) &&
    (filterYear === "" || s.refYear === parseInt(filterYear))
  );

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Serviços</h1>
          <p className="text-muted-foreground">Gerencie os serviços vinculados aos contratos</p>
        </div>
        <PermissionGuard permission="create_service">
          <Button onClick={() => { setEditingService(null); setSelectedChargedTo("TENANT"); setIsDialogOpen(true); }} data-testid="button-new-service">
            <Plus className="mr-2 h-4 w-4" />
            Novo Serviço
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                Lista de Serviços
              </CardTitle>
              <CardDescription>{services?.length || 0} serviços cadastrados</CardDescription>
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
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-services" />
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
          ) : filteredServices && filteredServices.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="hidden md:table-cell">Prestador</TableHead>
                    <TableHead>Ref.</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Cobrar de</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredServices.map((service) => (
                    <TableRow key={service.id} data-testid={`row-service-${service.id}`}>
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.includes(service.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedIds(prev => [...prev, service.id]);
                            } else {
                              setSelectedIds(prev => prev.filter(id => id !== service.id));
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{getContractLabel(service.contractId)}</TableCell>
                      <TableCell>{service.description}</TableCell>
                      <TableCell className="hidden md:table-cell">{getProviderName(service.providerId)}</TableCell>
                      <TableCell>{String(service.refMonth).padStart(2, "0")}/{service.refYear}</TableCell>
                      <TableCell>R$ {Number(service.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={service.chargedTo === "TENANT" ? "default" : service.chargedTo === "LANDLORD" ? "secondary" : "outline"}>
                            {service.chargedTo === "TENANT" ? "Locatário" : service.chargedTo === "LANDLORD" ? "Proprietário" : "Nenhum"}
                          </Badge>
                          {service.chargedTo === "TENANT" && service.passThrough && (
                            <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                              Repasse Proprietário
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <PermissionGuard permission="edit_service">
                            <Button size="icon" variant="ghost" onClick={() => { setEditingService(service); setSelectedChargedTo(service.chargedTo); setIsDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </PermissionGuard>
                          <PermissionGuard permission="delete_service">
                            <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(service.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </PermissionGuard>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wrench className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum serviço encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo serviço.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingService ? "Editar Serviço" : "Novo Serviço"}</DialogTitle>
            <DialogDescription>{editingService ? "Atualize os dados do serviço." : "Preencha os dados do novo serviço."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="contractId">Contrato *</Label>
              <Select name="contractId" defaultValue={editingService?.contractId || ""} required>
                <SelectTrigger data-testid="select-service-contract">
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
              <Input id="description" name="description" placeholder="Ex: Manutenção hidráulica" defaultValue={editingService?.description} required data-testid="input-service-description" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="refMonth">Mês Referência *</Label>
                <Select name="refMonth" defaultValue={String(editingService?.refMonth || currentMonth)}>
                  <SelectTrigger data-testid="select-service-month">
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
                <Input id="refYear" name="refYear" type="number" defaultValue={editingService?.refYear || currentYear} required data-testid="input-service-year" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Valor (R$) *</Label>
                <Input id="amount" name="amount" type="number" step="0.01" defaultValue={editingService?.amount || ""} required data-testid="input-service-amount" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chargedTo">Cobrar de *</Label>
                <Select name="chargedTo" value={selectedChargedTo} onValueChange={(v: "TENANT" | "LANDLORD" | "NONE") => setSelectedChargedTo(v)}>
                  <SelectTrigger data-testid="select-service-charged">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nenhum</SelectItem>
                    <SelectItem value="TENANT">Locatário</SelectItem>
                    <SelectItem value="LANDLORD">Proprietário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedChargedTo === "TENANT" && (
              <div className="space-y-2">
                <Label htmlFor="passThrough">Repasse</Label>
                <Select name="passThrough" defaultValue={editingService?.passThrough ? "true" : "false"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="false">Sem Repasse</SelectItem>
                    <SelectItem value="true">Repassar ao Proprietário</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="providerId">Prestador *</Label>
              <Select name="providerId" defaultValue={editingService?.providerId || ""} required>
                <SelectTrigger data-testid="select-service-provider">
                  <SelectValue placeholder="Selecione o prestador..." />
                </SelectTrigger>
                <SelectContent>
                  {providers?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-service">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingService ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {selectedIds.length > 0 && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-popover text-popover-foreground shadow-lg border rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <span className="text-sm font-medium">{selectedIds.length} selecionado(s)</span>
          <div className="h-4 w-px bg-border" />
          <PermissionGuard permission="delete_service">
            <Button 
              variant="destructive" 
              size="sm"
              className="rounded-full"
              onClick={() => {
                if (confirm(`Tem certeza que deseja excluir ${selectedIds.length} serviços?`)) {
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
