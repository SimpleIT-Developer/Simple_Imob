import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Building2, Loader2, MapPin } from "lucide-react";
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
import { PermissionGuard } from "@/components/permission-guard";
import { useAuth } from "@/hooks/use-auth";
import type { Property, Landlord } from "@shared/schema";
import {
  hasAnyPropertyFieldPermission,
  hasPropertyFieldPermission,
  type PropertyEditableFieldKey,
} from "@shared/field-permissions";

const cepCache = new Map<string, any>();

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  available: { label: "Disponível", variant: "default" },
  documentation_in_progress: { label: "Documentação em Andamento", variant: "secondary" },
  inspection: { label: "Vistoria", variant: "secondary" },
  contract: { label: "Contrato", variant: "secondary" },
  available_for_signature: { label: "Disponível para Assinatura", variant: "secondary" },
  rented: { label: "Alugado", variant: "secondary" },
  maintenance: { label: "Manutenção", variant: "destructive" },
};

function normalizeTextValue(value: unknown) {
  return value == null ? "" : String(value);
}

function areLandlordSharesEqual(
  left: Array<{ landlordId: string; percent: number }>,
  right: Array<{ landlordId: string; percent: number }>,
) {
  if (left.length !== right.length) return false;

  return left.every((item, index) => {
    const other = right[index];
    return !!other && item.landlordId === other.landlordId && Number(item.percent) === Number(other.percent);
  });
}

