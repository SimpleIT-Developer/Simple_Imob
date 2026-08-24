import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Receipt, Search, Loader2, Check, DollarSign, Send, FileCheck, RefreshCw, Eye, AlertCircle, RotateCcw, Printer, Plus, Barcode, XCircle, Trash2, Pencil, FileText, MessageCircle, X, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { PermissionGuard } from "@/components/permission-guard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Receipt as ReceiptType, Contract, Property, Tenant, Landlord, Service, ServiceProvider } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { hasFieldPermission } from "@shared/field-permissions";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "outline" },
  closed: { label: "Fechado", variant: "secondary" },
  paid: { label: "Pago", variant: "default" },
  transferred: { label: "Repassado", variant: "default" },
};

function AddServiceDialog({ 
  contractId, 
  year, 
  month, 
  onSuccess,
  serviceToEdit,
  trigger
}: { 
  contractId: string, 
  year: number, 
  month: number, 
  onSuccess: () => void,
  serviceToEdit?: Service,
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"service" | "adjustment">("adjustment");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [chargedTo, setChargedTo] = useState<"TENANT" | "LANDLORD" | "NONE">("TENANT");
  const [discountFrom, setDiscountFrom] = useState<"TENANT" | "LANDLORD" | "NONE">("NONE");
  const [receiptDiscountTo, setReceiptDiscountTo] = useState<"NONE" | "TENANT" | "LANDLORD" | "BOTH">("NONE");
  const [passThrough, setPassThrough] = useState(false);
  const [isTribute, setIsTribute] = useState(false);
  const [providerId, setProviderId] = useState<string>("");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      if (serviceToEdit) {
        setType(serviceToEdit.providerId ? "service" : "adjustment");
        setDescription(serviceToEdit.description);
        setAmount(serviceToEdit.amount.toString());
        setChargedTo(serviceToEdit.chargedTo as "TENANT" | "LANDLORD" | "NONE");
        setDiscountFrom(((serviceToEdit as any).discountFrom as ("TENANT" | "LANDLORD")) || "NONE");
        setReceiptDiscountTo(((serviceToEdit as any).receiptDiscountTo as ("TENANT" | "LANDLORD" | "BOTH")) || "NONE");
        setPassThrough(serviceToEdit.passThrough);
        setIsTribute(!!(serviceToEdit as any).isTribute);
        setProviderId(serviceToEdit.providerId || "");
      } else {
        // Reset for add mode
        setType("adjustment");
        setDescription("");
        setAmount("");
        setChargedTo("TENANT");
        setDiscountFrom("NONE");
        setReceiptDiscountTo("NONE");
        setPassThrough(false);
        setIsTribute(false);
        setProviderId("");
      }
    }
  }, [open, serviceToEdit]);

  const { data: providers } = useQuery<ServiceProvider[]>({ 
    queryKey: ["/api/providers"],
    enabled: open && type === "service"
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const data = {
        contractId,
        description,
        amount: Number(amount),
        chargedTo,
        discountFrom: discountFrom === "NONE" ? null : discountFrom,
        receiptDiscountTo:
          type === "adjustment" ? (receiptDiscountTo === "NONE" ? null : receiptDiscountTo) : null,
        passThrough,
        isTribute,
        refYear: year,
        refMonth: month,
        providerId: type === "service" ? providerId : null,
        type: type === "service" ? "service" : "adjustment"
      };
      
      if (serviceToEdit) {
        return apiRequest("PATCH", `/api/services/${serviceToEdit.id}`, data);
      } else {
        return apiRequest("POST", "/api/services", data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      setOpen(false);
      if (!serviceToEdit) {
        setDescription("");
        setAmount("");
        setProviderId("");
      }
      onSuccess();
      toast({ 
        title: "Sucesso", 
        description: serviceToEdit ? "Item atualizado com sucesso." : "Item adicionado com sucesso." 
      });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="h-8 gap-1">
            <Plus className="h-3 w-3" />
            Adicionar Item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{serviceToEdit ? "Editar Item" : "Adicionar Item ao Recibo"}</DialogTitle>
          <DialogDescription>
            {serviceToEdit ? "Edite os detalhes do serviço ou ajuste." : "Adicione um serviço ou ajuste para este mês. Será necessário regerar o recibo."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)} disabled={!!serviceToEdit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adjustment">Ajuste (Crédito/Débito)</SelectItem>
                  <SelectItem value="service">Serviço (Com Prestador)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor (R$)</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={amount} 
                onChange={e => setAmount(e.target.value)} 
                required 
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
              placeholder={type === "service" ? "Ex: Manutenção Elétrica" : "Ex: Desconto Acordado"}
              required 
            />
          </div>

          {type === "service" && (
            <div className="space-y-2">
              <Label>Prestador</Label>
              <SearchableSelect
                options={providers?.map(p => ({ value: p.id, label: p.name })) || []}
                value={providerId}
                onValueChange={setProviderId}
                placeholder="Selecione o prestador"
                searchPlaceholder="Buscar prestador..."
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cobrar de</Label>
              <Select value={chargedTo} onValueChange={(v: any) => {
                setChargedTo(v);
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhum</SelectItem>
                  <SelectItem value="TENANT">Locatário</SelectItem>
                  <SelectItem value="LANDLORD">Proprietário</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descontar de</Label>
              <Select value={discountFrom} onValueChange={(v: any) => setDiscountFrom(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhum</SelectItem>
                  <SelectItem value="TENANT">Locatário/Proprietário</SelectItem>
                  <SelectItem value="LANDLORD">Proprietário</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {type === "adjustment" && (
            <div className="space-y-2">
              <Label>Descontar no Recibo</Label>
              <Select value={receiptDiscountTo} onValueChange={(v: any) => setReceiptDiscountTo(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Nenhum</SelectItem>
                  <SelectItem value="TENANT">Locatário</SelectItem>
                  <SelectItem value="LANDLORD">Proprietário</SelectItem>
                  <SelectItem value="BOTH">Locatário / Proprietário</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center space-x-2 pt-8">
              <Checkbox 
                id="isTribute" 
                checked={isTribute} 
                onCheckedChange={(c) => setIsTribute(!!c)}
              />
              <Label htmlFor="isTribute" className="cursor-pointer font-bold text-primary">
                Tributo (Desconto no Boleto)
              </Label>
            </div>
            <div className="flex items-center space-x-2 pt-8">
              <Checkbox 
                id="passThrough" 
                checked={passThrough} 
                onCheckedChange={(c) => setPassThrough(!!c)}
              />
              <Label htmlFor="passThrough" className="cursor-pointer">
                Repassar valor?
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Componente para exibir os detalhes dos serviços/ajustes
function ReceiptServicesDetail({ receiptId, contractId, year, month, storedTenantTotal, storedLandlordTotal, isReadOnly, onReceiptUpdated }: { 
  receiptId: string, 
  contractId: string, 
  year: number, 
  month: number,
  storedTenantTotal: number,
  storedLandlordTotal: number,
  isReadOnly: boolean,
  onReceiptUpdated?: (receipt: ReceiptType) => void
}) {
  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["contract-services", contractId, year, month],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/${contractId}/services/${year}/${month}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
    enabled: !!contractId && !!year && !!month,
  });

  const { toast } = useToast();

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/receipts/${receiptId}/regenerate`);
      return res.json();
    },
    onSuccess: (updatedReceipt) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services", contractId, year, month] });
      if (onReceiptUpdated) {
        onReceiptUpdated(updatedReceipt);
      }
      toast({ title: "Sucesso", description: "Recibo regerado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/services/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      toast({ title: "Sucesso", description: "Item removido com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="py-2 text-center text-sm text-muted-foreground">Carregando detalhes...</div>;

  // Calculate totals regardless of whether services exist (for mismatch check)
  const liveTenantTotal = (services || [])
    .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
    .reduce((sum, s) => sum + Number(s.amount), 0);
    
  const liveLandlordTotal = (services || [])
    .filter(
      (s: any) =>
        s.chargedTo === "LANDLORD" &&
        (s as any).discountFrom !== "LANDLORD" &&
        (s as any).discountFrom !== "TENANT" &&
        !(s as any).receiptDiscountTo &&
        !(s as any).isTribute
    )
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const hasMismatch = 
    Math.abs(liveTenantTotal - storedTenantTotal) > 0.01 || 
    Math.abs(liveLandlordTotal - storedLandlordTotal) > 0.01;

  const providerServices = services?.filter(s => !!s.providerId) || [];
  const adjustments = services?.filter(s => !s.providerId) || [];

  return (
    <div className="space-y-4 pt-2">
      <div className="flex justify-between items-center border-b pb-1">
        <h4 className="text-sm font-medium text-muted-foreground">Serviços e Ajustes</h4>
        {!isReadOnly && (
          <PermissionGuard permission="generate_receipt">
            <AddServiceDialog 
              contractId={contractId} 
              year={year} 
              month={month} 
              onSuccess={() => {
                // Optional: trigger anything else needed on success
              }} 
            />
          </PermissionGuard>
        )}
      </div>

      {hasMismatch && (
        <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800 border border-yellow-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>
              Os valores dos serviços mudaram. <strong>Regere o recibo</strong> para atualizar os totais.
            </span>
          </div>
          {!isReadOnly && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-white hover:bg-yellow-100 border-yellow-300 text-yellow-900"
              onClick={() => regenerateMutation.mutate()}
              disabled={regenerateMutation.isPending}
            >
              {regenerateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Regerar
            </Button>
          )}
        </div>
      )}

      {(!services || services.length === 0) && (
        <p className="text-sm text-muted-foreground py-4 text-center">Nenhum serviço ou ajuste lançado para este mês.</p>
      )}

      {providerServices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Serviços / Contas</h4>
          <Table>
            <TableHeader>
              <TableRow className="h-8 hover:bg-transparent">
                <TableHead className="h-8 py-0 pl-2">Descrição</TableHead>
                <TableHead className="h-8 py-0 w-[100px]">Cobrar de</TableHead>
                <TableHead className="h-8 py-0 w-[110px]">Descontar de</TableHead>
                <TableHead className="h-8 py-0 w-[140px] whitespace-nowrap">Repassar para</TableHead>
                <TableHead className="h-8 py-0 text-right w-[100px]">Valor</TableHead>
                <TableHead className="h-8 py-0 w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providerServices.map(service => (
                <TableRow key={service.id} className="h-8 group">
                  <TableCell className="py-1 pl-2 font-medium">{service.description}</TableCell>
                  <TableCell className="py-1">
                    <Badge variant="outline" className="text-[10px] h-5 px-1 font-normal">
                      {service.chargedTo === "TENANT" ? "Locatário" : service.chargedTo === "LANDLORD" ? "Proprietário" : "Nenhum"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-1">
                    { (service as any).discountFrom ? (
                      <Badge variant="outline" className="text-[10px] h-5 px-1 font-normal">
                        {(service as any).discountFrom === "LANDLORD" ? "Proprietário" : "Locatário/Proprietário"}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="py-1">
                    {service.passThrough && service.chargedTo === "TENANT" && (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1 font-normal bg-blue-50 text-blue-700 hover:bg-blue-100">
                        Proprietário
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-1 text-right font-medium">
                    R$ {Number(service.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="py-1 text-right flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isReadOnly && (
                      <>
                        <AddServiceDialog 
                          contractId={contractId} 
                          year={year} 
                          month={month} 
                          onSuccess={() => {}}
                          serviceToEdit={service}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-6 w-6 mr-1" title="Editar">
                              <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteMutation.mutate(service.id)}
                          disabled={deleteMutation.isPending}
                          title="Excluir"
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {adjustments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Ajustes / Créditos / Débitos</h4>
          <Table>
            <TableHeader>
              <TableRow className="h-8 hover:bg-transparent">
                <TableHead className="h-8 py-0 pl-2">Descrição</TableHead>
                <TableHead className="h-8 py-0 w-[100px] whitespace-nowrap">Aplicar em</TableHead>
                <TableHead className="h-8 py-0 w-[110px]">Descontar de</TableHead>
                <TableHead className="h-8 py-0 text-right w-[100px]">Valor</TableHead>
                <TableHead className="h-8 py-0 w-[70px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map(adj => (
                <TableRow key={adj.id} className="h-8 group">
                  <TableCell className="py-1 pl-2 font-medium">{adj.description}</TableCell>
                  <TableCell className="py-1">
                    <Badge variant="outline" className="text-[10px] h-5 px-1 font-normal">
                      {adj.chargedTo === "TENANT" ? "Locatário" : adj.chargedTo === "LANDLORD" ? "Proprietário" : "Nenhum"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-1">
                    { (adj as any).discountFrom ? (
                      <Badge variant="outline" className="text-[10px] h-5 px-1 font-normal">
                        {(adj as any).discountFrom === "LANDLORD" ? "Proprietário" : "Locatário"}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className={`py-1 text-right font-medium ${Number(adj.amount) < 0 ? "text-green-600" : "text-red-600"}`}>
                    R$ {Number(adj.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="py-1 text-right flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isReadOnly && (
                      <>
                        <AddServiceDialog 
                          contractId={contractId} 
                          year={year} 
                          month={month} 
                          onSuccess={() => {}}
                          serviceToEdit={adj}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-6 w-6 mr-1" title="Editar">
                              <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteMutation.mutate(adj.id)}
                          disabled={deleteMutation.isPending}
                          title="Excluir"
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function DynamicAdminFee({ receipt }: { receipt: ReceiptType }) {
  // We prioritize the stored amount to ensure precision and respect manual overrides.
  // The backend handles the calculation and updates the amount directly.
  return (
    <span className="text-red-600 font-medium">
      - R$ {Number(receipt.adminFeeAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
    </span>
  );
}

function DynamicTenantTotal({ receipt }: { receipt: ReceiptType }) {
  const { data: services } = useQuery<Service[]>({
    queryKey: ["contract-services", receipt.contractId, receipt.refYear, receipt.refMonth],
    queryFn: async () => {
      const res = await fetch(
        `/api/contracts/${receipt.contractId}/services/${receipt.refYear}/${receipt.refMonth}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
  });

  const tenantDiscountFromRent = (services || [])
    .filter((s: any) => (s as any).discountFrom === "TENANT" || (s as any).isTribute)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const servicesTenantTotal = (services || [])
    .filter((s: any) => s.chargedTo === "TENANT" && !(s as any).receiptDiscountTo)
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const receiptDiscountTenantTotal = (services || [])
    .filter(
      (s: any) => (s as any).receiptDiscountTo === "TENANT" || (s as any).receiptDiscountTo === "BOTH",
    )
    .reduce((sum, s) => sum + Number(s.amount), 0);

  const rentAmount = Number(receipt.rentAmount);
  const total =
    rentAmount + servicesTenantTotal - tenantDiscountFromRent - receiptDiscountTenantTotal;

  return (
    <span className="text-green-600 dark:text-green-400">
      R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
    </span>
  );
}

function splitByPercent(total: number, shares: Array<{ landlordId: string; percent: number }>) {
  const totalCents = Math.round(total * 100);
  const valid = (shares || []).filter(s => !!s.landlordId && Number(s.percent) > 0);
  const base = valid.length > 0 ? valid : [];
  const sumPercent = base.reduce((sum, s) => sum + Number(s.percent), 0);
  if (!sumPercent) return base.map(s => ({ ...s, amount: 0 }));

  const parts = base.map(s => {
    const raw = (totalCents * Number(s.percent)) / sumPercent;
    const floor = Math.floor(raw);
    return { landlordId: s.landlordId, percent: Number(s.percent), cents: floor, remainder: raw - floor };
  });
  const sumFloor = parts.reduce((sum, p) => sum + p.cents, 0);
  let remaining = totalCents - sumFloor;
  const sorted = [...parts].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < sorted.length && remaining > 0; i++) {
    sorted[i].cents += 1;
    remaining -= 1;
  }
  return sorted.map(p => ({ landlordId: p.landlordId, percent: p.percent, amount: p.cents / 100 }));
}

function DynamicLandlordTotal({ receipt, landlordShares = [], landlordNamesById }: { receipt: ReceiptType; landlordShares?: Array<{ landlordId: string; percent: number }>; landlordNamesById: Map<string, string> }) {
  const transferSplits = ((receipt as any).transferSplits as Array<{ id: string; landlordId: string; amount: string; status: string }> | undefined) || [];
  if (Array.isArray(transferSplits) && transferSplits.length > 0) {
    const total = transferSplits.reduce((sum, s) => sum + Number(s.amount), 0);
    const percentByLandlord = new Map(landlordShares.map(s => [s.landlordId, s.percent]));
    return (
      <div className="flex flex-col items-end">
        <span>R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
        {transferSplits.length > 1 && (
          <div className="text-[10px] text-muted-foreground text-right leading-tight">
            {transferSplits.map(s => (
              <div key={s.id}>
                {landlordNamesById.get(s.landlordId) || "-"}{" "}
                {percentByLandlord.has(s.landlordId) && (
                  <>({Number(percentByLandlord.get(s.landlordId)).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%) </>
                )}
                R$ {Number(s.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  const landlordTotal = Number(receipt.landlordTotalDue);
  const splits = splitByPercent(landlordTotal, landlordShares);
  return (
    <div className="flex flex-col items-end">
      <span>R$ {landlordTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
      {splits.length > 1 && (
        <div className="text-[10px] text-muted-foreground text-right leading-tight">
          {splits.map(s => (
            <div key={s.landlordId}>
              {landlordNamesById.get(s.landlordId) || "-"} ({Number(s.percent).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%):{" "}
              R$ {Number(s.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const months = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" }, { value: "3", label: "Março" },
  { value: "4", label: "Abril" }, { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" }, { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" }, { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

type FixedReceiptFilter =
  | "all"
  | "no_slip"
  | "open"
  | "draft"
  | "no_invoice_issued"
  | "invoice_generated_not_issued"
  | "no_transfer";

export default function ReceiptsPage() {
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-";
    if (dateStr.includes('T')) {
      return new Date(dateStr).toLocaleDateString("pt-BR");
    }
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(currentMonth);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptType | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [boletoDetailsOpen, setBoletoDetailsOpen] = useState(false);
  const [selectedBoletoReceipt, setSelectedBoletoReceipt] = useState<ReceiptType | null>(null);
  const [markingPaidReceipt, setMarkingPaidReceipt] = useState<ReceiptType | null>(null);
  const [isBatchMarkingPaid, setIsBatchMarkingPaid] = useState(false);
  const [paymentDate, setPaymentDate] = useState("");
  const [interestValue, setInterestValue] = useState("0,00");
  const [editingAdminFee, setEditingAdminFee] = useState(false);
  const [adminFeeValue, setAdminFeeValue] = useState("");
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [dueDateValue, setDueDateValue] = useState("");
  const [fixedFilter, setFixedFilter] = useState<FixedReceiptFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();
  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === "admin";
  const canEditReceiptField = (field: "dueDate" | "adminFeeAmount") => {
    if (isAdmin) return true;
    if (!userPermissions.includes("edit_receipt")) return false;
    return hasFieldPermission(userPermissions, "edit_receipt", field);
  };

  const [selectedReceipts, setSelectedReceipts] = useState<Set<string>>(new Set());
  const [invoiceSelectionOpen, setInvoiceSelectionOpen] = useState(false);
  const [invoiceSelectionReceipt, setInvoiceSelectionReceipt] = useState<ReceiptType | null>(null);
  const [invoiceSelectionOwners, setInvoiceSelectionOwners] = useState<Array<{ landlordId: string; percent: number; name?: string }>>([]);
  const [invoiceSelectionSelected, setInvoiceSelectionSelected] = useState<Set<string>>(new Set());
  const [invoiceSelectionMode, setInvoiceSelectionMode] = useState<"administracao" | "landlordNfse">("administracao");
  const [rateioEditOpen, setRateioEditOpen] = useState(false);
  const [rateioEditReceipt, setRateioEditReceipt] = useState<ReceiptType | null>(null);
  const [rateioEditItems, setRateioEditItems] = useState<Array<{ id: string; landlordId: string; amount: string }>>([]);
  const [rateioBaseTotal, setRateioBaseTotal] = useState(0);

  const batchTransferMutation = useMutation({
    mutationFn: async (receiptIds: string[]) => {
      const res = await apiRequest("POST", "/api/transfers/batch-generate", { receiptIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      setSelectedReceipts(new Set()); // Clear selection
      
      const { success, errors, details } = data;
      if (errors > 0) {
         toast({ 
            title: "Processamento concluído com erros", 
            description: `${success} repasses gerados. ${errors} falhas. Verifique os detalhes.`, 
            variant: "destructive" 
         });
      } else {
         toast({ title: "Sucesso", description: `${success} repasses gerados com sucesso.` });
      }
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  });

  const batchMarkPaidMutation = useMutation({
    mutationFn: async ({ receiptIds, date }: { receiptIds: string[], date: string }) => {
      const res = await apiRequest("POST", "/api/receipts/batch-mark-paid", { receiptIds, paymentDate: date });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      setSelectedReceipts(new Set()); // Clear selection
      setIsBatchMarkingPaid(false);
      
      const { success, errors, details } = data;
      if (errors > 0) {
         toast({ 
            title: "Processamento concluído com erros", 
            description: `${success} recibos pagos. ${errors} falhas. Verifique os detalhes.`, 
            variant: "destructive" 
         });
      } else {
         toast({ title: "Sucesso", description: `${success} recibos marcados como pago com sucesso.` });
      }
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  });

  const batchEmitSlipMutation = useMutation({
    mutationFn: async (receiptIds: string[]) => {
      const res = await apiRequest("POST", "/api/receipts/batch-emit-slip", { receiptIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setSelectedReceipts(new Set()); 
      
      const { success, errors } = data;
      if (errors > 0) {
         toast({ 
            title: "Processamento concluído com erros", 
            description: `${success} boletos emitidos. ${errors} falhas. Verifique os detalhes.`, 
            variant: "destructive" 
         });
      } else {
         toast({ title: "Sucesso", description: `${success} boletos emitidos com sucesso.` });
      }
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  });

  const toggleReceiptSelection = (id: string) => {
    const newSelection = new Set(selectedReceipts);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedReceipts(newSelection);
  };

  const isEligibleForSelection = (r: ReceiptType & { hasTransfer?: boolean }) => {
    // Eligible if it can be Transferred OR Paid
    // Transfer eligible: (paid or closed) AND !hasTransfer
    // Pay eligible: closed OR (transferred AND !paid) -> Note: 'paid' status implies paid. 'transferred' might be paid or not.
    // Simplifying: Allow selection of any receipt that is NOT 'draft'.
    // Actions will filter based on selection.
    // Actually, let's keep it simple:
    // - Generate Transfer: Needs 'paid' or 'closed', no transfer.
    // - Mark Paid: Needs 'closed' (or 'transferred' without payment).
    
    // So if status is 'draft', we usually can't do batch actions yet (maybe 'close' batch later?).
    // For now, allow selecting 'paid', 'closed', 'transferred'.
    return r.status !== 'draft';
  };

  const { data: receipts, isLoading } = useQuery<(ReceiptType & { outdated?: boolean; hasTransfer?: boolean; paymentDate?: string | null })[]>({ 
    queryKey: ["/api/receipts", filterYear, filterMonth],
    queryFn: async () => {
      const res = await fetch(`/api/receipts?year=${filterYear}&month=${filterMonth}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch receipts");
      return res.json();
    }
  });
  const { data: contracts } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: properties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: tenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });
  const { data: landlords } = useQuery<Landlord[]>({ queryKey: ["/api/landlords"] });

  const updateAdminFeeMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: string }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${id}/admin-fee`, { adminFeeAmount: amount });
      return res.json();
    },
    onSuccess: (updatedReceipt) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setSelectedReceipt(updatedReceipt); // Update selected receipt to reflect changes
      setEditingAdminFee(false);
      toast({ title: "Sucesso", description: "Taxa de administração atualizada." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  });

  const updateDueDateMutation = useMutation({
    mutationFn: async ({ id, dueDate }: { id: string; dueDate: string }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${id}/due-date`, { dueDate });
      return res.json();
    },
    onSuccess: (updatedReceipt) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setSelectedReceipt(updatedReceipt);
      setEditingDueDate(false);
      toast({ title: "Sucesso", description: "Vencimento atualizado." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    }
  });

  const generateMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/receipts/generate", { year: filterYear, month: filterMonth }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Recibos gerados com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteDraftsMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/receipts/drafts", { year: filterYear, month: filterMonth }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Recibos em rascunho excluídos." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const closeReceiptMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipts/${id}/close`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setIsDetailOpen(false);
      toast({ title: "Sucesso", description: "Recibo fechado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ id, date, interest }: { id: string; date: string; interest?: number }) => {
      const res = await apiRequest("POST", `/api/receipts/${id}/mark-paid`, { paymentDate: date, interest });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      setIsDetailOpen(false);
      setMarkingPaidReceipt(null);
      toast({ title: "Sucesso", description: "Pagamento registrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const reversePaymentMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipts/${id}/reverse-payment`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      setIsDetailOpen(false);
      toast({ title: "Sucesso", description: "Pagamento estornado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const createTransferMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipts/${id}/create-transfer`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      setIsDetailOpen(false);
      toast({ title: "Sucesso", description: "Repasse gerado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateTransferSplitsMutation = useMutation({
    mutationFn: async (payload: { receiptId: string; splits: Array<{ id: string; amount: number }> }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${payload.receiptId}/transfer-splits`, { splits: payload.splits });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transfers"] });
      setRateioEditOpen(false);
      setRateioEditReceipt(null);
      setRateioEditItems([]);
      setRateioBaseTotal(0);
      toast({ title: "Sucesso", description: "Rateio do repasse atualizado." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (payload: { id: string; landlordIds?: string[] }) => {
      const res = await apiRequest("POST", `/api/receipts/${payload.id}/create-invoice`, {
        landlordIds: payload.landlordIds,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setIsDetailOpen(false);
      setInvoiceSelectionOpen(false);
      setInvoiceSelectionReceipt(null);
      setInvoiceSelectionOwners([]);
      setInvoiceSelectionSelected(new Set());
      setInvoiceSelectionMode("administracao");

      const createdCount = Array.isArray(data?.created) ? data.created.length : 0;
      const skippedCount = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      if (createdCount === 0 && skippedCount > 0) {
        toast({ title: "Aviso", description: "As notas selecionadas já estavam geradas para este recibo." });
        return;
      }
      if (createdCount > 0 && skippedCount > 0) {
        toast({ title: "Sucesso", description: `${createdCount} NF(s) gerada(s). ${skippedCount} já existiam.` });
        return;
      }
      toast({ title: "Sucesso", description: `${createdCount || 1} NF(s) gerada(s) com sucesso.` });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const createLandlordNfseMutation = useMutation({
    mutationFn: async (payload: { id: string; landlordIds?: string[] }) => {
      const res = await apiRequest("POST", `/api/receipts/${payload.id}/create-landlord-nfse`, {
        landlordIds: payload.landlordIds,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      setIsDetailOpen(false);
      setInvoiceSelectionOpen(false);
      setInvoiceSelectionReceipt(null);
      setInvoiceSelectionOwners([]);
      setInvoiceSelectionSelected(new Set());
      setInvoiceSelectionMode("administracao");

      const createdCount = Array.isArray(data?.created) ? data.created.length : 0;
      const skippedCount = Array.isArray(data?.skipped) ? data.skipped.length : 0;
      if (createdCount === 0 && skippedCount > 0) {
        toast({ title: "Aviso", description: "As NFS-e do proprietário selecionadas já estavam geradas para este recibo." });
        return;
      }
      if (createdCount > 0 && skippedCount > 0) {
        toast({ title: "Sucesso", description: `${createdCount} NFS-e(s) do proprietário gerada(s). ${skippedCount} já existiam.` });
        return;
      }
      toast({ title: "Sucesso", description: `${createdCount || 1} NFS-e(s) do proprietário gerada(s) com sucesso.` });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const regenerateMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipts/${id}/regenerate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.invalidateQueries({ queryKey: ["contract-services"] });
      toast({ title: "Sucesso", description: "Recibo regerado com os valores atuais." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const reopenReceiptMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipts/${id}/reopen`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Recibo reaberto (rascunho)." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const createSlipMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/receipts/${id}/slip`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Boleto emitido com sucesso." });
      if (data.pdfUrl) {
         window.open(data.pdfUrl, '_blank');
      }
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const cancelSlipMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipts/${id}/cancel-slip`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ title: "Sucesso", description: "Boleto cancelado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const getContractInfo = (contractId: string) => {
    const contract = contracts?.find((c) => c.id === contractId);
    if (!contract) return { property: "-", tenant: "-", landlord: "-" };
    const property = properties?.find((p) => p.id === contract.propertyId);
    const tenant = tenants?.find((t) => t.id === contract.tenantId);
    const shares = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
    const landlordLabel =
      Array.isArray(shares) && shares.length > 0
        ? shares
            .map(s => {
              const name = landlords?.find(l => l.id === s.landlordId)?.name || "-";
              return `${name} (${Number(s.percent).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`;
            })
            .join(" + ")
        : landlords?.find((l) => l.id === contract.landlordId)?.name || "-";
    return { property: property?.title || "-", tenant: tenant?.name || "-", landlord: landlordLabel };
  };

  const normalizeSearchText = (value: unknown) => {
    const s = String(value ?? "").trim();
    if (!s) return "";
    return s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  };

  const formatNumberBR = (val: unknown) => {
    const n = Number(val);
    if (Number.isNaN(n)) return "";
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const buildReceiptSearchText = (receipt: ReceiptType) => {
    const parts: string[] = [];
    const push = (v: unknown) => {
      const s = String(v ?? "").trim();
      if (s) parts.push(s);
    };

    const contract = contracts?.find(c => c.id === receipt.contractId);
    const property = contract ? properties?.find(p => p.id === contract.propertyId) : undefined;
    const tenant = contract ? tenants?.find(t => t.id === contract.tenantId) : undefined;
    const shares = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
    const owners =
      Array.isArray(shares) && shares.length > 0
        ? shares
        : contract?.landlordId
          ? [{ landlordId: contract.landlordId, percent: 100 }]
          : [];

    const statusLabel = statusLabels[receipt.status]?.label || receipt.status;

    push(receipt.id);
    push(receipt.id?.slice?.(0, 6));
    push(receipt.contractId);
    push(receipt.refMonth);
    push(receipt.refYear);
    push(`${receipt.refMonth}/${receipt.refYear}`);
    push(new Date(receipt.refYear, receipt.refMonth - 1).toLocaleString("pt-BR", { month: "long" }));

    push(receipt.dueDate);
    push(formatDate(receipt.dueDate));
    push((receipt as any).paymentDate);
    push((receipt as any).paymentDate ? formatDate((receipt as any).paymentDate) : "");

    push(receipt.status);
    push(statusLabel);
    push(receipt.isSlipIssued ? "boleto emitido" : "sem boleto");
    push(receipt.isInvoiceIssued ? "nf emitida" : "");
    push(!receipt.isInvoiceIssued && receipt.isInvoiceGenerated ? "nf gerada" : "");
    push(receipt.isInvoiceCancelled ? "nf cancelada" : "");
    push((receipt as any).hasTransfer ? "repasse" : "sem repasse");
    push((receipt as any).transferStatus);
    push((receipt as any).isPaid ? "pago" : "");
    push((receipt as any).outdated ? "desatualizado" : "");

    push(receipt.rentAmount);
    push(formatNumberBR(receipt.rentAmount));
    push(receipt.tenantTotalDue);
    push(formatNumberBR(receipt.tenantTotalDue));
    push(receipt.landlordTotalDue);
    push(formatNumberBR(receipt.landlordTotalDue));
    push(receipt.adminFeePercent);
    push(receipt.adminFeeAmount);
    push(formatNumberBR(receipt.adminFeeAmount));
    push((receipt as any).servicesTenantTotal);
    push((receipt as any).servicesLandlordTotal);
    push((receipt as any).interestAmount);

    push(receipt.slipOurNumber);
    push(receipt.slipDigitableLine);
    push(receipt.slipBarcode);

    if (property) {
      push(property.code);
      push(property.title);
      push(property.address);
      push(property.neighborhood);
      push(property.city);
      push(property.state);
      push(property.zipCode);
      const propLandlordId = (property as any).landlordId;
      push(propLandlordId);
    }

    if (tenant) {
      push(tenant.id);
      push(tenant.code);
      push(tenant.name);
      push(tenant.doc);
      push(tenant.rg);
      push(tenant.phone);
      push(tenant.email);
      push(tenant.address);
      push(tenant.neighborhood);
      push(tenant.city);
      push(tenant.state);
      push(tenant.zipCode);
    }

    owners.forEach(o => {
      push(o.landlordId);
      push(o.percent);
      const l = landlords?.find(ll => ll.id === o.landlordId);
      if (l) {
        push(l.id);
        push((l as any).code);
        push(l.name);
        push((l as any).doc);
        push((l as any).rg);
        push((l as any).phone);
        push((l as any).email);
        push((l as any).address);
        push((l as any).neighborhood);
        push((l as any).city);
        push((l as any).state);
        push((l as any).zipCode);
      }
    });

    const info = getContractInfo(receipt.contractId);
    push(info.property);
    push(info.tenant);
    push(info.landlord);

    const invoiceLandlordIds = ((receipt as any).invoiceLandlordIds as string[] | undefined) || [];
    invoiceLandlordIds.forEach(id => {
      push(id);
      const l = landlords?.find(ll => ll.id === id);
      if (l) {
        push((l as any).code);
        push(l.name);
      }
    });

    const transferSplits = ((receipt as any).transferSplits as Array<{ id: string; landlordId: string; amount: string; status: string }> | undefined) || [];
    transferSplits.forEach(s => {
      push(s.id);
      push(s.landlordId);
      push(s.amount);
      push(formatNumberBR(s.amount));
      push(s.status);
    });

    const override = (receipt as any).landlordSplitOverride as Array<{ landlordId: string; amount: number }> | undefined;
    if (Array.isArray(override)) {
      override.forEach(o => {
        push(o.landlordId);
        push(o.amount);
        push(formatNumberBR(o.amount));
      });
    }

    return parts.join(" ");
  };

  const handleGenerateInvoiceClick = (receipt: ReceiptType) => {
    const contract = contracts?.find(c => c.id === receipt.contractId);
    const property = contract ? properties?.find(p => p.id === contract.propertyId) : undefined;
    const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
    const owners =
      Array.isArray(sharesRaw) && sharesRaw.length > 0
        ? sharesRaw
            .filter(s => !!s.landlordId && Number(s.percent) > 0)
            .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
        : contract?.landlordId
          ? [{ landlordId: contract.landlordId, percent: 100 }]
          : [];

    const existingInvoiceLandlordIds = new Set<string>(((receipt as any).invoiceLandlordIds as string[] | undefined) || []);
    const eligibleOwners = owners.filter(o => !existingInvoiceLandlordIds.has(o.landlordId));

    if (eligibleOwners.length === 0) {
      toast({ title: "Aviso", description: "As notas fiscais deste recibo já foram geradas para todos os proprietários." });
      return;
    }

    if (eligibleOwners.length === 1) {
      createInvoiceMutation.mutate({ id: receipt.id, landlordIds: [eligibleOwners[0].landlordId] });
      return;
    }

    setInvoiceSelectionMode("administracao");
    setInvoiceSelectionReceipt(receipt);
    setInvoiceSelectionOwners(eligibleOwners);
    setInvoiceSelectionSelected(new Set(eligibleOwners.map(o => o.landlordId)));
    setInvoiceSelectionOpen(true);
  };

  const getEligibleLandlordNfseOwners = (receipt: ReceiptType) => {
    const enrichedOwners = ((receipt as any).landlordNfseEligibleOwners as Array<{ landlordId: string; percent: number; name?: string }> | undefined) || [];
    if (Array.isArray(enrichedOwners) && enrichedOwners.length > 0) {
      return enrichedOwners;
    }

    const enrichedIds = new Set<string>(((receipt as any).landlordNfseEligibleIds as string[] | undefined) || []);
    if (enrichedIds.size > 0) {
      return Array.from(enrichedIds).map((landlordId) => ({
        landlordId,
        percent: 0,
        name: landlords?.find((item) => item.id === landlordId)?.name || "",
      }));
    }

    const contract = contracts?.find(c => c.id === receipt.contractId);
    const property = contract ? properties?.find(p => p.id === contract.propertyId) : undefined;
    const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
    const owners =
      Array.isArray(sharesRaw) && sharesRaw.length > 0
        ? sharesRaw
            .filter(s => !!s.landlordId && Number(s.percent) > 0)
            .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
        : contract?.landlordId
          ? [{ landlordId: contract.landlordId, percent: 100 }]
          : [];

    const existingLandlordNfseIds = new Set<string>(((receipt as any).landlordNfseLandlordIds as string[] | undefined) || []);
    return owners.filter((owner) => {
      if (existingLandlordNfseIds.has(owner.landlordId)) return false;
      const landlord = landlords?.find((item) => item.id === owner.landlordId);
      return Boolean((landlord as any)?.nfseEnabled);
    });
  };

  const handleGenerateLandlordNfseClick = (receipt: ReceiptType) => {
    const eligibleOwners = getEligibleLandlordNfseOwners(receipt);

    if (eligibleOwners.length === 0) {
      toast({
        title: "Aviso",
        description: "Não há proprietário habilitado para emissão de NFS-e própria neste recibo, ou a NFS-e já foi gerada.",
      });
      return;
    }

    if (eligibleOwners.length === 1) {
      createLandlordNfseMutation.mutate({ id: receipt.id, landlordIds: [eligibleOwners[0].landlordId] });
      return;
    }

    setInvoiceSelectionMode("landlordNfse");
    setInvoiceSelectionReceipt(receipt);
    setInvoiceSelectionOwners(eligibleOwners);
    setInvoiceSelectionSelected(new Set(eligibleOwners.map(o => o.landlordId)));
    setInvoiceSelectionOpen(true);
  };

  const handleEditRateioClick = (receipt: ReceiptType) => {
    const splits = ((receipt as any).transferSplits as Array<{ id: string; landlordId: string; amount: string; status: string }> | undefined) || [];
    if (!Array.isArray(splits) || splits.length <= 1) {
      toast({ title: "Aviso", description: "Este recibo não possui rateio para editar." });
      return;
    }
    if (!splits.every(s => s.status === "pending")) {
      toast({ title: "Aviso", description: "Só é possível editar rateio quando todos os repasses estão pendentes." });
      return;
    }
    const total = splits.reduce((sum, s) => sum + Number(s.amount), 0);
    setRateioBaseTotal(total);
    setRateioEditItems(splits.map(s => ({ id: s.id, landlordId: s.landlordId, amount: String(s.amount) })));
    setRateioEditReceipt(receipt);
    setRateioEditOpen(true);
  };

  const parseAmountInput = (value: string) => {
    const v = String(value ?? "").trim();
    if (!v) return 0;
    if (v.includes(",")) {
      const normalized = v.replace(/\./g, "").replace(",", ".");
      return Number(normalized);
    }
    const normalized = v.replace(/,/g, "");
    return Number(normalized);
  };

  const applyFixedFilter = (receipt: ReceiptType & { hasTransfer?: boolean; transferStatus?: string; isPaid?: boolean }) => {
    if (fixedFilter === "all") return true;

    if (fixedFilter === "no_slip") {
      return !receipt.isSlipIssued;
    }

    if (fixedFilter === "open") {
      return receipt.status === "closed";
    }

    if (fixedFilter === "draft") {
      return receipt.status === "draft";
    }

    if (fixedFilter === "no_invoice_issued") {
      return !receipt.isInvoiceIssued;
    }

    if (fixedFilter === "invoice_generated_not_issued") {
      return receipt.isInvoiceGenerated && !receipt.isInvoiceIssued;
    }

    if (fixedFilter === "no_transfer") {
      return !receipt.hasTransfer;
    }

    return true;
  };

  const filteredReceipts = receipts?.filter(applyFixedFilter).filter(receipt => {
    if (!searchTerm) return true;
    const hay = normalizeSearchText(buildReceiptSearchText(receipt));
    const terms = normalizeSearchText(searchTerm).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    return terms.every(t => hay.includes(t));
  });

  const toggleAllSelection = (checked: boolean) => {
    if (checked) {
      const eligibleReceipts = filteredReceipts?.filter(isEligibleForSelection).map(r => r.id) || [];
      setSelectedReceipts(new Set(eligibleReceipts));
    } else {
      setSelectedReceipts(new Set());
    }
  };

  const openDetail = (receipt: ReceiptType) => {
    setSelectedReceipt(receipt);
    setIsDetailOpen(true);
  };

  const isPending = generateMutation.isPending || deleteDraftsMutation.isPending || closeReceiptMutation.isPending || markPaidMutation.isPending || createTransferMutation.isPending || reversePaymentMutation.isPending || regenerateMutation.isPending || reopenReceiptMutation.isPending || createSlipMutation.isPending || cancelSlipMutation.isPending;



  const handleShareWhatsApp = async (receipt: ReceiptType) => {
    if (!receipt.slipDigitableLine) return;

    const contract = contracts?.find((c) => c.id === receipt.contractId);
    const tenant = tenants?.find((t) => t.id === contract?.tenantId);
    const property = properties?.find((p) => p.id === contract?.propertyId);

    const tenantName = tenant?.name || "";
    const tenantFirstName = tenantName.split(" ")[0] || "Locatário";
    const propertyAddress = property?.address || "";

    const refMonthName = new Date(receipt.refYear, receipt.refMonth - 1).toLocaleString("pt-BR", { month: "long" });
    const referencia = `${refMonthName}/${receipt.refYear}`;

    const publicLink = `${window.location.origin}/api/public/receipts/${receipt.id}/boleto`;
    const message = `Olá ${tenantFirstName}, segue o boleto de aluguel referente a ${referencia} do imóvel ${propertyAddress}.\n\nAcesse o boleto pelo link: ${publicLink}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");

    toast({
      title: "Link gerado para envio",
      description: "O envio direto de arquivo pode falhar em alguns dispositivos. Enviando link para o boleto.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Recibos do Mês</h1>
          <p className="text-muted-foreground">Gerencie os recibos mensais dos contratos</p>
        </div>
        <div className="flex gap-2">
          <PermissionGuard permission="generate_receipt">
            <Button onClick={() => generateMutation.mutate()} disabled={isPending} data-testid="button-generate-receipts">
              {generateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Gerar Recibos do Mês
            </Button>
          </PermissionGuard>
          <PermissionGuard permission="delete_receipt">
            <Button variant="destructive" onClick={() => deleteDraftsMutation.mutate()} disabled={isPending}>
              {deleteDraftsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Excluir Rascunhos do Mês
            </Button>
          </PermissionGuard>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                Lista de Recibos
              </CardTitle>
              <CardDescription>
                {filteredReceipts?.length || 0} recibos encontrados
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-receipts"
                />
              </div>
              <div className="flex gap-2">
                <Select value={String(filterMonth)} onValueChange={(v) => setFilterMonth(parseInt(v))}>
                  <SelectTrigger className="w-32" data-testid="select-filter-month">
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
                  data-testid="input-filter-year"
                />
              </div>
              <div className="flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Filter className="h-4 w-4" />
                      <span className="hidden sm:inline">Filtros rápidos</span>
                      <span className="sm:hidden">Filtros</span>
                      {fixedFilter !== "all" && (
                        <Badge variant="secondary" className="ml-1">
                          1 ativo
                        </Badge>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Filtros fixos</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={fixedFilter}
                      onValueChange={(value) => setFixedFilter(value as FixedReceiptFilter)}
                    >
                      <DropdownMenuRadioItem value="all">Todos</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="no_slip">Recibos sem Boleto</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="open">Recibos em Aberto</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="draft">Recibos em Rascunho</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="no_invoice_issued">Recibos sem NF Emitida</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="invoice_generated_not_issued">
                        NF gerada mas não emitida
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="no_transfer">Recibos sem Repasse</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
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
          ) : receipts && receipts.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox 
                        checked={
                          filteredReceipts && filteredReceipts.length > 0 && 
                          filteredReceipts.some(isEligibleForSelection) &&
                          filteredReceipts
                            .filter(isEligibleForSelection)
                            .every(r => selectedReceipts.has(r.id))
                        }
                        onCheckedChange={(checked) => toggleAllSelection(!!checked)}
                      />
                    </TableHead>
                    <TableHead>Imóvel</TableHead>
                    <TableHead className="hidden md:table-cell">Locatário</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead>Aluguel</TableHead>
                    <TableHead>Total Locatário</TableHead>
                    <TableHead className="hidden lg:table-cell">Total Proprietário</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReceipts?.map((receipt) => {
                    const info = getContractInfo(receipt.contractId);
                    const contract = contracts?.find(c => c.id === receipt.contractId);
                    const property = contract ? properties?.find(p => p.id === contract.propertyId) : undefined;
                    const landlordShares = (((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || []).length
                      ? (((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }>) || [])
                      : contract?.landlordId
                        ? [{ landlordId: contract.landlordId, percent: 100 }]
                        : [];
                    const landlordNamesById = new Map((landlords || []).map(l => [l.id, l.name]));
                    return (
                      <TableRow key={receipt.id} data-testid={`row-receipt-${receipt.id}`}>
                        <TableCell>
                          {isEligibleForSelection(receipt) && (
                            <Checkbox 
                              checked={selectedReceipts.has(receipt.id)}
                              onCheckedChange={() => toggleReceiptSelection(receipt.id)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">{info.property}</span>
                            <span className="text-xs text-muted-foreground">
                              Proprietário: {info.landlord}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{info.tenant}</TableCell>
                        <TableCell>{formatDate(receipt.dueDate)}</TableCell>
                        <TableCell>{receipt.paymentDate ? formatDate(receipt.paymentDate) : "-"}</TableCell>
                        <TableCell>R$ {Number(receipt.rentAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="font-medium text-green-600 dark:text-green-400">
                          R$ {Number(receipt.tenantTotalDue).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <DynamicLandlordTotal receipt={receipt} landlordShares={landlordShares} landlordNamesById={landlordNamesById} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 items-center">
                            {receipt.outdated && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="bg-yellow-100 text-yellow-700 p-1 rounded-full cursor-help mr-1">
                                      <AlertCircle className="h-4 w-4" />
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Valores desatualizados. Regere o recibo.</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            
                            {(receipt as any).isPaid && receipt.status !== 'paid' && (
                              <Badge 
                                variant="default"
                                className="bg-green-600 hover:bg-green-700 mr-1"
                              >
                                Pago
                              </Badge>
                            )}
                            
                            {receipt.hasTransfer && receipt.status !== 'transferred' && (
                              <Badge 
                                variant="outline" 
                                className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200 mr-1"
                              >
                                Repasse
                              </Badge>
                            )}

                            <Badge 
                              variant={statusLabels[receipt.status]?.variant || "outline"}
                              className={
                                receipt.status === 'paid' ? "bg-green-600 hover:bg-green-700" :
                                receipt.status === 'transferred' ? "bg-blue-600 hover:bg-blue-700" : ""
                              }
                            >
                              {statusLabels[receipt.status]?.label || receipt.status}
                            </Badge>

                            {receipt.isSlipIssued && (
                              <Badge variant="default" className="bg-indigo-600 hover:bg-indigo-700">Boleto Emitido</Badge>
                            )}

                            {receipt.isInvoiceIssued && (
                              <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">NF Emitida</Badge>
                            )}

                            {receipt.isInvoiceCancelled && !receipt.isInvoiceIssued && !receipt.isInvoiceGenerated && (
                              <Badge variant="destructive">NF Cancelada</Badge>
                            )}
                            
                            {!receipt.isInvoiceIssued && receipt.isInvoiceGenerated && (
                              <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50">NF Gerada</Badge>
                            )}

                            {(receipt as any).isLandlordNfseIssued && (
                              <Badge variant="default" className="bg-amber-600 hover:bg-amber-700">NF Proprietário Emitida</Badge>
                            )}

                            {!(receipt as any).isLandlordNfseIssued && (receipt as any).isLandlordNfseGenerated && (
                              <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">NF Proprietário Gerada</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="icon" variant="ghost" onClick={() => openDetail(receipt)} title="Ver Detalhes">
                            <Eye className="h-4 w-4" />
                          </Button>

                          {receipt.status === "draft" && (
                            <>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                onClick={() => regenerateMutation.mutate(receipt.id)} 
                                disabled={isPending}
                                title="Regerar Recibo (Atualizar Valores)"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                onClick={() => closeReceiptMutation.mutate(receipt.id)} 
                                disabled={isPending}
                                title="Fechar Recibo"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          {receipt.status === "closed" && (
                            <>
                              {!receipt.isInvoiceIssued && (!receipt.isInvoiceGenerated || receipt.isInvoiceCancelled) && (
                                <>
                                  {!receipt.hasTransfer && (
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className="text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
                                      onClick={() => reopenReceiptMutation.mutate(receipt.id)} 
                                      disabled={isPending}
                                      title="Voltar para Rascunho"
                                    >
                                      <RotateCcw className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                    onClick={() => regenerateMutation.mutate(receipt.id)} 
                                    disabled={isPending}
                                    title="Regerar Recibo (Atualizar Valores)"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                              {!(receipt as any).isPaid && (
                                <PermissionGuard permission="mark_receipt_paid">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    onClick={() => {
                                      setPaymentDate(new Date().toISOString().split("T")[0]);
                                      setInterestValue("0,00");
                                      setMarkingPaidReceipt(receipt);
                                    }}
                                    disabled={isPending}
                                    title="Marcar como Pago"
                                  >
                                    <DollarSign className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}

                              {/* Botões de Boleto */}
                              {!receipt.isSlipIssued ? (
                                <PermissionGuard permission="issue_slip">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                    onClick={() => createSlipMutation.mutate(receipt.id)} 
                                    disabled={isPending}
                                    title="Emitir Boleto"
                                  >
                                    <Barcode className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              ) : (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-gray-600 hover:text-gray-700 hover:bg-gray-50"
                                    onClick={() => {
                                      setSelectedBoletoReceipt(receipt);
                                      setBoletoDetailsOpen(true);
                                    }}
                                    disabled={isPending}
                                    title="Ver Detalhes do Boleto"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => window.open(`/api/receipts/${receipt.id}/boleto-pdf`, '_blank')}
                                    disabled={isPending || !receipt.slipDigitableLine}
                                    title="Visualizar Boleto (PDF)"
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    onClick={() => handleShareWhatsApp(receipt)}
                                    disabled={isPending || !receipt.slipDigitableLine}
                                    title="Compartilhar no WhatsApp"
                                  >
                                    <MessageCircle className="h-4 w-4" />
                                  </Button>
                                  <PermissionGuard permission="issue_slip">
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => {
                                        if (confirm("Tem certeza que deseja cancelar este boleto?")) {
                                          cancelSlipMutation.mutate(receipt.id);
                                        }
                                      }}
                                      disabled={isPending}
                                      title="Cancelar Boleto"
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  </PermissionGuard>
                                </>
                              )}

                              {!receipt.hasTransfer && (
                                <PermissionGuard permission="generate_transfer">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => createTransferMutation.mutate(receipt.id)} 
                                    disabled={isPending}
                                    title="Gerar Repasse"
                                  >
                                    <Send className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}
                            </>
                          )}

                          {(receipt.status === "paid" || receipt.status === "transferred") && (
                            <>
                              {receipt.status === "paid" && !receipt.hasTransfer && (
                                <PermissionGuard permission="generate_transfer">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => createTransferMutation.mutate(receipt.id)} 
                                    disabled={isPending}
                                    title="Gerar Repasse"
                                  >
                                    <Send className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}

                              {/* Botões de Boleto */}
                              {!receipt.isSlipIssued ? (
                                <PermissionGuard permission="issue_slip">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => createSlipMutation.mutate(receipt.id)} 
                                    disabled={isPending}
                                    title="Emitir Boleto"
                                  >
                                    <Barcode className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              ) : (
                                <>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-gray-600 hover:text-gray-700 hover:bg-gray-50"
                                    onClick={() => {
                                      setSelectedBoletoReceipt(receipt);
                                      setBoletoDetailsOpen(true);
                                    }}
                                    disabled={isPending}
                                    title="Ver Detalhes do Boleto"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={() => window.open(`/api/receipts/${receipt.id}/boleto-pdf`, '_blank')}
                                    disabled={isPending || !receipt.slipDigitableLine}
                                    title="Visualizar Boleto (PDF)"
                                  >
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    onClick={() => handleShareWhatsApp(receipt)}
                                    disabled={isPending || !receipt.slipDigitableLine}
                                    title="Compartilhar no WhatsApp"
                                  >
                                    <MessageCircle className="h-4 w-4" />
                                  </Button>
                                  <PermissionGuard permission="issue_slip">
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      onClick={() => {
                                        if (confirm("Tem certeza que deseja cancelar este boleto?")) {
                                          cancelSlipMutation.mutate(receipt.id);
                                        }
                                      }}
                                      disabled={isPending}
                                      title="Cancelar Boleto"
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </Button>
                                  </PermissionGuard>
                                </>
                              )}

                              {receipt.status === "transferred" && !(receipt as any).isPaid && (
                                <PermissionGuard permission="mark_receipt_paid">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    onClick={() => {
                                      setPaymentDate(new Date().toISOString().split('T')[0]);
                                      setMarkingPaidReceipt(receipt);
                                    }} 
                                    disabled={isPending}
                                    title="Marcar como Pago"
                                  >
                                    <DollarSign className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}

{null}

                              {(receipt.status === "paid" || receipt.status === "transferred") && (
                                <PermissionGuard permission="issue_invoice">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                                    onClick={() => handleGenerateInvoiceClick(receipt)} 
                                    disabled={isPending || createInvoiceMutation.isPending}
                                    title="Gerar NF"
                                  >
                                    <FileCheck className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}

                              {(receipt.status === "paid" || receipt.status === "transferred") && getEligibleLandlordNfseOwners(receipt).length > 0 && (
                                <PermissionGuard permission="issue_invoice">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => handleGenerateLandlordNfseClick(receipt)}
                                    disabled={isPending || createLandlordNfseMutation.isPending}
                                    title="Gerar NFS-e do Proprietário"
                                  >
                                    <Printer className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}

                              {(receipt.status === "paid" || (receipt.status === "transferred" && (receipt as any).isPaid)) && (
                                <PermissionGuard permission="reverse_payment">
                                  <Button 
                                    size="icon" 
                                    variant="ghost" 
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => {
                                      if (confirm("Tem certeza que deseja estornar este recebimento? O lançamento no caixa será removido.")) {
                                        reversePaymentMutation.mutate(receipt.id);
                                      }
                                    }} 
                                    disabled={isPending}
                                    title="Estornar Pagamento"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                  </Button>
                                </PermissionGuard>
                              )}
                            </>
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
              <Receipt className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum recibo encontrado</h3>
              <p className="text-sm text-muted-foreground">Clique em "Gerar Recibos do Mês" para criar os recibos dos contratos ativos.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedReceipts.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white dark:bg-slate-900 border shadow-xl rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
          <span className="text-sm font-medium whitespace-nowrap">
            {selectedReceipts.size} selecionado{selectedReceipts.size > 1 ? 's' : ''}
          </span>
          <div className="h-4 w-px bg-border" />
          
          {/* Batch Emit Slip Button */}
          {receipts?.filter(r => selectedReceipts.has(r.id) && !r.isSlipIssued && r.status !== 'draft')?.length === selectedReceipts.size && (
             <PermissionGuard permission="issue_slip">
               <Button 
                size="sm" 
                onClick={() => batchEmitSlipMutation.mutate(Array.from(selectedReceipts))}
                disabled={batchEmitSlipMutation.isPending}
                className="rounded-full bg-orange-600 hover:bg-orange-700 text-white"
              >
                {batchEmitSlipMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileText className="mr-2 h-3 w-3" />}
                Emitir Boletos
              </Button>
            </PermissionGuard>
          )}

          {/* Batch Mark Paid Button */}
          {receipts?.filter(r => selectedReceipts.has(r.id) && (r.status === 'closed' || (r.status === 'transferred' && !(r as any).isPaid)))?.length === selectedReceipts.size && (
             <PermissionGuard permission="mark_receipt_paid">
               <Button 
                size="sm" 
                onClick={() => {
                  setPaymentDate(new Date().toISOString().split('T')[0]);
                  setInterestValue("0,00");
                  setIsBatchMarkingPaid(true);
                }}
                disabled={batchMarkPaidMutation.isPending}
                className="rounded-full bg-green-600 hover:bg-green-700 text-white"
              >
                {batchMarkPaidMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <DollarSign className="mr-2 h-3 w-3" />}
                Marcar Pago
              </Button>
            </PermissionGuard>
          )}

          {/* Batch Transfer Button */}
          {receipts?.filter(r => selectedReceipts.has(r.id) && (r.status === 'paid' || r.status === 'closed') && !r.hasTransfer)?.length === selectedReceipts.size && (
            <PermissionGuard permission="generate_transfer">
              <Button 
                size="sm" 
                onClick={() => batchTransferMutation.mutate(Array.from(selectedReceipts))}
                disabled={batchTransferMutation.isPending}
                className="rounded-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {batchTransferMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Send className="mr-2 h-3 w-3" />}
                Gerar Repasses
              </Button>
            </PermissionGuard>
          )}

          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full hover:bg-muted"
            onClick={() => setSelectedReceipts(new Set())}
            title="Cancelar seleção"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalhes do Recibo</DialogTitle>
            <DialogDescription>
              {selectedReceipt && `Referência: ${String(selectedReceipt.refMonth).padStart(2, "0")}/${selectedReceipt.refYear}`}
            </DialogDescription>
          </DialogHeader>
          {selectedReceipt && (
            <div className="space-y-4">
              <div className="grid gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Imóvel:</span>
                  <span className="font-medium">{getContractInfo(selectedReceipt.contractId).property}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Locatário:</span>
                  <span>{getContractInfo(selectedReceipt.contractId).tenant}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Proprietário:</span>
                  <span>{getContractInfo(selectedReceipt.contractId).landlord}</span>
                </div>
              </div>
              <Separator />
              <div className="grid gap-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Aluguel:</span>
                  <span>R$ {Number(selectedReceipt.rentAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm items-center h-8">
                  <span className="text-muted-foreground">Vencimento:</span>
                  <div className="flex items-center gap-2">
                    {editingDueDate ? (
                      <div className="flex items-center gap-1">
                        <Input
                          type="date"
                          className="h-7 w-36 text-sm"
                          value={dueDateValue}
                          onChange={(e) => setDueDateValue(e.target.value)}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                          onClick={() => {
                            if (dueDateValue) {
                              updateDueDateMutation.mutate({ id: selectedReceipt.id, dueDate: dueDateValue });
                            }
                          }}
                          disabled={updateDueDateMutation.isPending}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setEditingDueDate(false)}
                        >
                          <XCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        {selectedReceipt.status !== "paid" && selectedReceipt.status !== "transferred" && !selectedReceipt.isSlipIssued && canEditReceiptField("dueDate") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-50 hover:opacity-100"
                            onClick={() => {
                              const raw = selectedReceipt.dueDate ? String(selectedReceipt.dueDate) : "";
                              let base = raw;
                              if (raw && raw.includes("T")) {
                                base = raw.split("T")[0];
                              }
                              setDueDateValue(base);
                              setEditingDueDate(true);
                            }}
                            title="Editar Vencimento"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                        <span className="font-medium">
                          {formatDate(selectedReceipt.dueDate)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex justify-between text-sm items-center h-8">
                  <span className="text-muted-foreground">Taxa Administração ({Number(selectedReceipt.adminFeePercent)}%):</span>
                  <div className="flex items-center gap-2">
                    {editingAdminFee ? (
                      <div className="flex items-center gap-1">
                        <Input 
                          type="number" 
                          step="0.01" 
                          className="h-7 w-24 text-right px-2"
                          value={adminFeeValue}
                          onChange={(e) => setAdminFeeValue(e.target.value)}
                        />
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                          onClick={() => updateAdminFeeMutation.mutate({ id: selectedReceipt.id, amount: adminFeeValue })}
                          disabled={updateAdminFeeMutation.isPending}
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setEditingAdminFee(false)}
                        >
                          <XCircle className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        {selectedReceipt.status === 'draft' && canEditReceiptField("adminFeeAmount") && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 opacity-50 hover:opacity-100" 
                            onClick={() => {
                              setAdminFeeValue(selectedReceipt.adminFeeAmount);
                              setEditingAdminFee(true);
                            }}
                            title="Editar Taxa"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                        <DynamicAdminFee 
                          receipt={selectedReceipt} 
                        />
                      </>
                    )}
                  </div>
                </div>
                {(() => {
                  const contract = contracts?.find(c => c.id === selectedReceipt.contractId);
                  const property = contract ? properties?.find(p => p.id === contract.propertyId) : undefined;
                  const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
                  const owners =
                    Array.isArray(sharesRaw) && sharesRaw.length > 0
                      ? sharesRaw
                          .filter(s => !!s.landlordId && Number(s.percent) > 0)
                          .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
                      : contract?.landlordId
                        ? [{ landlordId: contract.landlordId, percent: 100 }]
                        : [];
                  const hasMultiOwners = owners.length > 1;
                  const hasTransfers = Array.isArray((selectedReceipt as any).transferSplits) && (selectedReceipt as any).transferSplits.length > 0;
                  if (!hasMultiOwners || hasTransfers) return null;
                  const override = (selectedReceipt as any).landlordSplitOverride as Array<{ landlordId: string; amount: number }> | undefined;
                  return (
                    <div className="flex justify-between text-sm items-center">
                      <span className="text-muted-foreground">Rateio (pré-ajuste):</span>
                      <div className="flex items-center gap-2">
                        {Array.isArray(override) && override.length > 0 && (
                          <span className="text-xs text-muted-foreground">(ajuste salvo)</span>
                        )}
                        <PermissionGuard permission="generate_transfer">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-60 hover:opacity-100"
                            onClick={() => {
                              const baseTotal = Number(selectedReceipt.landlordTotalDue);
                              const percentMap = new Map(owners.map(o => [o.landlordId, o.percent]));
                              let items: Array<{ landlordId: string; amount: string }> = [];
                              if (Array.isArray(override) && override.length > 0) {
                                items = owners.map(o => {
                                  const found = override.find(or => or.landlordId === o.landlordId);
                                  return { landlordId: o.landlordId, amount: (found ? found.amount : 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) };
                                });
                              } else {
                                const totalCents = Math.round(baseTotal * 100);
                                const sumPercent = owners.reduce((sum, o) => sum + Number(o.percent || 0), 0);
                                const parts = owners.map(o => {
                                  const raw = (totalCents * o.percent) / sumPercent;
                                  return { landlordId: o.landlordId, floor: Math.floor(raw), remainder: raw - Math.floor(raw) };
                                });
                                const sumFloor = parts.reduce((sum, p) => sum + p.floor, 0);
                                let remaining = totalCents - sumFloor;
                                const sorted = [...parts].sort((a, b) => b.remainder - a.remainder);
                                for (let i = 0; i < sorted.length && remaining > 0; i++) {
                                  sorted[i].floor += 1;
                                  remaining -= 1;
                                }
                                items = sorted.map(p => ({ landlordId: p.landlordId, amount: (p.floor / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) }));
                              }
                              setRateioBaseTotal(baseTotal);
                              setRateioEditItems(items.map(i => ({ id: i.landlordId, landlordId: i.landlordId, amount: i.amount })));
                              setRateioEditReceipt(selectedReceipt);
                              setRateioEditOpen(true);
                            }}
                            title="Editar rateio (pré repasse)"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </PermissionGuard>
                      </div>
                    </div>
                  );
                })()}
                {Array.isArray((selectedReceipt as any).transferSplits) && (selectedReceipt as any).transferSplits.length > 0 && (
                  <div className="flex justify-between text-sm items-center">
                    <span className="text-muted-foreground">Repasse (Rateio):</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        R${" "}
                        {(selectedReceipt as any).transferSplits
                          .reduce((sum: number, s: any) => sum + Number(s.amount), 0)
                          .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                      {(selectedReceipt as any).transferSplits.length > 1 &&
                        (selectedReceipt as any).transferSplits.every((s: any) => s.status === "pending") && (
                        <PermissionGuard permission="generate_transfer">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-60 hover:opacity-100"
                            onClick={() => handleEditRateioClick(selectedReceipt)}
                            title="Editar rateio do repasse"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </PermissionGuard>
                      )}
                    </div>
                  </div>
                )}
                {Number(selectedReceipt.servicesTenantTotal) !== 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {Number(selectedReceipt.servicesTenantTotal) > 0 ? "Serviços/Despesas (Locatário):" : "Créditos/Ajustes (Locatário):"}
                    </span>
                    <span className={Number(selectedReceipt.servicesTenantTotal) < 0 ? "text-green-600" : ""}>
                      {Number(selectedReceipt.servicesTenantTotal) > 0 ? "+" : ""} R$ {Number(selectedReceipt.servicesTenantTotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                
                {Number(selectedReceipt.servicesLandlordTotal) !== 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {Number(selectedReceipt.servicesLandlordTotal) > 0 ? "Serviços/Despesas (Proprietário):" : "Créditos/Ajustes (Proprietário):"}
                    </span>
                    <span className={Number(selectedReceipt.servicesLandlordTotal) < 0 ? "text-green-600" : ""}>
                       {Number(selectedReceipt.servicesLandlordTotal) < 0 ? "+" : "-"} R$ {Math.abs(Number(selectedReceipt.servicesLandlordTotal)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                
                {/* Detalhes dos serviços e ajustes */}
                <ReceiptServicesDetail 
                  receiptId={selectedReceipt.id} 
                  contractId={selectedReceipt.contractId} 
                  year={selectedReceipt.refYear} 
                  month={selectedReceipt.refMonth}
                  storedTenantTotal={Number(selectedReceipt.servicesTenantTotal)}
                  storedLandlordTotal={Number(selectedReceipt.servicesLandlordTotal)}
                  isReadOnly={selectedReceipt.status !== 'draft'}
                  onReceiptUpdated={setSelectedReceipt}
                />
              </div>
              <Separator />
              <div className="grid gap-2">
                <div className="flex justify-between font-medium">
                  <span>Total a pagar (Locatário):</span>
                  <DynamicTenantTotal receipt={selectedReceipt} />
                </div>
                <div className="flex justify-between font-medium">
                  <span>Total a repassar (Proprietário):</span>
                  {(() => {
                    const contract = contracts?.find(c => c.id === selectedReceipt.contractId);
                    const property = contract ? properties?.find(p => p.id === contract.propertyId) : undefined;
                    const sharesRaw = ((property as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
                    const landlordShares = Array.isArray(sharesRaw) && sharesRaw.length > 0
                      ? sharesRaw
                          .filter(s => !!s.landlordId && Number(s.percent) > 0)
                          .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) }))
                      : contract?.landlordId
                        ? [{ landlordId: contract.landlordId, percent: 100 }]
                        : [];
                    const landlordNamesById = new Map((landlords || []).map(l => [l.id, l.name]));
                    return <DynamicLandlordTotal receipt={selectedReceipt} landlordShares={landlordShares} landlordNamesById={landlordNamesById} />;
                  })()}
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Status:</span>
                {selectedReceipt.status === 'transferred' && (
                  <Badge variant="default" className="bg-green-600 hover:bg-green-700 mr-1">Pago</Badge>
                )}
                <Badge variant={statusLabels[selectedReceipt.status]?.variant || "secondary"}>
                  {statusLabels[selectedReceipt.status]?.label || selectedReceipt.status}
                </Badge>
                {selectedReceipt.isSlipIssued && (
                  <Badge variant="default" className="bg-indigo-600 hover:bg-indigo-700">Boleto Emitido</Badge>
                )}
                {selectedReceipt.isInvoiceIssued && (
                  <Badge variant="default" className="bg-purple-600 hover:bg-purple-700">NF Emitida</Badge>
                )}
                {selectedReceipt.isInvoiceCancelled && !selectedReceipt.isInvoiceIssued && !selectedReceipt.isInvoiceGenerated && (
                  <Badge variant="destructive">NF Cancelada</Badge>
                )}
                {!selectedReceipt.isInvoiceIssued && selectedReceipt.isInvoiceGenerated && (
                  <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50">NF Gerada</Badge>
                )}
                {(selectedReceipt as any).isLandlordNfseIssued && (
                  <Badge variant="default" className="bg-amber-600 hover:bg-amber-700">NF Proprietário Emitida</Badge>
                )}
                {!(selectedReceipt as any).isLandlordNfseIssued && (selectedReceipt as any).isLandlordNfseGenerated && (
                  <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">NF Proprietário Gerada</Badge>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {selectedReceipt && (
              <>
                <Button
                  variant="outline"
                  onClick={() =>
                    window.open(
                      `/receipts/${selectedReceipt.id}/print?type=tenant`,
                      "_blank",
                    )
                  }
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir (Locatário)
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    window.open(
                      `/receipts/${selectedReceipt.id}/print?type=landlord`,
                      "_blank",
                    )
                  }
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir (Proprietário)
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedBoletoReceipt && (
        <Dialog open={boletoDetailsOpen} onOpenChange={setBoletoDetailsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Detalhes do Boleto</DialogTitle>
              <DialogDescription>
                Informações para pagamento
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label>Nosso Número</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={selectedBoletoReceipt.slipOurNumber || ''} />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedBoletoReceipt.slipOurNumber || '');
                      toast({ title: "Copiado", description: "Nosso Número copiado para a área de transferência." });
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Linha Digitável</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={selectedBoletoReceipt.slipDigitableLine || ''} />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedBoletoReceipt.slipDigitableLine || '');
                      toast({ title: "Copiado", description: "Linha Digitável copiada para a área de transferência." });
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Código de Barras</Label>
                <div className="flex items-center gap-2">
                  <Input readOnly value={selectedBoletoReceipt.slipBarcode || ''} />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedBoletoReceipt.slipBarcode || '');
                      toast({ title: "Copiado", description: "Código de Barras copiado para a área de transferência." });
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={invoiceSelectionOpen} onOpenChange={(open) => {
        setInvoiceSelectionOpen(open);
        if (!open) {
          setInvoiceSelectionReceipt(null);
          setInvoiceSelectionOwners([]);
          setInvoiceSelectionSelected(new Set());
          setInvoiceSelectionMode("administracao");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {invoiceSelectionMode === "landlordNfse" ? "Gerar NFS-e do Proprietário" : "Gerar NF por Proprietário"}
            </DialogTitle>
            <DialogDescription>
              {invoiceSelectionMode === "landlordNfse"
                ? "Selecione os proprietários habilitados para gerar a NFS-e própria. A base considera aluguel + IPTU + condomínio, sem seguro."
                : "Selecione os proprietários para gerar NFS-e (valor proporcional à taxa de administração)."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            {invoiceSelectionOwners.map((o) => {
              const name = o.name || landlords?.find(l => l.id === o.landlordId)?.name || "-";
              const checked = invoiceSelectionSelected.has(o.landlordId);
              return (
                <label key={o.landlordId} className="flex items-center gap-3 rounded-md border p-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      setInvoiceSelectionSelected(prev => {
                        const next = new Set(prev);
                        if (!!value) next.add(o.landlordId);
                        else next.delete(o.landlordId);
                        return next;
                      });
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{name}</div>
                    <div className="text-sm text-muted-foreground">
                      {Number(o.percent).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setInvoiceSelectionOpen(false);
                setInvoiceSelectionReceipt(null);
                setInvoiceSelectionOwners([]);
                setInvoiceSelectionSelected(new Set());
                setInvoiceSelectionMode("administracao");
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!invoiceSelectionReceipt) return;
                const payload = {
                  id: invoiceSelectionReceipt.id,
                  landlordIds: Array.from(invoiceSelectionSelected),
                };
                if (invoiceSelectionMode === "landlordNfse") {
                  createLandlordNfseMutation.mutate(payload);
                  return;
                }
                createInvoiceMutation.mutate(payload);
              }}
              disabled={createInvoiceMutation.isPending || createLandlordNfseMutation.isPending || invoiceSelectionSelected.size === 0}
            >
              {(createInvoiceMutation.isPending || createLandlordNfseMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {invoiceSelectionMode === "landlordNfse" ? "Gerar NFS-e do Proprietário" : "Gerar NF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rateioEditOpen} onOpenChange={(open) => {
        setRateioEditOpen(open);
        if (!open) {
          setRateioEditReceipt(null);
          setRateioEditItems([]);
          setRateioBaseTotal(0);
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar Rateio do Repasse</DialogTitle>
            <DialogDescription>
              Ajuste os valores por proprietário. A soma precisa permanecer igual ao total atual do repasse.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proprietário</TableHead>
                  <TableHead className="text-right w-[160px]">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rateioEditItems.map((item, idx) => {
                  const name = landlords?.find(l => l.id === item.landlordId)?.name || "-";
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="text-right">
                        <Input
                          className="h-8 text-right tabular-nums"
                          value={item.amount}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9,.-]/g, "");
                            setRateioEditItems(prev => prev.map((r, i) => (i === idx ? { ...r, amount: value } : r)));
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total atual:</span>
              <span className="font-medium tabular-nums">
                R$ {rateioBaseTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Soma informada:</span>
              <span
                className={[
                  "font-medium tabular-nums",
                  Math.abs(
                    rateioEditItems.reduce((sum, i) => {
                      const parsed = parseAmountInput(i.amount);
                      return sum + (Number.isFinite(parsed) ? parsed : 0);
                    }, 0) - rateioBaseTotal
                  ) > 0.01
                    ? "text-destructive"
                    : "",
                ].join(" ")}
              >
                R${" "}
                {rateioEditItems
                  .reduce((sum, i) => {
                    const parsed = parseAmountInput(i.amount);
                    return sum + (Number.isFinite(parsed) ? parsed : 0);
                  }, 0)
                  .toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRateioEditOpen(false);
                setRateioEditReceipt(null);
                setRateioEditItems([]);
                setRateioBaseTotal(0);
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!rateioEditReceipt) return;
                const total = rateioEditItems.reduce((sum, i) => {
                  const parsed = parseAmountInput(i.amount);
                  return sum + (Number.isFinite(parsed) ? parsed : 0);
                }, 0);
                if (Math.abs(total - rateioBaseTotal) > 0.01) {
                  toast({ title: "Erro", description: "A soma do rateio precisa bater com o total atual do repasse.", variant: "destructive" });
                  return;
                }
                if ((rateioEditReceipt as any).transferSplits?.length > 0) {
                  // Editar repasse já criado
                  updateTransferSplitsMutation.mutate({
                    receiptId: rateioEditReceipt.id,
                    splits: rateioEditItems.map(i => ({
                      id: i.id,
                      amount: parseAmountInput(i.amount),
                    })),
                  });
                } else {
                  // Pré-ajuste (antes do repasse)
                  apiRequest("PATCH", `/api/receipts/${rateioEditReceipt.id}/split-override`, {
                    splits: rateioEditItems.map(i => ({
                      landlordId: i.landlordId,
                      amount: parseAmountInput(i.amount),
                    })),
                  })
                    .then(() => {
                      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
                      setRateioEditOpen(false);
                      setRateioEditReceipt(null);
                      setRateioEditItems([]);
                      setRateioBaseTotal(0);
                      toast({ title: "Sucesso", description: "Rateio prévio salvo. Ele será aplicado na geração do repasse." });
                    })
                    .catch(async (err) => {
                      toast({ title: "Erro", description: err.message || "Falha ao salvar rateio.", variant: "destructive" });
                    });
                }
              }}
              disabled={updateTransferSplitsMutation.isPending}
            >
              {updateTransferSplitsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!markingPaidReceipt || isBatchMarkingPaid} onOpenChange={(open) => {
        if (!open) {
          setMarkingPaidReceipt(null);
          setIsBatchMarkingPaid(false);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Pagamento {isBatchMarkingPaid ? '(Em Lote)' : ''}</DialogTitle>
            <DialogDescription>
              Informe a data do pagamento{isBatchMarkingPaid ? ` para os ${selectedReceipts.size} recibos selecionados` : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="payment-date" className="text-right">
                Data
              </Label>
              <Input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="col-span-3"
              />
            </div>
            {!isBatchMarkingPaid && (
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="interest" className="text-right">
                  Juros (R$)
                </Label>
                <Input
                  id="interest"
                  value={interestValue}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9,]/g, '');
                    setInterestValue(value);
                  }}
                  className="col-span-3"
                  placeholder="0,00"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setMarkingPaidReceipt(null);
              setIsBatchMarkingPaid(false);
            }}>
              Cancelar
            </Button>
            <Button 
              onClick={() => {
                if (markingPaidReceipt) {
                  const interest = parseFloat(interestValue.replace(',', '.').replace(/[^0-9.]/g, '')) || 0;
                  markPaidMutation.mutate({ id: markingPaidReceipt.id, date: paymentDate, interest });
                } else if (isBatchMarkingPaid) {
                  batchMarkPaidMutation.mutate({ receiptIds: Array.from(selectedReceipts), date: paymentDate });
                }
              }}
              disabled={markPaidMutation.isPending || batchMarkPaidMutation.isPending}
            >
              {(markPaidMutation.isPending || batchMarkPaidMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar Pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
