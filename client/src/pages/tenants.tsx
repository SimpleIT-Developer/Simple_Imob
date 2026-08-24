import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, UserCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PermissionGuard } from "@/components/permission-guard";
import type { Tenant } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { hasAnyFieldPermission, hasFieldPermission } from "@shared/field-permissions";

const cepCache = new Map<string, any>();

const pixKeyTypes = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave Aleatória" },
  { value: "agencia_conta", label: "Agência/Conta" },
];

export default function TenantsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestedCode, setSuggestedCode] = useState("");
  const [addressData, setAddressData] = useState({
    zipCode: "",
    address: "",
    neighborhood: "",
    city: "",
    state: ""
  });
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: tenants, isLoading } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/tenants", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Locatário cadastrado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/tenants/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      setIsDialogOpen(false);
      setEditingTenant(null);
      toast({ title: "Sucesso", description: "Locatário atualizado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/tenants/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenants"] });
      toast({ title: "Sucesso", description: "Locatário excluído com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (isDialogOpen) {
      if (editingTenant) {
        setAddressData({
          zipCode: editingTenant.zipCode || "",
          address: editingTenant.address || "",
          neighborhood: editingTenant.neighborhood || "",
          city: editingTenant.city || "",
          state: editingTenant.state || ""
        });
      } else {
        setAddressData({
          zipCode: "",
          address: "",
          neighborhood: "",
          city: "",
          state: ""
        });
      }
    }
  }, [isDialogOpen, editingTenant]);

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
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = editingTenant
      ? {
          ...(canEditField("code") ? { code: (formData.get("code") as string) || null } : {}),
          ...(canEditField("name") ? { name: formData.get("name") as string } : {}),
          ...(canEditField("doc") ? { doc: formData.get("doc") as string } : {}),
          ...(canEditField("rg") ? { rg: (formData.get("rg") as string) || null } : {}),
          ...(canEditField("email") ? { email: (formData.get("email") as string) || null } : {}),
          ...(canEditField("phone") ? { phone: (formData.get("phone") as string) || null } : {}),
          ...(canEditField("birthDate") ? { birthDate: (formData.get("birthDate") as string) || null } : {}),
          ...(canEditField("maritalStatus") ? { maritalStatus: (formData.get("maritalStatus") as string) || null } : {}),
          ...(canEditField("profession") ? { profession: (formData.get("profession") as string) || null } : {}),
          ...(canEditField("class") ? { class: (formData.get("class") as string) || null } : {}),
          ...(canEditField("address") ? { address: addressData.address || null } : {}),
          ...(canEditField("neighborhood") ? { neighborhood: addressData.neighborhood || null } : {}),
          ...(canEditField("city") ? { city: addressData.city || null } : {}),
          ...(canEditField("state") ? { state: addressData.state || null } : {}),
          ...(canEditField("zipCode") ? { zipCode: addressData.zipCode || null } : {}),
          ...(canEditField("pixKeyType") ? { pixKeyType: (formData.get("pixKeyType") as string) || null } : {}),
          ...(canEditField("pixKey") ? { pixKey: (formData.get("pixKey") as string) || null } : {}),
        }
      : {
          code: formData.get("code") as string || null,
          name: formData.get("name") as string,
          doc: formData.get("doc") as string,
          rg: formData.get("rg") as string || null,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
          birthDate: formData.get("birthDate") as string || null,
          maritalStatus: formData.get("maritalStatus") as string || null,
          profession: formData.get("profession") as string || null,
          class: formData.get("class") as string || null,
          address: formData.get("address") as string || null,
          neighborhood: formData.get("neighborhood") as string || null,
          city: formData.get("city") as string || null,
          state: formData.get("state") as string || null,
          zipCode: formData.get("zipCode") as string || null,
          pixKeyType: formData.get("pixKeyType") as string || null,
          pixKey: formData.get("pixKey") as string || null,
        };

    if (editingTenant) {
      updateMutation.mutate({ id: editingTenant.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openNewDialog = async () => {
    setEditingTenant(null);
    try {
      const response = await apiRequest("GET", "/api/tenants/next-code");
      const data = await response.json();
      setSuggestedCode(data.code);
    } catch (error) {
      console.error("Erro ao buscar código sugerido:", error);
      setSuggestedCode("");
    }
    setIsDialogOpen(true);
  };

  const filteredTenants = tenants?.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.doc.includes(searchTerm) ||
      (t.code && t.code.includes(searchTerm)) ||
      t.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === "admin";
  const canEditAnyTenantField =
    isAdmin || (userPermissions.includes("edit_tenant") && hasAnyFieldPermission("edit_tenant", userPermissions));
  const canEditField = (
    field:
      | "code" | "name" | "doc" | "rg" | "email" | "phone" | "birthDate" | "maritalStatus"
      | "profession" | "class" | "address" | "neighborhood" | "city" | "state" | "zipCode"
      | "pixKeyType" | "pixKey",
  ) => {
    if (!editingTenant) return true;
    if (isAdmin) return true;
    if (!userPermissions.includes("edit_tenant")) return false;
    return hasFieldPermission(userPermissions, "edit_tenant", field);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locatários</h1>
          <p className="text-muted-foreground">Gerencie os inquilinos dos imóveis</p>
        </div>
        <PermissionGuard permission="create_tenant">
          <Button onClick={openNewDialog} data-testid="button-new-tenant">
            <Plus className="mr-2 h-4 w-4" />
            Novo Locatário
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-primary" />
                Lista de Locatários
              </CardTitle>
              <CardDescription>{tenants?.length || 0} locatários cadastrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF ou código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-tenants"
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
          ) : filteredTenants && filteredTenants.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Código</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead className="hidden md:table-cell">Telefone</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTenants.map((tenant) => (
                    <TableRow key={tenant.id} data-testid={`row-tenant-${tenant.id}`}>
                      <TableCell className="font-mono text-sm">{tenant.code || "-"}</TableCell>
                      <TableCell className="font-medium">{tenant.name}</TableCell>
                      <TableCell className="font-mono text-sm">{tenant.doc}</TableCell>
                      <TableCell className="hidden md:table-cell">{tenant.email || "-"}</TableCell>
                      <TableCell className="hidden md:table-cell">{tenant.phone || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <PermissionGuard permission="edit_tenant">
                            {canEditAnyTenantField && (
                              <Button size="icon" variant="ghost" onClick={() => { setEditingTenant(tenant); setIsDialogOpen(true); }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </PermissionGuard>
                          <PermissionGuard permission="delete_tenant">
                            <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(tenant.id)}>
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
              <UserCheck className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum locatário encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo locatário.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTenant ? "Editar Locatário" : "Novo Locatário"}</DialogTitle>
            <DialogDescription>
              {editingTenant ? "Atualize os dados do locatário." : "Preencha os dados do novo locatário."}
            </DialogDescription>
          </DialogHeader>
          <form key={editingTenant ? editingTenant.id : "new"} onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="code">Código</Label>
                <Input 
                  id="code" 
                  name="code" 
                  key={editingTenant ? `edit-${editingTenant.id}` : `new-${suggestedCode}`}
                  defaultValue={editingTenant?.code || suggestedCode}
                  required
                  disabled={!canEditField("code")}
                  placeholder="Gerado automaticamente se vazio" 
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="name">Nome *</Label>
                <Input id="name" name="name" defaultValue={editingTenant?.name} required disabled={!canEditField("name")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="doc">CPF *</Label>
                <Input id="doc" name="doc" defaultValue={editingTenant?.doc} required disabled={!canEditField("doc")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rg">RG</Label>
                <Input id="rg" name="rg" defaultValue={editingTenant?.rg || ""} disabled={!canEditField("rg")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthDate">Data de Nascimento</Label>
                <Input
                  id="birthDate" 
                  name="birthDate" 
                  defaultValue={(editingTenant?.birthDate && editingTenant.birthDate.trim() !== "/  /") ? editingTenant.birthDate : ""} 
                  placeholder="DD/MM/AAAA" 
                  disabled={!canEditField("birthDate")}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="maritalStatus">Estado Civil</Label>
                <Input id="maritalStatus" name="maritalStatus" defaultValue={editingTenant?.maritalStatus || ""} disabled={!canEditField("maritalStatus")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profession">Profissão</Label>
                <Input id="profession" name="profession" defaultValue={editingTenant?.profession || ""} disabled={!canEditField("profession")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="class">Classe</Label>
                <Input id="class" name="class" defaultValue={editingTenant?.class || ""} placeholder="Ex: 01-BOM" disabled={!canEditField("class")} />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={editingTenant?.email || ""} disabled={!canEditField("email")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" name="phone" defaultValue={editingTenant?.phone || ""} disabled={!canEditField("phone")} />
              </div>
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
                  disabled={!canEditField("zipCode")}
                />
              </div>
              <div className="space-y-2 sm:col-span-9">
                <Label htmlFor="address">Endereço</Label>
                <Input 
                  id="address" 
                  name="address" 
                  value={addressData.address}
                  onChange={(e) => setAddressData(prev => ({ ...prev, address: e.target.value }))} 
                  disabled={!canEditField("address")}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="neighborhood">Bairro</Label>
                <Input id="neighborhood" name="neighborhood" value={addressData.neighborhood} onChange={(e) => setAddressData(prev => ({ ...prev, neighborhood: e.target.value }))} disabled={!canEditField("neighborhood")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input id="city" name="city" value={addressData.city} onChange={(e) => setAddressData(prev => ({ ...prev, city: e.target.value }))} disabled={!canEditField("city")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">UF</Label>
                <Input id="state" name="state" value={addressData.state} onChange={(e) => setAddressData(prev => ({ ...prev, state: e.target.value }))} maxLength={2} disabled={!canEditField("state")} />
              </div>
            </div>

            

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pixKeyType">Tipo Chave Pix</Label>
                <Select name="pixKeyType" defaultValue={editingTenant?.pixKeyType || undefined} disabled={!canEditField("pixKeyType")}>
                  <SelectTrigger disabled={!canEditField("pixKeyType")}>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pixKeyTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pixKey">Chave Pix</Label>
                <Input id="pixKey" name="pixKey" defaultValue={editingTenant?.pixKey || ""} />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-tenant">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingTenant ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