export default function PropertiesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestedCode, setSuggestedCode] = useState("");
  const [selectedLandlordId, setSelectedLandlordId] = useState<string>("");
  const [landlordShares, setLandlordShares] = useState<Array<{ landlordId: string; percent: string }>>([]);
  const [landlordToAdd, setLandlordToAdd] = useState<string>("");
  const [title, setTitle] = useState("");
  const [addressData, setAddressData] = useState({
    address: "",
    neighborhood: "",
    city: "",
    state: "",
    zipCode: ""
  });
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (isDialogOpen) {
      setSelectedLandlordId(editingProperty?.landlordId || "");
      const existingShares = (editingProperty as any)?.landlordShares as Array<{ landlordId: string; percent: number }> | undefined;
      if (Array.isArray(existingShares) && existingShares.length > 0) {
        setLandlordShares(existingShares.map(s => ({ landlordId: s.landlordId, percent: String(s.percent) })));
      } else if (editingProperty?.landlordId) {
        setLandlordShares([{ landlordId: editingProperty.landlordId, percent: "100" }]);
      } else {
        setLandlordShares([]);
      }
      setLandlordToAdd("");
      setTitle(editingProperty?.title || "");
      setAddressData({
        address: editingProperty?.address || "",
        neighborhood: editingProperty?.neighborhood || "",
        city: editingProperty?.city || "",
        state: editingProperty?.state || "",
        zipCode: editingProperty?.zipCode || ""
      });
    } else {
      // Reset form when dialog closes
      setTitle("");
      setSelectedLandlordId("");
      setLandlordShares([]);
      setLandlordToAdd("");
      setAddressData({
        address: "",
        neighborhood: "",
        city: "",
        state: "",
        zipCode: ""
      });
    }
  }, [isDialogOpen, editingProperty]);

  const handleCepBlur = async (e: React.FocusEvent<HTMLInputElement>) => {
    const cep = e.target.value.replace(/\D/g, "");
    if (cep.length === 8) {
      try {
        let data: any | null = null;
        const cached = cepCache.get(cep);
        if (cached) data = cached;
        if (!data) {
          const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
          if (res.ok) {
            const via = await res.json();
            if (!via.erro) {
              data = { logradouro: via.logradouro, bairro: via.bairro, localidade: via.localidade, uf: via.uf };
            }
          }
        }
        if (!data) {
          const res2 = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`);
          if (res2.ok) {
            const br = await res2.json();
            if (!br.errors) {
              data = { logradouro: br.street, bairro: br.neighborhood, localidade: br.city, uf: br.state };
            }
          }
        }
        if (data) {
          cepCache.set(cep, data);
          setAddressData(prev => ({
            ...prev,
            address: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf,
            zipCode: e.target.value
          }));
          toast({ title: "Endereço encontrado", description: "Campos preenchidos automaticamente." });
        } else {
          toast({ title: "Erro", description: "CEP não encontrado.", variant: "destructive" });
        }
      } catch (error) {
        toast({ title: "Erro", description: "Serviço de CEP indisponível no momento.", variant: "destructive" });
      }
    }
  };

  const { data: properties, isLoading } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: landlords } = useQuery<Landlord[]>({ queryKey: ["/api/landlords"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/properties", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Imóvel cadastrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/properties/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setIsDialogOpen(false);
      setEditingProperty(null);
      toast({ title: "Sucesso", description: "Imóvel atualizado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/properties/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Sucesso", description: "Imóvel excluído com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const canEditShares = canEditPropertyField("landlordShares");
    const sharesForValidation = editingProperty && !canEditShares
      ? getExistingLandlordShares().map((item) => ({ landlordId: item.landlordId, percent: String(item.percent) }))
      : landlordShares;

    const totalPercent = sharesForValidation.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);
    if (sharesForValidation.length > 0 && Math.abs(totalPercent - 100) > 0.01) {
      toast({
        title: "Percentual inválido",
        description: "A soma das porcentagens dos proprietários deve ser 100%.",
        variant: "destructive",
      });
      return;
    }

    const normalizedShares = sharesForValidation
      .map(s => ({ landlordId: s.landlordId, percent: Number(s.percent) || 0 }))
      .filter(s => !!s.landlordId && s.percent > 0);
    const landlordIdFromShares = normalizedShares.length > 0 ? normalizedShares[0].landlordId : null;

    if (editingProperty) {
      const data: Record<string, any> = {};
      const existingShares = getExistingLandlordShares().map((item) => ({
        landlordId: item.landlordId,
        percent: Number(item.percent) || 0,
      }));

      const nextValues = {
        code: formData.get("code") as string,
        title,
        type: formData.get("type") as string,
        saleRent: formData.get("saleRent") as string,
        address: addressData.address,
        neighborhood: addressData.neighborhood,
        city: addressData.city,
        state: addressData.state,
        zipCode: addressData.zipCode,
        rentDefault: formData.get("rentDefault") as string,
        status: formData.get("status") as string,
      };

      if (canEditPropertyField("code") && nextValues.code !== editingProperty.code) data.code = nextValues.code;
      if (canEditPropertyField("title") && nextValues.title !== editingProperty.title) data.title = nextValues.title;
      if (canEditPropertyField("type") && normalizeTextValue(nextValues.type) !== normalizeTextValue(editingProperty.type)) data.type = nextValues.type;
      if (canEditPropertyField("saleRent") && normalizeTextValue(nextValues.saleRent) !== normalizeTextValue(editingProperty.saleRent)) data.saleRent = nextValues.saleRent;
      if (canEditPropertyField("address") && nextValues.address !== editingProperty.address) data.address = nextValues.address;
      if (canEditPropertyField("neighborhood") && normalizeTextValue(nextValues.neighborhood) !== normalizeTextValue(editingProperty.neighborhood)) data.neighborhood = nextValues.neighborhood;
      if (canEditPropertyField("city") && nextValues.city !== editingProperty.city) data.city = nextValues.city;
      if (canEditPropertyField("state") && nextValues.state !== editingProperty.state) data.state = nextValues.state;
      if (canEditPropertyField("zipCode") && normalizeTextValue(nextValues.zipCode) !== normalizeTextValue(editingProperty.zipCode)) data.zipCode = nextValues.zipCode;
      if (canEditPropertyField("rentDefault") && Number(nextValues.rentDefault) !== Number(editingProperty.rentDefault)) data.rentDefault = nextValues.rentDefault;
      if (canEditPropertyField("status") && nextValues.status !== editingProperty.status) data.status = nextValues.status;
      if (canEditShares && (!areLandlordSharesEqual(normalizedShares, existingShares) || landlordIdFromShares !== (editingProperty.landlordId ?? null))) {
        data.landlordShares = normalizedShares;
      }

      if (Object.keys(data).length === 0) {
        toast({ title: "Nenhuma alteração", description: "Nenhum campo foi alterado." });
        return;
      }

      updateMutation.mutate({ id: editingProperty.id, data });
    } else {
      const data = {
        code: formData.get("code") as string,
        title: title,
        type: formData.get("type") as string,
        saleRent: formData.get("saleRent") as string,
        address: addressData.address,
        neighborhood: addressData.neighborhood,
        city: addressData.city,
        state: addressData.state,
        zipCode: addressData.zipCode,
        rentDefault: formData.get("rentDefault") as string,
        landlordId: landlordIdFromShares,
        landlordShares: normalizedShares,
        status: formData.get("status") as string,
      };
      createMutation.mutate(data);
    }
  };

  const openNewDialog = async () => {
    setEditingProperty(null);
    try {
      const response = await apiRequest("GET", "/api/properties/next-code");
      const data = await response.json();
      setSuggestedCode(data.code);
    } catch (error) {
      console.error("Erro ao buscar código sugerido:", error);
      setSuggestedCode("");
    }
    setIsDialogOpen(true);
  };

  const filteredProperties = properties?.filter(
    (p) =>
      p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.address.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === "admin";
  const canEditAnyPropertyField = isAdmin || (
    userPermissions.includes("edit_property") && hasAnyPropertyFieldPermission(userPermissions)
  );

  const canEditPropertyField = (field: PropertyEditableFieldKey) => {
    if (!editingProperty) return true;
    if (isAdmin) return true;
    if (!userPermissions.includes("edit_property")) return false;
    return hasPropertyFieldPermission(userPermissions, field);
  };

  const getExistingLandlordShares = () => {
    if (!editingProperty) return [];
    const existingShares = (editingProperty as any).landlordShares as Array<{ landlordId: string; percent: number }> | undefined;
    if (Array.isArray(existingShares) && existingShares.length > 0) {
      return existingShares;
    }
    if (editingProperty.landlordId) {
      return [{ landlordId: editingProperty.landlordId, percent: 100 }];
    }
    return [];
  };

  const getLandlordName = (property: Property) => {
    const shares = ((property as any).landlordShares as Array<{ landlordId: string; percent: number }> | undefined) || [];
    if (Array.isArray(shares) && shares.length > 0) {
      return shares
        .map(s => {
          const name = landlords?.find(l => l.id === s.landlordId)?.name || "-";
          return `${name} (${Number(s.percent).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`;
        })
        .join(" + ");
    }
    if (!property.landlordId) return "-";
    return landlords?.find((l) => l.id === property.landlordId)?.name || "-";
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Imóveis</h1>
          <p className="text-muted-foreground">Gerencie os imóveis cadastrados</p>
        </div>
        <PermissionGuard permission="create_property">
          <Button onClick={openNewDialog} data-testid="button-new-property">
            <Plus className="mr-2 h-4 w-4" />
            Novo Imóvel
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Lista de Imóveis
              </CardTitle>
              <CardDescription>{properties?.length || 0} imóveis cadastrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-properties" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredProperties && filteredProperties.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Título</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="hidden md:table-cell">Endereço</TableHead>
                    <TableHead className="hidden lg:table-cell">Proprietário</TableHead>
                    <TableHead>Aluguel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProperties.map((property) => (
                    <TableRow key={property.id} data-testid={`row-property-${property.id}`}>
                      <TableCell className="font-mono text-sm">{property.code}</TableCell>
                      <TableCell className="font-medium">{property.title}</TableCell>
                      <TableCell>{property.type || "-"}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-col">
                          <span className="truncate max-w-[250px] font-medium">{property.address}</span>
                          <span className="truncate max-w-[250px] text-xs text-muted-foreground">
                            {property.neighborhood ? `${property.neighborhood} - ` : ""}{property.city}/{property.state}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{getLandlordName(property)}</TableCell>
                      <TableCell className="font-medium">R$ {Number(property.rentDefault).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        <Badge variant={statusLabels[property.status]?.variant || "secondary"}>
                          {statusLabels[property.status]?.label || property.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canEditAnyPropertyField && (
                            <Button size="icon" variant="ghost" onClick={() => { setEditingProperty(property); setIsDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <PermissionGuard permission="delete_property">
                            <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(property.id)}>
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
              <Building2 className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum imóvel encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo imóvel.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingProperty ? "Editar Imóvel" : "Novo Imóvel"}</DialogTitle>
            <DialogDescription>{editingProperty ? "Atualize os dados do imóvel." : "Preencha os dados do novo imóvel."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden" key={editingProperty ? editingProperty.id : 'new'}>
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="code">Código *</Label>
                <Input 
                  id="code" 
                  name="code" 
                  key={editingProperty ? `edit-${editingProperty.id}` : `new-${suggestedCode}`}
                  defaultValue={editingProperty?.code || suggestedCode} 
                  required 
                  disabled={!canEditPropertyField("code")}
                  data-testid="input-property-code" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saleRent">Aluguel/Venda</Label>
                <Select name="saleRent" defaultValue={editingProperty?.saleRent || "Aluguel"} disabled={!canEditPropertyField("saleRent")}>
                  <SelectTrigger disabled={!canEditPropertyField("saleRent")}>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Aluguel">Aluguel</SelectItem>
                    <SelectItem value="Venda">Venda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="title">Título *</Label>
              <Input 
                id="title" 
                name="title" 
                value={title}
                onChange={(e) => {
                  const newTitle = e.target.value;
                  setTitle(newTitle);
                  if (!editingProperty) {
                    setAddressData(prev => ({ ...prev, address: newTitle }));
                  }
                }}
                required 
                disabled={!canEditPropertyField("title")}
                data-testid="input-property-title" 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Tipo do Imóvel</Label>
              <Select name="type" defaultValue={editingProperty?.type || ""} disabled={!canEditPropertyField("type")}>
                <SelectTrigger data-testid="select-property-type" disabled={!canEditPropertyField("type")}>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RESIDENCIAL">RESIDENCIAL</SelectItem>
                  <SelectItem value="COMERCIAL">COMERCIAL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-12">
               <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="zipCode">CEP</Label>
                <Input 
                  id="zipCode" 
                  name="zipCode" 
                  value={addressData.zipCode} 
                  onChange={(e) => setAddressData(prev => ({ ...prev, zipCode: e.target.value }))}
                  onBlur={handleCepBlur}
                  placeholder="00000-000"
                  disabled={!canEditPropertyField("zipCode")}
                />
              </div>
              <div className="space-y-2 sm:col-span-9">
                <Label htmlFor="address">Endereço *</Label>
                <Input 
                  id="address" 
                  name="address" 
                  value={addressData.address}
                  onChange={(e) => setAddressData(prev => ({ ...prev, address: e.target.value }))}
                  required 
                  disabled={!canEditPropertyField("address")}
                  data-testid="input-property-address" 
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-12">
              <div className="space-y-2 sm:col-span-5">
                <Label htmlFor="neighborhood">Bairro</Label>
                <Input 
                  id="neighborhood" 
                  name="neighborhood" 
                  value={addressData.neighborhood} 
                  onChange={(e) => setAddressData(prev => ({ ...prev, neighborhood: e.target.value }))}
                  disabled={!canEditPropertyField("neighborhood")}
                />
              </div>
              <div className="space-y-2 sm:col-span-5">
                <Label htmlFor="city">Cidade *</Label>
                <Input 
                  id="city" 
                  name="city" 
                  value={addressData.city} 
                  onChange={(e) => setAddressData(prev => ({ ...prev, city: e.target.value }))}
                  required 
                  disabled={!canEditPropertyField("city")}
                  data-testid="input-property-city" 
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="state">Estado *</Label>
                <Input 
                  id="state" 
                  name="state" 
                  value={addressData.state} 
                  onChange={(e) => setAddressData(prev => ({ ...prev, state: e.target.value }))}
                  required 
                  disabled={!canEditPropertyField("state")}
                  data-testid="input-property-state" 
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rentDefault">Aluguel Padrão (R$) *</Label>
                <Input id="rentDefault" name="rentDefault" type="number" step="0.01" defaultValue={editingProperty?.rentDefault} required disabled={!canEditPropertyField("rentDefault")} data-testid="input-property-rent" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status *</Label>
                <Select name="status" defaultValue={editingProperty?.status || "available"} disabled={!canEditPropertyField("status")}>
                  <SelectTrigger data-testid="select-property-status" disabled={!canEditPropertyField("status")}>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Disponível</SelectItem>
                    <SelectItem value="documentation_in_progress">Documentação em Andamento</SelectItem>
                    <SelectItem value="inspection">Vistoria</SelectItem>
                    <SelectItem value="contract">Contrato</SelectItem>
                    <SelectItem value="available_for_signature">Disponível para Assinatura</SelectItem>
                    <SelectItem value="rented">Alugado</SelectItem>
                    <SelectItem value="maintenance">Manutenção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Proprietários e Porcentagens</Label>
              <div className="flex gap-2 items-start">
                <div className="flex-1">
                  <SearchableSelect
                    options={landlords?.map(l => ({ value: l.id, label: l.name })) || []}
                    value={landlordToAdd}
                    onValueChange={setLandlordToAdd}
                    placeholder="Selecione um proprietário..."
                    searchPlaceholder="Buscar proprietário..."
                    disabled={!canEditPropertyField("landlordShares")}
                    testId="select-property-landlord"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (!landlordToAdd) return;
                    if (landlordShares.some(s => s.landlordId === landlordToAdd)) return;
                    const currentTotal = landlordShares.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);
                    const suggested = Math.max(0, 100 - currentTotal);
                    setLandlordShares([...landlordShares, { landlordId: landlordToAdd, percent: suggested ? String(suggested) : "0" }]);
                    setLandlordToAdd("");
                  }}
                  disabled={!landlordToAdd || !canEditPropertyField("landlordShares")}
                >
                  Adicionar
                </Button>
              </div>

              {landlordShares.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum proprietário vinculado.</div>
              ) : (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Proprietário</TableHead>
                        <TableHead className="w-[140px] text-right">%</TableHead>
                        <TableHead className="w-[60px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {landlordShares.map((s, idx) => {
                        const name = landlords?.find(l => l.id === s.landlordId)?.name || "-";
                        return (
                          <TableRow key={s.landlordId}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={s.percent}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setLandlordShares(prev =>
                                    prev.map((row, i) => (i === idx ? { ...row, percent: value } : row)),
                                  );
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => setLandlordShares(prev => prev.filter((_, i) => i !== idx))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow>
                        <TableCell className="text-sm text-muted-foreground">Total</TableCell>
                        <TableCell className="text-right font-medium">
                          {landlordShares
                            .reduce((sum, s) => sum + (Number(s.percent) || 0), 0)
                            .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          %
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            </div>
            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-property">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingProperty ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
