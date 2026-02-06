import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Users, Loader2 } from "lucide-react";
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
import type { Landlord } from "@shared/schema";

const pixKeyTypes = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave Aleatória" },
];

export default function LandlordsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLandlord, setEditingLandlord] = useState<Landlord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestedCode, setSuggestedCode] = useState("");
  const { toast } = useToast();

  const { data: landlords, isLoading } = useQuery<Landlord[]>({
    queryKey: ["/api/landlords"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/landlords", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlords"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Proprietário cadastrado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PATCH", `/api/landlords/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlords"] });
      setIsDialogOpen(false);
      setEditingLandlord(null);
      toast({ title: "Sucesso", description: "Proprietário atualizado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/landlords/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/landlords"] });
      toast({ title: "Sucesso", description: "Proprietário excluído com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      code: formData.get("code") as string || null,
      name: formData.get("name") as string,
      doc: formData.get("doc") as string,
      rg: formData.get("rg") as string || null,
      maritalStatus: formData.get("maritalStatus") as string || null,
      nationality: formData.get("nationality") as string || null,
      profession: formData.get("profession") as string || null,
      birthDate: formData.get("birthDate") as string || null,
      propertyCount: parseInt(formData.get("propertyCount") as string) || 0,
      bank: formData.get("bank") as string || null,
      branch: formData.get("branch") as string || null,
      account: formData.get("account") as string || null,
      
      email: formData.get("email") as string || null,
      phone: formData.get("phone") as string || null,
      
      address: formData.get("address") as string || null,
      neighborhood: formData.get("neighborhood") as string || null,
      city: formData.get("city") as string || null,
      state: formData.get("state") as string || null,
      zipCode: formData.get("zipCode") as string || null,
      
      pixKey: formData.get("pixKey") as string || null,
      pixKeyType: formData.get("pixKeyType") as string || null,
    };

    if (editingLandlord) {
      updateMutation.mutate({ id: editingLandlord.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const openEditDialog = (landlord: Landlord) => {
    setEditingLandlord(landlord);
    setIsDialogOpen(true);
  };

  const openNewDialog = async () => {
    setEditingLandlord(null);
    try {
      const response = await apiRequest("GET", "/api/landlords/next-code");
      const data = await response.json();
      setSuggestedCode(data.code);
    } catch (error) {
      console.error("Erro ao buscar código sugerido:", error);
      setSuggestedCode("");
    }
    setIsDialogOpen(true);
  };

  const filteredLandlords = landlords?.filter(
    (l) =>
      l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      l.doc.includes(searchTerm) ||
      (l.email && l.email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (l.code && l.code.includes(searchTerm))
  );

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Proprietários</h1>
          <p className="text-muted-foreground">Gerencie os proprietários dos imóveis</p>
        </div>
        <Button onClick={openNewDialog} data-testid="button-new-landlord">
          <Plus className="mr-2 h-4 w-4" />
          Novo Proprietário
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Lista de Proprietários
              </CardTitle>
              <CardDescription>{landlords?.length || 0} proprietários cadastrados</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, CPF ou código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-landlords"
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
          ) : filteredLandlords && filteredLandlords.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Código</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>CPF/CNPJ</TableHead>
                    <TableHead className="hidden md:table-cell">Email</TableHead>
                    <TableHead className="hidden md:table-cell">Telefone</TableHead>
                    <TableHead className="hidden lg:table-cell">Cidade/UF</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLandlords.map((landlord) => (
                    <TableRow key={landlord.id} data-testid={`row-landlord-${landlord.id}`}>
                      <TableCell className="font-mono text-sm">{landlord.code || "-"}</TableCell>
                      <TableCell className="font-medium">{landlord.name}</TableCell>
                      <TableCell className="font-mono text-sm">{landlord.doc}</TableCell>
                      <TableCell className="hidden md:table-cell">{landlord.email || "-"}</TableCell>
                      <TableCell className="hidden md:table-cell">{landlord.phone || "-"}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {landlord.city && landlord.state ? `${landlord.city}/${landlord.state}` : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditDialog(landlord)}
                            data-testid={`button-edit-landlord-${landlord.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(landlord.id)}
                            data-testid={`button-delete-landlord-${landlord.id}`}
                          >
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
              <Users className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhum proprietário encontrado</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando um novo proprietário.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLandlord ? "Editar Proprietário" : "Novo Proprietário"}</DialogTitle>
            <DialogDescription>
              {editingLandlord ? "Atualize os dados do proprietário." : "Preencha os dados do novo proprietário."}
            </DialogDescription>
          </DialogHeader>
          <form key={editingLandlord ? editingLandlord.id : "new"} onSubmit={handleSubmit} className="space-y-6">
            
            {/* Dados Pessoais */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium leading-none text-muted-foreground border-b pb-2">Dados Pessoais</h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-2 sm:col-span-1">
                  <Label htmlFor="code">Código</Label>
                  <Input 
                    id="code" 
                    name="code" 
                    key={editingLandlord ? `edit-${editingLandlord.id}` : `new-${suggestedCode}`}
                    defaultValue={editingLandlord?.code || suggestedCode} 
                    required
                    placeholder="Gerado automaticamente se vazio" 
                  />
                </div>
                <div className="space-y-2 sm:col-span-3">
                  <Label htmlFor="name">Nome *</Label>
                  <Input id="name" name="name" defaultValue={editingLandlord?.name} required />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                 <div className="space-y-2">
                  <Label htmlFor="doc">CPF/CNPJ *</Label>
                  <Input id="doc" name="doc" defaultValue={editingLandlord?.doc} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rg">RG</Label>
                  <Input id="rg" name="rg" defaultValue={editingLandlord?.rg || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="birthDate">Data Nascimento</Label>
                  <Input id="birthDate" name="birthDate" placeholder="DD/MM/AAAA" defaultValue={editingLandlord?.birthDate || ""} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="maritalStatus">Estado Civil</Label>
                  <Input id="maritalStatus" name="maritalStatus" defaultValue={editingLandlord?.maritalStatus || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nationality">Naturalidade</Label>
                  <Input id="nationality" name="nationality" defaultValue={editingLandlord?.nationality || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profession">Profissão</Label>
                  <Input id="profession" name="profession" defaultValue={editingLandlord?.profession || ""} />
                </div>
              </div>
            </div>

            {/* Contato e Endereço */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium leading-none text-muted-foreground border-b pb-2">Contato e Endereço</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" defaultValue={editingLandlord?.email || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input id="phone" name="phone" defaultValue={editingLandlord?.phone || ""} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-2 sm:col-span-1">
                  <Label htmlFor="zipCode">CEP</Label>
                  <Input id="zipCode" name="zipCode" defaultValue={editingLandlord?.zipCode || ""} />
                </div>
                <div className="space-y-2 sm:col-span-3">
                   <Label htmlFor="address">Endereço</Label>
                   <Input id="address" name="address" defaultValue={editingLandlord?.address || ""} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="neighborhood">Bairro</Label>
                  <Input id="neighborhood" name="neighborhood" defaultValue={editingLandlord?.neighborhood || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Cidade</Label>
                  <Input id="city" name="city" defaultValue={editingLandlord?.city || ""} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="state">UF</Label>
                  <Input id="state" name="state" defaultValue={editingLandlord?.state || ""} maxLength={2} />
                </div>
              </div>
            </div>

            {/* Dados Bancários */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium leading-none text-muted-foreground border-b pb-2">Dados Bancários e Outros</h3>
               <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="bank">Banco</Label>
                  <Input id="bank" name="bank" defaultValue={editingLandlord?.bank || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch">Agência</Label>
                  <Input id="branch" name="branch" defaultValue={editingLandlord?.branch || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account">Conta</Label>
                  <Input id="account" name="account" defaultValue={editingLandlord?.account || ""} />
                </div>
              </div>
               <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="pixKeyType">Tipo Pix</Label>
                  <Select name="pixKeyType" defaultValue={editingLandlord?.pixKeyType || ""}>
                    <SelectTrigger>
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
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="pixKey">Chave Pix</Label>
                  <Input id="pixKey" name="pixKey" defaultValue={editingLandlord?.pixKey || ""} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                 <div className="space-y-2">
                  <Label htmlFor="propertyCount">Qtd. Imóveis</Label>
                  <Input id="propertyCount" name="propertyCount" type="number" defaultValue={editingLandlord?.propertyCount || 0} />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-landlord">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingLandlord ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
