import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PermissionGuard } from "@/components/permission-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Guarantor } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { hasAnyFieldPermission, hasFieldPermission } from "@shared/field-permissions";

const cepCache = new Map<string, any>();

export default function GuarantorsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGuarantor, setEditingGuarantor] = useState<Guarantor | null>(null);
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

  useEffect(() => {
    if (isDialogOpen) {
      if (editingGuarantor) {
        setAddressData({
          zipCode: editingGuarantor.zipCode || "",
          address: editingGuarantor.address || "",
          neighborhood: editingGuarantor.neighborhood || "",
          city: editingGuarantor.city || "",
          state: editingGuarantor.state || ""
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
  }, [isDialogOpen, editingGuarantor]);

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


  const { data: guarantors, isLoading } = useQuery<Guarantor[]>({
    queryKey: ["/api/guarantors"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/guarantors", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guarantors"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Fiador cadastrado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/guarantors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guarantors"] });
      setIsDialogOpen(false);
      setEditingGuarantor(null);
      toast({ title: "Sucesso", description: "Fiador atualizado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/guarantors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/guarantors"] });
      toast({ title: "Sucesso", description: "Fiador excluído com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = editingGuarantor
      ? {
          ...(canEditField("code") ? { code: (formData.get("code") as string) || null } : {}),
          ...(canEditField("name") ? { name: formData.get("name") as string } : {}),
          ...(canEditField("doc") ? { doc: formData.get("doc") as string } : {}),
          ...(canEditField("rg") ? { rg: (formData.get("rg") as string) || null } : {}),
          ...(canEditField("birthDate") ? { birthDate: (formData.get("birthDate") as string) || null } : {}),
          ...(canEditField("maritalStatus") ? { maritalStatus: (formData.get("maritalStatus") as string) || null } : {}),
          ...(canEditField("profession") ? { profession: (formData.get("profession") as string) || null } : {}),
          ...(canEditField("class") ? { class: (formData.get("class") as string) || null } : {}),
          ...(canEditField("email") ? { email: (formData.get("email") as string) || null } : {}),
          ...(canEditField("phone") ? { phone: (formData.get("phone") as string) || null } : {}),
          ...(canEditField("address") ? { address: addressData.address || null } : {}),
          ...(canEditField("neighborhood") ? { neighborhood: addressData.neighborhood || null } : {}),
          ...(canEditField("city") ? { city: addressData.city || null } : {}),
          ...(canEditField("state") ? { state: addressData.state || null } : {}),
          ...(canEditField("zipCode") ? { zipCode: addressData.zipCode || null } : {}),
          ...(canEditField("spouseName") ? { spouseName: (formData.get("spouseName") as string) || null } : {}),
          ...(canEditField("spouseDoc") ? { spouseDoc: (formData.get("spouseDoc") as string) || null } : {}),
          ...(canEditField("spouseRg") ? { spouseRg: (formData.get("spouseRg") as string) || null } : {}),
        }
      : {
          code: formData.get("code") as string || null,
          name: formData.get("name") as string,
          doc: formData.get("doc") as string,
          rg: formData.get("rg") as string || null,
          birthDate: formData.get("birthDate") as string || null,
          maritalStatus: formData.get("maritalStatus") as string || null,
          profession: formData.get("profession") as string || null,
          class: formData.get("class") as string || null,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
          address: formData.get("address") as string || null,
          neighborhood: formData.get("neighborhood") as string || null,
          city: formData.get("city") as string || null,
          state: formData.get("state") as string || null,
          zipCode: formData.get("zipCode") as string || null,
          spouseName: formData.get("spouseName") as string || null,
          spouseDoc: formData.get("spouseDoc") as string || null,
          spouseRg: formData.get("spouseRg") as string || null,
        };

    if (editingGuarantor) {
      updateMutation.mutate({ id: editingGuarantor.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openNewDialog = async () => {
    setEditingGuarantor(null);
    try {
      const response = await apiRequest("GET", "/api/guarantors/next-code");
      const data = await response.json();
      setSuggestedCode(data.code);
    } catch (error) {
      console.error("Erro ao buscar código sugerido:", error);
      setSuggestedCode("");
    }
    setIsDialogOpen(true);
  };

  const filteredGuarantors = guarantors?.filter(
    (g) =>
      g.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      g.doc.includes(searchTerm) ||
      g.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      g.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === "admin";
  const canEditAnyGuarantorField =
    isAdmin || (userPermissions.includes("edit_guarantor") && hasAnyFieldPermission("edit_guarantor", userPermissions));
  const canEditField = (
    field:
      | "code" | "name" | "doc" | "rg" | "birthDate" | "maritalStatus" | "profession" | "class"
      | "email" | "phone" | "address" | "neighborhood" | "city" | "state" | "zipCode"
      | "spouseName" | "spouseDoc" | "spouseRg",
  ) => {
    if (!editingGuarantor) return true;
    if (isAdmin) return true;
    if (!userPermissions.includes("edit_guarantor")) return false;
    return hasFieldPermission(userPermissions, "edit_guarantor", field);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fiadores</h1>
          <p className="text-muted-foreground">Gerencie os fiadores dos contratos</p>
        </div>
        <PermissionGuard permission="create_guarantor">
          <Button onClick={openNewDialog} data-testid="button-new-guarantor">
            <Plus className="mr-2 h-4 w-4" />
            Novo Fiador
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Lista de Fiadores
              </CardTitle>
              <CardDescription>{guarantors?.length || 0} fiadores cadastrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-guarantors"
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
          ) : filteredGuarantors && filteredGuarantors.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead className="hidden md:table-cell">Cidade/UF</TableHead>
                    <TableHead className="hidden md:table-cell">Telefone</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGuarantors.map((guarantor) => (
                    <TableRow key={guarantor.id} data-testid={`row-guarantor-${guarantor.id}`}>
                      <TableCell className="font-mono text-sm">{guarantor.code || "-"}</TableCell>
                      <TableCell className="font-medium">{guarantor.name}</TableCell>
                      <TableCell className="font-mono text-sm">{guarantor.doc}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {guarantor.city ? `${guarantor.city}/${guarantor.state || ""}` : "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{guarantor.phone || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <PermissionGuard permission="edit_guarantor">
                            {canEditAnyGuarantorField && (
                              <Button size="icon" variant="ghost" onClick={() => { setEditingGuarantor(guarantor); setIsDialogOpen(true); }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </PermissionGuard>
                          <PermissionGuard permission="delete_guarantor">
                            <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(guarantor.id)}>
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
              <ShieldCheck className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum fiador encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo fiador.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingGuarantor ? "Editar Fiador" : "Novo Fiador"}</DialogTitle>
            <DialogDescription>
              {editingGuarantor ? "Atualize os dados do fiador." : "Preencha os dados do novo fiador."}
            </DialogDescription>
          </DialogHeader>
          
          <form key={editingGuarantor?.id || 'new'} onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-2 space-y-6 py-2">
              <div className="space-y-4">
                <h3 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 border-b pb-2 text-primary">Dados Pessoais</h3>
                <div className="grid gap-4 sm:grid-cols-12">
                  <div className="space-y-2 sm:col-span-3">
                    <Label htmlFor="code">Código</Label>
                    <Input 
                      id="code" 
                      name="code" 
                      key={editingGuarantor ? `edit-${editingGuarantor.id}` : `new-${suggestedCode}`}
                      defaultValue={editingGuarantor?.code || suggestedCode} 
                      required
                      disabled={!canEditField("code")}
                      data-testid="input-guarantor-code" 
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-9">
                    <Label htmlFor="name">Nome *</Label>
                    <Input id="name" name="name" defaultValue={editingGuarantor?.name} required disabled={!canEditField("name")} data-testid="input-guarantor-name" />
                  </div>
                </div>
                
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="doc">CPF *</Label>
                    <Input id="doc" name="doc" defaultValue={editingGuarantor?.doc} required disabled={!canEditField("doc")} data-testid="input-guarantor-doc" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rg">RG</Label>
                    <Input id="rg" name="rg" defaultValue={editingGuarantor?.rg || ""} disabled={!canEditField("rg")} data-testid="input-guarantor-rg" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="birthDate">Data Nascimento</Label>
                    <Input id="birthDate" name="birthDate" defaultValue={editingGuarantor?.birthDate || ""} placeholder="DD/MM/AAAA" disabled={!canEditField("birthDate")} data-testid="input-guarantor-birthDate" />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="maritalStatus">Estado Civil</Label>
                    <Input id="maritalStatus" name="maritalStatus" defaultValue={editingGuarantor?.maritalStatus || ""} disabled={!canEditField("maritalStatus")} data-testid="input-guarantor-maritalStatus" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profession">Profissão</Label>
                    <Input id="profession" name="profession" defaultValue={editingGuarantor?.profession || ""} disabled={!canEditField("profession")} data-testid="input-guarantor-profession" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="class">Classe</Label>
                    <Input id="class" name="class" defaultValue={editingGuarantor?.class || ""} disabled={!canEditField("class")} data-testid="input-guarantor-class" />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 border-b pb-2 text-primary">Endereço e Contato</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" defaultValue={editingGuarantor?.email || ""} disabled={!canEditField("email")} data-testid="input-guarantor-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone</Label>
                    <Input id="phone" name="phone" defaultValue={editingGuarantor?.phone || ""} disabled={!canEditField("phone")} data-testid="input-guarantor-phone" />
                  </div>
                </div>
                
                <div className="grid gap-4 sm:grid-cols-12">
                  <div className="space-y-2 sm:col-span-3">
                    <Label htmlFor="zipCode">CEP</Label>
                    <Input 
                      id="zipCode" 
                      name="zipCode" 
                      value={addressData.zipCode} 
                      onChange={(e) => setAddressData({...addressData, zipCode: e.target.value})}
                      onBlur={handleCepBlur}
                      placeholder="00000-000"
                      disabled={!canEditField("zipCode")}
                      data-testid="input-guarantor-zipCode" 
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-9">
                    <Label htmlFor="address">Endereço</Label>
                    <Input 
                      id="address" 
                      name="address" 
                      value={addressData.address} 
                      onChange={(e) => setAddressData({...addressData, address: e.target.value})}
                      disabled={!canEditField("address")}
                      data-testid="input-guarantor-address" 
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
                      onChange={(e) => setAddressData({...addressData, neighborhood: e.target.value})}
                      disabled={!canEditField("neighborhood")}
                      data-testid="input-guarantor-neighborhood" 
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-5">
                    <Label htmlFor="city">Cidade</Label>
                    <Input 
                      id="city" 
                      name="city" 
                      value={addressData.city} 
                      onChange={(e) => setAddressData({...addressData, city: e.target.value})}
                      disabled={!canEditField("city")}
                      data-testid="input-guarantor-city" 
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="state">UF</Label>
                    <Input 
                      id="state" 
                      name="state" 
                      value={addressData.state} 
                      onChange={(e) => setAddressData({...addressData, state: e.target.value})}
                      maxLength={2} 
                      disabled={!canEditField("state")}
                      data-testid="input-guarantor-state" 
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 border-b pb-2 text-primary">Dados do Cônjuge</h3>
                <div className="space-y-2">
                  <Label htmlFor="spouseName">Nome do Cônjuge</Label>
                  <Input id="spouseName" name="spouseName" defaultValue={editingGuarantor?.spouseName || ""} disabled={!canEditField("spouseName")} data-testid="input-guarantor-spouseName" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="spouseDoc">CPF Cônjuge</Label>
                    <Input id="spouseDoc" name="spouseDoc" defaultValue={editingGuarantor?.spouseDoc || ""} disabled={!canEditField("spouseDoc")} data-testid="input-guarantor-spouseDoc" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="spouseRg">RG Cônjuge</Label>
                    <Input id="spouseRg" name="spouseRg" defaultValue={editingGuarantor?.spouseRg || ""} disabled={!canEditField("spouseRg")} data-testid="input-guarantor-spouseRg" />
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t mt-auto">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-guarantor">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingGuarantor ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
