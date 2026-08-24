import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Users, Shield, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { PermissionGuard } from "@/components/permission-guard";
import {
  applyFieldPermissions,
  FIELD_PERMISSION_CONFIGS,
  getEditableFields,
  getEditableFieldKeys,
  getFieldPermissionState,
  stripFieldPermissions,
  type EditableActionId,
  type FieldPermissionMode,
} from "@shared/field-permissions";


const PERMISSION_STRUCTURE = [
  {
    category: "Visão Geral",
    items: [
      { id: "menu_dashboard", label: "Dashboard", actions: [] },
    ]
  },
  {
    category: "Cadastros",
    items: [
      { 
        id: "menu_properties", 
        label: "Imóveis", 
        actions: [
          { id: "create_property", label: "Criar Imóvel" },
          { id: "edit_property", label: "Editar Imóvel" },
          { id: "delete_property", label: "Excluir Imóvel" },
        ] 
      },
      { 
        id: "menu_landlords", 
        label: "Proprietários", 
        actions: [
          { id: "create_landlord", label: "Criar Proprietário" },
          { id: "edit_landlord", label: "Editar Proprietário" },
          { id: "delete_landlord", label: "Excluir Proprietário" },
        ] 
      },
      { 
        id: "menu_tenants", 
        label: "Locatários", 
        actions: [
          { id: "create_tenant", label: "Criar Locatário" },
          { id: "edit_tenant", label: "Editar Locatário" },
          { id: "delete_tenant", label: "Excluir Locatário" },
        ] 
      },
      { 
        id: "menu_guarantors", 
        label: "Fiadores", 
        actions: [
          { id: "create_guarantor", label: "Criar Fiador" },
          { id: "edit_guarantor", label: "Editar Fiador" },
          { id: "delete_guarantor", label: "Excluir Fiador" },
        ] 
      },
      { 
        id: "menu_providers", 
        label: "Prestadores", 
        actions: [
          { id: "create_provider", label: "Criar Prestador" },
          { id: "edit_provider", label: "Editar Prestador" },
          { id: "delete_provider", label: "Excluir Prestador" },
        ] 
      },
    ]
  },
  {
    category: "Contratos",
    items: [
      { 
        id: "menu_contracts", 
        label: "Contratos", 
        actions: [
          { id: "create_contract", label: "Criar Contrato" },
          { id: "edit_contract", label: "Editar Contrato" },
          { id: "delete_contract", label: "Excluir Contrato" },
        ] 
      },
    ]
  },
  {
    category: "Financeiro",
    items: [
      { 
        id: "menu_receipts", 
        label: "Recibos", 
        actions: [
          { id: "edit_receipt", label: "Editar Recibo" },
          { id: "generate_receipt", label: "Gerar Recibo" },
          { id: "delete_receipt", label: "Excluir Recibo" },
          { id: "mark_receipt_paid", label: "Marcar como Pago" },
          { id: "issue_slip", label: "Emitir Boleto" },
        ] 
      },
      { 
        id: "menu_invoices", 
        label: "Notas Fiscais", 
        actions: [
          { id: "issue_invoice", label: "Emitir NF-e" },
          { id: "cancel_invoice", label: "Cancelar NF-e" },
          { id: "delete_invoice", label: "Excluir NF-e" },
        ] 
      },
      { 
        id: "menu_transfers", 
        label: "Repasses", 
        actions: [
          { id: "generate_transfer", label: "Gerar Repasse" },
          { id: "manual_transfer", label: "Repasse Manual" },
          { id: "delete_transfer", label: "Excluir Repasse" },
          { id: "reverse_transfer", label: "Estornar Repasse" },
          { id: "execute_pix", label: "Executar PIX" },
        ] 
      },
      { 
        id: "menu_services", 
        label: "Serviços", 
        actions: [
          { id: "create_service", label: "Criar Serviço" },
          { id: "edit_service", label: "Editar Serviço" },
          { id: "delete_service", label: "Excluir Serviço" },
        ] 
      },
      { 
        id: "menu_cash", 
        label: "Caixa", 
        actions: [
          { id: "create_transaction", label: "Criar Transação" },
          { id: "edit_transaction", label: "Editar Transação" },
          { id: "delete_transaction", label: "Excluir Transação" },
          { id: "reverse_payment", label: "Estornar Pagamento" },
        ] 
      },
      { 
        id: "menu_adjustments", 
        label: "Ajustes", 
        actions: [
          { id: "create_adjustment", label: "Criar Ajuste" },
          { id: "edit_adjustment", label: "Editar Ajuste" },
          { id: "delete_adjustment", label: "Excluir Ajuste" },
        ] 
      },
    ]
  },
  {
    category: "Relatórios",
    items: [
      { id: "menu_reports", label: "Relatórios Gerais", actions: [] },
      { id: "menu_report_transfers", label: "Relatórios - Repasse", actions: [] },
      { id: "menu_report_revenue", label: "Relatórios - Receita", actions: [] },
      { id: "menu_report_insurance", label: "Relatórios - Seguro Fiança", actions: [] },
      { id: "menu_report_invoices_issued", label: "Relatórios - Notas Fiscais Emitidas", actions: [] },
    ]
  },
  {
    category: "Contabilidade",
    items: [
      { id: "menu_accounting_export_nfs", label: "Exportar NF's", actions: [] },
    ]
  },
  {
    category: "Sistema",
    items: [
      { 
        id: "menu_users", 
        label: "Usuários", 
        actions: [
          { id: "create_user", label: "Criar Usuário" },
          { id: "edit_user", label: "Editar Usuário" },
          { id: "delete_user", label: "Excluir Usuário" },
        ] 
      },
      { id: "menu_settings", label: "Configurações", actions: [] },
      { id: "menu_audit", label: "Auditoria", actions: [] },
      { id: "menu_logs", label: "Logs do Sistema", actions: [] },
    ]
  },
];

