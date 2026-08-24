import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Wrench, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PermissionGuard } from "@/components/permission-guard";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ServiceProvider } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { hasAnyFieldPermission, hasFieldPermission } from "@shared/field-permissions";

export default function ProvidersPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ServiceProvider | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: providers, isLoading } = useQuery<ServiceProvider[]>({ queryKey: ["/api/providers"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/providers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Prestador cadastrado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/providers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      setIsDialogOpen(false);
      setEditingProvider(null);
      toast({ title: "Sucesso", description: "Prestador atualizado com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/providers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/providers"] });
      toast({ title: "Sucesso", description: "Prestador excluído com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = editingProvider
      ? {
          ...(canEditField("name") ? { name: (formData.get("name") as string) || null } : {}),
          ...(canEditField("doc") ? { doc: (formData.get("doc") as string) || null } : {}),
          ...(canEditField("email") ? { email: (formData.get("email") as string) || null } : {}),
          ...(canEditField("phone") ? { phone: (formData.get("phone") as string) || null } : {}),
          ...(canEditField("serviceType") ? { serviceType: (formData.get("serviceType") as string) || null } : {}),
        }
      : {
          name: formData.get("name") as string,
          doc: formData.get("doc") as string || null,
          email: formData.get("email") as string || null,
          phone: formData.get("phone") as string || null,
          serviceType: formData.get("serviceType") as string,
        };

    if (editingProvider) {
      updateMutation.mutate({ id: editingProvider.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filteredProviders = providers?.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.serviceType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];
  const isAdmin = user?.role === "admin";
  const canEditAnyProviderField =
    isAdmin || (userPermissions.includes("edit_provider") && hasAnyFieldPermission("edit_provider", userPermissions));
  const canEditField = (field: "name" | "doc" | "email" | "phone" | "serviceType") => {
    if (!editingProvider) return true;
    if (isAdmin) return true;
    if (!userPermissions.includes("edit_provider")) return false;
    return hasFieldPermission(userPermissions, "edit_provider", field);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Prestadores de Serviço</h1>
          <p className="text-muted-foreground">Gerencie os prestadores de serviços</p>
        </div>
        <PermissionGuard permission="create_provider">
          <Button onClick={() => { setEditingProvider(null); setIsDialogOpen(true); }} data-testid="button-new-provider">
            <Plus className="mr-2 h-4 w-4" />
            Novo Prestador
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                Lista de Prestadores
              </CardTitle>
              <CardDescription>{providers?.length || 0} prestadores cadastrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-providers" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredProviders && filteredProviders.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo de Serviço</TableHead>
                    <TableHead className="hidden md:table-cell">CPF/CNPJ</TableHead>
                    <TableHead className="hidden md:table-cell">Telefone</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProviders.map((provider) => (
                    <TableRow key={provider.id} data-testid={`row-provider-${provider.id}`}>
                      <TableCell className="font-medium">{provider.name}</TableCell>
                      <TableCell><Badge variant="secondary">{provider.serviceType}</Badge></TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-sm">{provider.doc || "-"}</TableCell>
                      <TableCell className="hidden md:table-cell">{provider.phone || "-"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <PermissionGuard permission="edit_provider">
                            {canEditAnyProviderField && (
                            <Button size="icon" variant="ghost" onClick={() => { setEditingProvider(provider); setIsDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            )}
                          </PermissionGuard>
                          <PermissionGuard permission="delete_provider">
                            <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(provider.id)}>
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
              <h3 className="mt-4 text-lg font-semibold">Nenhum prestador encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo prestador.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProvider ? "Editar Prestador" : "Novo Prestador"}</DialogTitle>
            <DialogDescription>{editingProvider ? "Atualize os dados do prestador." : "Preencha os dados do novo prestador."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nome *</Label>
                <Input id="name" name="name" defaultValue={editingProvider?.name} required disabled={!canEditField("name")} data-testid="input-provider-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="serviceType">Tipo de Serviço *</Label>
                <Input id="serviceType" name="serviceType" placeholder="Ex: Manutenção, Limpeza..." defaultValue={editingProvider?.serviceType} required disabled={!canEditField("serviceType")} data-testid="input-provider-type" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="doc">CPF/CNPJ</Label>
                <Input id="doc" name="doc" defaultValue={editingProvider?.doc || ""} disabled={!canEditField("doc")} data-testid="input-provider-doc" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" name="phone" defaultValue={editingProvider?.phone || ""} disabled={!canEditField("phone")} data-testid="input-provider-phone" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" defaultValue={editingProvider?.email || ""} disabled={!canEditField("email")} data-testid="input-provider-email" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-provider">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingProvider ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
