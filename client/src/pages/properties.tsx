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
import type { Property, Landlord } from "@shared/schema";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  available: { label: "Disponível", variant: "default" },
  rented: { label: "Alugado", variant: "secondary" },
  maintenance: { label: "Manutenção", variant: "destructive" },
};

export default function PropertiesPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestedCode, setSuggestedCode] = useState("");
  const [selectedLandlordId, setSelectedLandlordId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [addressData, setAddressData] = useState({
    address: "",
    neighborhood: "",
    city: "",
    state: "",
    zipCode: ""
  });
  const { toast } = useToast();

  useEffect(() => {
    if (isDialogOpen) {
      setSelectedLandlordId(editingProperty?.landlordId || "");
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
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        if (!data.erro) {
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
        console.error("Erro ao buscar CEP:", error);
        toast({ title: "Erro", description: "Erro ao buscar CEP.", variant: "destructive" });
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
    const data = {
      code: formData.get("code") as string,
      title: formData.get("title") as string,
      type: formData.get("type") as string,
      saleRent: formData.get("saleRent") as string,
      address: formData.get("address") as string,
      neighborhood: formData.get("neighborhood") as string,
      city: formData.get("city") as string,
      state: formData.get("state") as string,
      zipCode: formData.get("zipCode") as string,
      rentDefault: formData.get("rentDefault") as string,
      landlordId: formData.get("landlordId") as string || null,
      status: formData.get("status") as string,
    };

    if (editingProperty) {
      updateMutation.mutate({ id: editingProperty.id, data });
    } else {
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

  const getLandlordName = (landlordId: string | null) => {
    if (!landlordId) return "-";
    return landlords?.find((l) => l.id === landlordId)?.name || "-";
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Imóveis</h1>
          <p className="text-muted-foreground">Gerencie os imóveis cadastrados</p>
        </div>
        <Button onClick={openNewDialog} data-testid="button-new-property">
          <Plus className="mr-2 h-4 w-4" />
          Novo Imóvel
        </Button>
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
                      <TableCell className="hidden lg:table-cell">{getLandlordName(property.landlordId)}</TableCell>
                      <TableCell className="font-medium">R$ {Number(property.rentDefault).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>
                        <Badge variant={statusLabels[property.status]?.variant || "secondary"}>
                          {statusLabels[property.status]?.label || property.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" onClick={() => { setEditingProperty(property); setIsDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(property.id)}>
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
                  data-testid="input-property-code" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saleRent">Aluguel/Venda</Label>
                <Select name="saleRent" defaultValue={editingProperty?.saleRent || "Aluguel"}>
                  <SelectTrigger>
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
                data-testid="input-property-title" 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Tipo do Imóvel</Label>
              <Select name="type" defaultValue={editingProperty?.type || ""}>
                <SelectTrigger data-testid="select-property-type">
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
                  data-testid="input-property-state" 
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rentDefault">Aluguel Padrão (R$) *</Label>
                <Input id="rentDefault" name="rentDefault" type="number" step="0.01" defaultValue={editingProperty?.rentDefault} required data-testid="input-property-rent" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status *</Label>
                <Select name="status" defaultValue={editingProperty?.status || "available"}>
                  <SelectTrigger data-testid="select-property-status">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Disponível</SelectItem>
                    <SelectItem value="rented">Alugado</SelectItem>
                    <SelectItem value="maintenance">Manutenção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="landlordId">Proprietário</Label>
              <SearchableSelect
                options={[
                  { value: "", label: "NENHUM (Sem Proprietário)" },
                  ...(landlords?.map(l => ({ value: l.id, label: l.name })) || [])
                ]}
                value={selectedLandlordId}
                onValueChange={setSelectedLandlordId}
                placeholder="Selecione o proprietário..."
                searchPlaceholder="Buscar proprietário..."
                testId="select-property-landlord"
              />
              <input type="hidden" name="landlordId" value={selectedLandlordId} />
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