const EDITABLE_FIELD_ACTIONS = Object.keys(FIELD_PERMISSION_CONFIGS) as EditableActionId[];

export default function UsersPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [isFieldDialogOpen, setIsFieldDialogOpen] = useState(false);
  const [activeFieldAction, setActiveFieldAction] = useState<EditableActionId | null>(null);
  const [fieldModes, setFieldModes] = useState<Partial<Record<EditableActionId, FieldPermissionMode>>>({});
  const [fieldSelections, setFieldSelections] = useState<Partial<Record<EditableActionId, string[]>>>({});
  const { toast } = useToast();

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Usuário criado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PATCH", `/api/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Usuário atualizado com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Sucesso", description: "Usuário excluído com sucesso." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    for (const actionId of EDITABLE_FIELD_ACTIONS) {
      if (!selectedPermissions.includes(actionId)) continue;
      const mode = fieldModes[actionId] || "all";
      const selectedFields = fieldSelections[actionId] || getEditableFieldKeys(actionId);
      if (mode === "custom" && selectedFields.length === 0) {
        toast({
          title: "Campos de edição",
          description: `Selecione ao menos um campo em ${FIELD_PERMISSION_CONFIGS[actionId].label} ou escolha Todos/Nenhum.`,
          variant: "destructive",
        });
        return;
      }
    }

    let permissions = [...selectedPermissions];
    for (const actionId of EDITABLE_FIELD_ACTIONS) {
      permissions = applyFieldPermissions(
        actionId,
        permissions,
        fieldModes[actionId] || "all",
        (fieldSelections[actionId] || getEditableFieldKeys(actionId)) as any,
      );
    }

    const data: any = {
      name: formData.get("name"),
      email: formData.get("email"),
      role: formData.get("role"),
      permissions: permissions,
    };

    const password = formData.get("password") as string;
    if (password) {
      data.password = password;
    }

    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      if (!password) {
        toast({ title: "Erro", description: "Senha é obrigatória para novos usuários.", variant: "destructive" });
        return;
      }
      createMutation.mutate(data);
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    if (confirm("Tem certeza que deseja excluir este usuário?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleOpenDialog = () => {
    setEditingUser(null);
    setIsDialogOpen(true);
  };

  useEffect(() => {
    if (!isDialogOpen) {
      setSelectedPermissions([]);
      setFieldModes({});
      setFieldSelections({});
      setActiveFieldAction(null);
      setIsFieldDialogOpen(false);
      return;
    }

    const permissions = Array.isArray(editingUser?.permissions) ? editingUser.permissions : [];
    setSelectedPermissions(permissions);
    const nextModes: Partial<Record<EditableActionId, FieldPermissionMode>> = {};
    const nextSelections: Partial<Record<EditableActionId, string[]>> = {};
    for (const actionId of EDITABLE_FIELD_ACTIONS) {
      const state = getFieldPermissionState(actionId, permissions);
      nextModes[actionId] = state.mode;
      nextSelections[actionId] = state.mode === "all" ? getEditableFieldKeys(actionId) : state.fields;
    }
    setFieldModes(nextModes);
    setFieldSelections(nextSelections);
  }, [editingUser, isDialogOpen]);

  const fieldPermissionSummary = useMemo(() => {
    const entries = {} as Partial<Record<EditableActionId, string>>;
    for (const actionId of EDITABLE_FIELD_ACTIONS) {
      if (!selectedPermissions.includes(actionId)) continue;
      const mode = fieldModes[actionId] || "all";
      const selectedFields = fieldSelections[actionId] || getEditableFieldKeys(actionId);
      entries[actionId] =
        mode === "all" ? "Todos" :
        mode === "none" ? "Nenhum" :
        `Personalizado (${selectedFields.length})`;
    }
    return entries;
  }, [fieldModes, fieldSelections, selectedPermissions]);

  const togglePermission = (permission: string, checked: boolean) => {
    setSelectedPermissions((current) => {
      const withoutCurrent = current.filter((item) => item !== permission);
      const nextPermissions = checked ? [...withoutCurrent, permission] : withoutCurrent;

      if (!checked && EDITABLE_FIELD_ACTIONS.includes(permission as EditableActionId)) {
        return stripFieldPermissions(nextPermissions, permission as EditableActionId);
      }

      return nextPermissions;
    });
  };

  const toggleCustomField = (actionId: EditableActionId, field: string, checked: boolean) => {
    setFieldSelections((current) => {
      const currentFields = current[actionId] || [];
      const nextFields = checked
        ? (currentFields.includes(field) ? currentFields : [...currentFields, field])
        : currentFields.filter((item) => item !== field);
      return { ...current, [actionId]: nextFields };
    });
  };

  const filteredUsers = users?.filter(user =>
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Usuários</h2>
          <p className="text-muted-foreground">Gerencie usuários e suas permissões de acesso.</p>
        </div>
        <PermissionGuard permission="create_user">
          <Button onClick={handleOpenDialog}>
            <Plus className="mr-2 h-4 w-4" /> Novo Usuário
          </Button>
        </PermissionGuard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de Usuários</CardTitle>
          <CardDescription>
            Visualize e gerencie os usuários do sistema.
          </CardDescription>
          <div className="flex items-center space-x-2 mt-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Permissões</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">Carregando...</TableCell>
                </TableRow>
              ) : filteredUsers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">Nenhum usuário encontrado.</TableCell>
                </TableRow>
              ) : (
                filteredUsers?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                        {user.role === "admin" ? "Administrador" : "Usuário"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.role === "admin" ? (
                          <Badge variant="outline" className="bg-green-50">Acesso Total</Badge>
                        ) : (
                          Array.isArray(user.permissions) && user.permissions.length > 0 ? (
                            <span className="text-xs text-muted-foreground">{user.permissions.length} permissões</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Nenhuma</span>
                          )
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.isTwoFactorEnabled ? (
                        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
                          <Check className="h-3 w-3 mr-1" /> Ativado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-200 bg-yellow-50">
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <PermissionGuard permission="edit_user">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </PermissionGuard>
                      <PermissionGuard permission="delete_user">
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(user.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </PermissionGuard>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
            <DialogDescription>
              Preencha os dados do usuário e selecione suas permissões.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome Completo</Label>
                <Input id="name" name="name" defaultValue={editingUser?.name} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" defaultValue={editingUser?.email} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Função</Label>
                <Select name="role" defaultValue={editingUser?.role || "user"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a função" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Usuário Comum</SelectItem>
                    <SelectItem value="admin">Administrador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha {editingUser && "(deixe em branco para manter)"}</Label>
                <Input id="password" name="password" type="password" />
              </div>
            </div>

            <div className="space-y-4 border rounded-md p-4 h-[60vh] overflow-y-auto">
              <h3 className="font-medium flex items-center gap-2 mb-4 sticky top-0 bg-background z-10 pb-2 border-b">
                <Shield className="h-4 w-4" /> Permissões de Acesso
              </h3>
              
              <div className="space-y-6">
                {PERMISSION_STRUCTURE.map((category) => (
                  <div key={category.category} className="space-y-3">
                    <h4 className="text-sm font-bold text-primary bg-muted/30 p-2 rounded-md">
                      {category.category}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2">
                      {category.items.map((menu) => (
                        <div key={menu.id} className="border rounded-lg p-3 space-y-3 bg-card hover:shadow-sm transition-shadow">
                          <div className="flex items-center space-x-2 font-medium">
                            <Checkbox 
                              id={menu.id} 
                              checked={selectedPermissions.includes(menu.id)}
                              onCheckedChange={(checked) => togglePermission(menu.id, checked === true)}
                            />
                            <Label htmlFor={menu.id} className="cursor-pointer text-base">{menu.label}</Label>
                          </div>
                          
                          {menu.actions.length > 0 && (
                            <div className="pl-6 grid grid-cols-1 gap-2 pt-1 border-t mt-2">
                              {menu.actions.map((action) => (
                                <div key={action.id} className="flex items-center justify-between gap-2">
                                  <div className="flex items-center space-x-2">
                                    <Checkbox
                                      id={action.id}
                                      checked={selectedPermissions.includes(action.id)}
                                      onCheckedChange={(checked) => togglePermission(action.id, checked === true)}
                                    />
                                    <Label htmlFor={action.id} className="cursor-pointer font-normal text-muted-foreground">{action.label}</Label>
                                  </div>
                                  {EDITABLE_FIELD_ACTIONS.includes(action.id as EditableActionId) && selectedPermissions.includes(action.id) && (
                                    <div className="flex items-center gap-2">
                                      {fieldPermissionSummary[action.id as EditableActionId] && (
                                        <Badge variant="outline" className="text-xs">
                                          {fieldPermissionSummary[action.id as EditableActionId]}
                                        </Badge>
                                      )}
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => {
                                          setActiveFieldAction(action.id as EditableActionId);
                                          setIsFieldDialogOpen(true);
                                        }}
                                        title="Configurar campos editáveis"
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                * Administradores têm acesso total independente das permissões marcadas.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isFieldDialogOpen} onOpenChange={setIsFieldDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {activeFieldAction ? `Editar ${FIELD_PERMISSION_CONFIGS[activeFieldAction].label}: campos permitidos` : "Campos permitidos"}
            </DialogTitle>
            <DialogDescription>
              Defina se o usuário poderá editar todos os campos, nenhum, ou apenas alguns campos deste módulo.
            </DialogDescription>
          </DialogHeader>

          {activeFieldAction && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Modo de edição</Label>
              <Select
                value={fieldModes[activeFieldAction] || "all"}
                onValueChange={(value) =>
                  setFieldModes((current) => ({
                    ...current,
                    [activeFieldAction]: value as FieldPermissionMode,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="none">Nenhum</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(fieldModes[activeFieldAction] || "all") === "custom" && (
              <div className="space-y-3 border rounded-md p-4 max-h-[50vh] overflow-y-auto">
                <div className="text-sm font-medium">Campos de {FIELD_PERMISSION_CONFIGS[activeFieldAction].label}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {getEditableFields(activeFieldAction).map((field) => (
                    <div key={field.key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`${activeFieldAction}-field-${field.key}`}
                        checked={(fieldSelections[activeFieldAction] || []).includes(field.key)}
                        onCheckedChange={(checked) => toggleCustomField(activeFieldAction, field.key, checked === true)}
                      />
                      <Label htmlFor={`${activeFieldAction}-field-${field.key}`} className="cursor-pointer font-normal">
                        {field.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsFieldDialogOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
