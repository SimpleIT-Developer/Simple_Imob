import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PermissionGuard } from "@/components/permission-guard";
import { banksIspb, getBankByShortName } from "@/data/banks-ispb";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { Landlord } from "@shared/schema";

const cepCache = new Map<string, any>();

const pixKeyTypes = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave Aleatória" },
  { value: "agencia_conta", label: "Agência/Conta" },
];

export default function LandlordsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLandlord, setEditingLandlord] = useState<Landlord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestedCode, setSuggestedCode] = useState("");
  const [addressData, setAddressData] = useState({
    zipCode: "",
    address: "",
    neighborhood: "",
    city: "",
    state: ""
  });
  const [selectedBankName, setSelectedBankName] = useState("");
  const [selectedBankIspb, setSelectedBankIspb] = useState("");
  const [accountType, setAccountType] = useState("");
  const [pixType, setPixType] = useState("");
  const [nfseEnabled, setNfseEnabled] = useState(false);
  const [nfseOpSimpNac, setNfseOpSimpNac] = useState("3");
  const [nfseEnvironment, setNfseEnvironment] = useState("");
  const [nfseCertificateFileName, setNfseCertificateFileName] = useState("");
  const [nfseCertificatePfxBase64, setNfseCertificatePfxBase64] = useState<string | null>(null);

  const bankOptions = banksIspb.map((bank) => ({
    value: bank.shortName,
    label: `${bank.code} - ${bank.shortName}`,
    description: `ISPB: ${bank.ispb}`,
    searchTerms: `${bank.code} ${bank.shortName} ${bank.ispb}`,
  }));
  const { toast } = useToast();

  useEffect(() => {
    if (isDialogOpen) {
      if (editingLandlord) {
        setAddressData({
          zipCode: editingLandlord.zipCode || "",
          address: editingLandlord.address || "",
          neighborhood: editingLandlord.neighborhood || "",
          city: editingLandlord.city || "",
          state: editingLandlord.state || ""
        });
        setSelectedBankName(editingLandlord.bank || "");
        setSelectedBankIspb((editingLandlord as any).bankIspb || "");
        setAccountType((editingLandlord as any).accountType || "");
        setPixType(editingLandlord.pixKeyType || "");
        setNfseEnabled(Boolean((editingLandlord as any).nfseEnabled));
        setNfseOpSimpNac((editingLandlord as any)?.nfseOpSimpNac || "3");
        setNfseEnvironment((editingLandlord as any).nfseEnvironment || "");
        setNfseCertificateFileName((editingLandlord as any).nfseCertificateFileName || "");
        setNfseCertificatePfxBase64(null);
      } else {
        setAddressData({
          zipCode: "",
          address: "",
          neighborhood: "",
          city: "",
          state: ""
        });
        setSelectedBankName("");
        setSelectedBankIspb("");
        setAccountType("");
        setPixType("");
        setNfseEnabled(false);
        setNfseOpSimpNac("3");
        setNfseEnvironment("");
        setNfseCertificateFileName("");
        setNfseCertificatePfxBase64(null);
      }
    }
  }, [isDialogOpen, editingLandlord]);

  const handleNfseCertificateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setNfseCertificatePfxBase64(null);
      setNfseCertificateFileName((editingLandlord as any)?.nfseCertificateFileName || "");
      return;
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".pfx") && !fileName.endsWith(".p12")) {
      toast({ title: "Arquivo inválido", description: "Envie um certificado no formato .pfx ou .p12.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "O certificado deve ter no máximo 2MB.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const commaIndex = result.indexOf(",");
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        };
        reader.onerror = () => reject(new Error("Falha ao ler o certificado."));
        reader.readAsDataURL(file);
      });

      setNfseCertificatePfxBase64(base64);
      setNfseCertificateFileName(file.name);
      toast({ title: "Certificado carregado", description: "O arquivo será salvo junto com o cadastro do proprietário." });
    } catch (error: any) {
      toast({ title: "Erro", description: error.message || "Não foi possível ler o certificado.", variant: "destructive" });
      e.target.value = "";
    }
  };

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


  const { data: landlords, isLoading } = useQuery<Landlord[]>({
    queryKey: ["/api/landlords"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/landlords", data);
      return res.json();
    },
    onSuccess: (createdLandlord: Landlord) => {
      queryClient.setQueryData<Landlord[]>(["/api/landlords"], (current = []) => [createdLandlord, ...current]);
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
      const res = await apiRequest("PATCH", `/api/landlords/${id}`, data);
      return res.json();
    },
    onSuccess: (updatedLandlord: Landlord) => {
      queryClient.setQueryData<Landlord[]>(["/api/landlords"], (current = []) =>
        current.map((item) => item.id === updatedLandlord.id ? updatedLandlord : item)
      );
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
    const getOptionalString = (fieldName: string) => {
      const value = String(formData.get(fieldName) ?? "").trim();
      return value || null;
    };

    const data = {
      code: getOptionalString("code"),
      name: String(formData.get("name") ?? "").trim(),
      doc: String(formData.get("doc") ?? "").trim(),
      rg: getOptionalString("rg"),
      maritalStatus: getOptionalString("maritalStatus"),
      nationality: getOptionalString("nationality"),
      profession: getOptionalString("profession"),
      birthDate: getOptionalString("birthDate"),
      propertyCount: parseInt(formData.get("propertyCount") as string) || 0,
      bank: getOptionalString("bank"),
      bankIspb: getOptionalString("bankIspb"),
      branch: getOptionalString("branch"),
      account: getOptionalString("account"),
      accountType: getOptionalString("accountType"),
      
      email: getOptionalString("email"),
      phone: getOptionalString("phone"),
      
      address: getOptionalString("address"),
      neighborhood: getOptionalString("neighborhood"),
      city: getOptionalString("city"),
      state: getOptionalString("state"),
      zipCode: getOptionalString("zipCode"),
      
      pixKey: getOptionalString("pixKey"),
      pixKeyType: getOptionalString("pixKeyType"),
      nfseEnabled,
      nfseMunicipalRegistration: getOptionalString("nfseMunicipalRegistration"),
      nfseMunicipioIbge: getOptionalString("nfseMunicipioIbge"),
      nfseServiceItem: getOptionalString("nfseServiceItem"),
      nfseNationalTaxCode: getOptionalString("nfseNationalTaxCode"),
      nfseIssRate: getOptionalString("nfseIssRate"),
      nfseIbsCbsCst: getOptionalString("nfseIbsCbsCst"),
      nfseIbsCbsClassTrib: getOptionalString("nfseIbsCbsClassTrib"),
      nfseIbsCbsIndOp: getOptionalString("nfseIbsCbsIndOp") || "020101",
      nfseOpSimpNac: getOptionalString("nfseOpSimpNac") || "3",
      nfseEnvironment: getOptionalString("nfseEnvironment"),
      nfseSeries: getOptionalString("nfseSeries"),
      ...(String(formData.get("nfseCertificatePassword") || "").trim()
        ? { nfseCertificatePassword: String(formData.get("nfseCertificatePassword")).trim() }
        : {}),
      ...(nfseCertificatePfxBase64
        ? {
            nfseCertificatePfxBase64,
            nfseCertificateFileName: nfseCertificateFileName || null,
          }
        : {}),
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
        <PermissionGuard permission="create_landlord">
          <Button onClick={openNewDialog} data-testid="button-new-landlord">
            <Plus className="mr-2 h-4 w-4" />
            Novo Proprietário
          </Button>
        </PermissionGuard>
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
                          <PermissionGuard permission="edit_landlord">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEditDialog(landlord)}
                              data-testid={`button-edit-landlord-${landlord.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </PermissionGuard>
                          <PermissionGuard permission="delete_landlord">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(landlord.id)}
                              data-testid={`button-delete-landlord-${landlord.id}`}
                            >
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
            <Tabs defaultValue="dados-gerais" className="space-y-6">
              <TabsList className="grid w-full grid-cols-1 gap-2 h-auto sm:grid-cols-3">
                <TabsTrigger value="dados-gerais">Dados Gerais</TabsTrigger>
                <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
                <TabsTrigger value="nfse">Emissão de NFS-e</TabsTrigger>
              </TabsList>

              <TabsContent value="dados-gerais" className="space-y-6" forceMount>
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
                      <Input 
                        id="zipCode" 
                        name="zipCode" 
                        value={addressData.zipCode} 
                        onChange={(e) => setAddressData({...addressData, zipCode: e.target.value})}
                        onBlur={handleCepBlur}
                        placeholder="00000-000"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-3">
                      <Label htmlFor="address">Endereço</Label>
                      <Input 
                        id="address" 
                        name="address" 
                        value={addressData.address} 
                        onChange={(e) => setAddressData({...addressData, address: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="neighborhood">Bairro</Label>
                      <Input 
                        id="neighborhood" 
                        name="neighborhood" 
                        value={addressData.neighborhood} 
                        onChange={(e) => setAddressData({...addressData, neighborhood: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="city">Cidade</Label>
                      <Input 
                        id="city" 
                        name="city" 
                        value={addressData.city} 
                        onChange={(e) => setAddressData({...addressData, city: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="state">UF</Label>
                      <Input 
                        id="state" 
                        name="state" 
                        value={addressData.state} 
                        onChange={(e) => setAddressData({...addressData, state: e.target.value})}
                        maxLength={2} 
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="financeiro" className="space-y-6" forceMount>
                <div className="space-y-4">
                  <h3 className="text-sm font-medium leading-none text-muted-foreground border-b pb-2">Dados Bancários e Outros</h3>
                  <div className="grid gap-4 sm:grid-cols-5">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="bank">Banco</Label>
                      <SearchableSelect
                        options={bankOptions}
                        value={selectedBankName}
                        onValueChange={(value) => {
                          setSelectedBankName(value);
                          const bank = getBankByShortName(value);
                          setSelectedBankIspb(bank ? bank.ispb : "");
                        }}
                        placeholder="Selecione um banco"
                        searchPlaceholder="Buscar por código, nome ou ISPB..."
                      />
                      <input type="hidden" name="bank" value={selectedBankName} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="branch">Agência</Label>
                      <Input id="branch" name="branch" defaultValue={editingLandlord?.branch || ""} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account">Conta</Label>
                      <Input id="account" name="account" defaultValue={editingLandlord?.account || ""} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankIspb">ISPB</Label>
                      <Input
                        id="bankIspb"
                        name="bankIspb"
                        value={selectedBankIspb}
                        readOnly
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accountType">Tipo de Conta</Label>
                      <Select
                        name="accountType"
                        value={accountType}
                        onValueChange={setAccountType}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CORRENTE">Conta Corrente</SelectItem>
                          <SelectItem value="POUPANCA">Conta Poupança</SelectItem>
                        </SelectContent>
                      </Select>
                      <input type="hidden" name="accountType" value={accountType} />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="pixKeyType">Tipo Pix</Label>
                      <Select value={pixType} onValueChange={setPixType}>
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
                      <input type="hidden" name="pixKeyType" value={pixType} />
                    </div>
                    {pixType !== "agencia_conta" ? (
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="pixKey">Chave Pix</Label>
                        <Input id="pixKey" name="pixKey" defaultValue={editingLandlord?.pixKey || ""} />
                      </div>
                    ) : (
                      <div className="space-y-2 sm:col-span-2 opacity-50 pointer-events-none">
                        <Label>Chave Pix</Label>
                        <div className="h-9 border rounded-md flex items-center px-3 text-sm text-muted-foreground">
                          Oculto para Agência/Conta
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="propertyCount">Qtd. Imóveis</Label>
                      <Input id="propertyCount" name="propertyCount" type="number" defaultValue={editingLandlord?.propertyCount || 0} />
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="nfse" className="space-y-6" forceMount>
                <div className="space-y-4">
                  <h3 className="text-sm font-medium leading-none text-muted-foreground border-b pb-2">Emissão de NFS-e</h3>
                  <div className="rounded-lg border p-4 space-y-4">
                    <div className="flex items-start space-x-3">
                      <Checkbox
                        id="nfseEnabled"
                        checked={nfseEnabled}
                        onCheckedChange={(checked) => setNfseEnabled(checked === true)}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="nfseEnabled" className="cursor-pointer">Emitir NFS-e para este proprietário</Label>
                        <p className="text-sm text-muted-foreground">
                          Habilita o cadastro do certificado digital individual do proprietário para uso na emissão.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="nfseMunicipalRegistration">Inscrição Municipal</Label>
                        <Input
                          id="nfseMunicipalRegistration"
                          name="nfseMunicipalRegistration"
                          defaultValue={(editingLandlord as any)?.nfseMunicipalRegistration || ""}
                          placeholder="Inscrição municipal do proprietário"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseMunicipioIbge">Município IBGE</Label>
                        <Input
                          id="nfseMunicipioIbge"
                          name="nfseMunicipioIbge"
                          defaultValue={(editingLandlord as any)?.nfseMunicipioIbge || ""}
                          placeholder="Código IBGE do município"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseServiceItem">Item de Serviço</Label>
                        <Input
                          id="nfseServiceItem"
                          name="nfseServiceItem"
                          defaultValue={(editingLandlord as any)?.nfseServiceItem || ""}
                          placeholder="Ex.: 11.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseNationalTaxCode">Código de Tributação Nacional</Label>
                        <Input
                          id="nfseNationalTaxCode"
                          name="nfseNationalTaxCode"
                          defaultValue={(editingLandlord as any)?.nfseNationalTaxCode || ""}
                          placeholder="Ex.: 99.01.01"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseIssRate">Alíquota ISS (%)</Label>
                        <Input
                          id="nfseIssRate"
                          name="nfseIssRate"
                          type="number"
                          step="0.01"
                          defaultValue={(editingLandlord as any)?.nfseIssRate || ""}
                          placeholder="Ex.: 5.00"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseIbsCbsCst">CST IBS/CBS</Label>
                        <Input
                          id="nfseIbsCbsCst"
                          name="nfseIbsCbsCst"
                          defaultValue={(editingLandlord as any)?.nfseIbsCbsCst || "000"}
                          placeholder="Ex.: 000"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseIbsCbsClassTrib">cClassTrib IBS/CBS</Label>
                        <Input
                          id="nfseIbsCbsClassTrib"
                          name="nfseIbsCbsClassTrib"
                          defaultValue={(editingLandlord as any)?.nfseIbsCbsClassTrib || "000001"}
                          placeholder="Ex.: 000001"
                        />
                      </div>

                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="nfseIbsCbsIndOp">cIndOp IBS/CBS</Label>
                        <Input
                          id="nfseIbsCbsIndOp"
                          name="nfseIbsCbsIndOp"
                          defaultValue={(editingLandlord as any)?.nfseIbsCbsIndOp || "020101"}
                          placeholder="Ex.: 020101"
                        />
                        <p className="text-xs text-muted-foreground">
                          Código indicador da operação conforme a tabela oficial da NFS-e Nacional.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseOpSimpNac">Situação no Simples Nacional</Label>
                        <input
                          name="nfseOpSimpNac"
                          type="hidden"
                          value={nfseOpSimpNac}
                        />
                        <Select value={nfseOpSimpNac} onValueChange={setNfseOpSimpNac}>
                          <SelectTrigger id="nfseOpSimpNac">
                            <SelectValue placeholder="Selecione a situação" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Não Optante</SelectItem>
                            <SelectItem value="2">Optante - MEI</SelectItem>
                            <SelectItem value="3">Optante - ME/EPP</SelectItem>
                            <SelectItem value="4">Optante Pendente</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseEnvironment">Ambiente</Label>
                        <input
                          name="nfseEnvironment"
                          type="hidden"
                          value={nfseEnvironment}
                        />
                        <Select value={nfseEnvironment} onValueChange={setNfseEnvironment}>
                          <SelectTrigger id="nfseEnvironment">
                            <SelectValue placeholder="Selecione o ambiente" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="homologacao">Homologação</SelectItem>
                            <SelectItem value="producao">Produção</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseSeries">Série</Label>
                        <Input
                          id="nfseSeries"
                          name="nfseSeries"
                          defaultValue={(editingLandlord as any)?.nfseSeries || ""}
                          placeholder="Ex.: 900"
                        />
                      </div>

                      <div className="space-y-2 sm:col-span-2">
                        <Label>Descrição do Serviço</Label>
                        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                          Gerada automaticamente pelo sistema com base no imóvel e na competência do recibo.
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseCertificateFile">Certificado Digital</Label>
                        <Input
                          id="nfseCertificateFile"
                          type="file"
                          accept=".pfx,.p12,application/x-pkcs12"
                          onChange={handleNfseCertificateChange}
                        />
                        <p className="text-xs text-muted-foreground">
                          {nfseCertificateFileName
                            ? `Arquivo atual: ${nfseCertificateFileName}`
                            : "Nenhum certificado enviado."}
                        </p>
                        {(editingLandlord as any)?.nfseCertificateUpdatedAt && (
                          <p className="text-xs text-muted-foreground">
                            Última atualização: {new Date((editingLandlord as any).nfseCertificateUpdatedAt).toLocaleString("pt-BR")}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseCertificatePassword">Senha do Certificado</Label>
                        <Input
                          id="nfseCertificatePassword"
                          name="nfseCertificatePassword"
                          type="password"
                          placeholder={(editingLandlord as any)?.nfseCertificateFileName ? "Preencha apenas para alterar a senha" : "Senha do arquivo .pfx"}
                        />
                        <p className="text-xs text-muted-foreground">
                          Por segurança, a senha atual não é exibida. Informe novamente apenas se quiser cadastrar ou alterar.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="nfseLastNumber">Último Número NFS-e</Label>
                        <Input
                          id="nfseLastNumber"
                          value={String((editingLandlord as any)?.nfseLastNumber || 0)}
                          readOnly
                          disabled
                        />
                        <p className="text-xs text-muted-foreground">
                          Controlado automaticamente pelo sistema após cada emissão do proprietário.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

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
