import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Loader2, RotateCcw, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AuditLogItem = {
  id: string;
  timestamp: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  route: string | null;
  requestIp: string | null;
  userName: string | null;
  userEmail: string | null;
};

const ENTITY_OPTIONS = [
  { value: "ALL", label: "Todas as entidades" },
  { value: "USUARIO", label: "Usuários" },
  { value: "PROPRIETARIO", label: "Proprietários" },
  { value: "LOCATARIO", label: "Locatários" },
  { value: "FIADOR", label: "Fiadores" },
  { value: "PRESTADOR", label: "Prestadores" },
  { value: "IMOVEL", label: "Imóveis" },
  { value: "CONTRATO", label: "Contratos" },
  { value: "RECIBO", label: "Recibos" },
  { value: "SERVICO", label: "Serviços" },
  { value: "CAIXA", label: "Caixa" },
  { value: "LANCAMENTO_FINANCEIRO", label: "Controle de Despesas" },
];

const ENTITY_LABELS: Record<string, string> = Object.fromEntries(
  ENTITY_OPTIONS.filter((option) => option.value !== "ALL").map((option) => [option.value, option.label]),
);

const FIELD_LABELS_BY_ENTITY: Record<string, Record<string, string>> = {
  LANCAMENTO_FINANCEIRO: {
    date: "Data",
    type: "Tipo",
    category: "Categoria",
    description: "Descrição",
    amount: "Valor",
    refMonth: "Mês de Referência",
    refYear: "Ano de Referência",
  },
  IMOVEL: {
    code: "Código",
    title: "Título",
    type: "Tipo do Imóvel",
    saleRent: "Aluguel/Venda",
    address: "Endereço",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    zipCode: "CEP",
    rentDefault: "Aluguel Padrão",
    landlordId: "Proprietário Principal",
    landlordShares: "Proprietários e Percentuais",
    status: "Status",
  },
  USUARIO: {
    name: "Nome",
    email: "E-mail",
    role: "Função",
    permissions: "Permissões",
    passwordHash: "Senha",
    isTwoFactorEnabled: "Autenticação em 2 Fatores",
  },
  PROPRIETARIO: {
    name: "Nome",
    doc: "CPF/CNPJ",
    email: "E-mail",
    phone: "Telefone",
    address: "Endereço",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    zipCode: "CEP",
    code: "Código",
  },
  LOCATARIO: {
    code: "Código",
    name: "Nome",
    doc: "CPF",
    rg: "RG",
    birthDate: "Data de Nascimento",
    maritalStatus: "Estado Civil",
    profession: "Profissão",
    class: "Classe",
    email: "E-mail",
    phone: "Telefone",
    address: "Endereço",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    zipCode: "CEP",
    pixKeyType: "Tipo de Chave PIX",
    pixKey: "Chave PIX",
  },
  FIADOR: {
    code: "Código",
    name: "Nome",
    doc: "CPF/CNPJ",
    rg: "RG",
    birthDate: "Data de Nascimento",
    maritalStatus: "Estado Civil",
    profession: "Profissão",
    class: "Classe",
    email: "E-mail",
    phone: "Telefone",
    address: "Endereço",
    neighborhood: "Bairro",
    city: "Cidade",
    state: "Estado",
    zipCode: "CEP",
    spouseName: "Nome do Cônjuge",
    spouseDoc: "CPF do Cônjuge",
    spouseRg: "RG do Cônjuge",
  },
  PRESTADOR: {
    name: "Nome",
    serviceType: "Tipo de Serviço",
    doc: "CPF/CNPJ",
    phone: "Telefone",
    email: "E-mail",
  },
  CONTRATO: {
    propertyId: "Imóvel",
    landlordId: "Proprietário",
    tenantId: "Locatário",
    guarantorId: "Fiador",
    guaranteeType: "Garantia",
    startDate: "Data Inicial",
    duration: "Prazo",
    endDate: "Data Final",
    firstDueDate: "Primeiro Vencimento",
    dueDay: "Dia do Vencimento",
    rentAmount: "Valor do Aluguel",
    adminFeePercent: "Taxa de Administração",
    status: "Status",
    insuranceValue: "Valor do Seguro Fiança",
  },
  SERVICO: {
    contractId: "Contrato",
    providerId: "Prestador",
    description: "Descrição",
    refMonth: "Mês de Referência",
    refYear: "Ano de Referência",
    amount: "Valor",
    chargedTo: "Cobrar de",
    passThrough: "Repasse",
  },
  RECIBO: {
    status: "Status",
    dueDate: "Vencimento",
    adminFeeAmount: "Taxa de Administração",
    adminFeePercent: "Percentual da Taxa",
    landlordTotalDue: "Total do Proprietário",
    tenantTotalDue: "Total do Locatário",
    interestAmount: "Juros",
    isSlipIssued: "Boleto Emitido",
    landlordSplitOverride: "Rateio Prévio",
  },
  CAIXA: {
    type: "Tipo",
    date: "Data",
    category: "Categoria",
    description: "Descrição",
    amount: "Valor",
    receiptId: "Recibo",
  },
};

function entityLabel(entityType: string) {
  return ENTITY_LABELS[entityType] || entityType;
}

function fieldLabel(entityType: string, fieldName: string | null) {
  if (!fieldName) return "-";
  return FIELD_LABELS_BY_ENTITY[entityType]?.[fieldName] || fieldName;
}

function translateFixedValue(entityType: string, fieldName: string | null, value: string) {
  if (!value) return value;

  if (value === "[OCULTO]") return "Oculto";
  if (value === "true") return "Sim";
  if (value === "false") return "Não";

  if (entityType === "LANCAMENTO_FINANCEIRO") {
    if (fieldName === "type") {
      if (value === "IN") return "Entrada";
      if (value === "OUT") return "Saída";
      if (value === "BALANCE") return "Saldo Inicial";
    }

    if (fieldName === "category") {
      if (value === "CORPORATE") return "Corporativa";
      if (value === "PRIVATE") return "Particular";
      if (value === "BALANCE") return "Saldo Inicial";
    }
  }

  if (entityType === "IMOVEL") {
    if (fieldName === "status") {
      if (value === "available") return "Disponível";
      if (value === "rented") return "Alugado";
      if (value === "maintenance") return "Manutenção";
    }

    if (fieldName === "saleRent") {
      if (value === "Aluguel") return "Aluguel";
      if (value === "Venda") return "Venda";
    }

    if (fieldName === "type") {
      if (value === "RESIDENCIAL") return "Residencial";
      if (value === "COMERCIAL") return "Comercial";
    }
  }

  if (entityType === "RECIBO" && fieldName === "status") {
    if (value === "draft") return "Rascunho";
    if (value === "closed") return "Fechado";
    if (value === "paid") return "Pago";
    if (value === "transferred") return "Repassado";
  }

  if (entityType === "CONTRATO") {
    if (fieldName === "status") {
      if (value === "active") return "Ativo";
      if (value === "inactive") return "Inativo";
      if (value === "terminated") return "Encerrado";
    }

    if (fieldName === "guaranteeType") {
      if (value === "fiador") return "Fiador";
      if (value === "seguro_fianca") return "Seguro Fiança";
      if (value === "caucao") return "Caução";
      if (value === "sem_garantia") return "Sem Garantia";
    }
  }

  if (entityType === "SERVICO") {
    if (fieldName === "chargedTo") {
      if (value === "TENANT") return "Locatário";
      if (value === "LANDLORD") return "Proprietário";
      if (value === "NONE") return "Não cobrar";
    }
  }

  if (entityType === "CAIXA" && fieldName === "type") {
    if (value === "IN") return "Entrada";
    if (value === "OUT") return "Saída";
  }

  if (entityType === "USUARIO" && fieldName === "role") {
    if (value === "admin") return "Administrador";
    if (value === "user") return "Usuário";
  }

  return value;
}

function actionLabel(action: string) {
  switch (action) {
    case "CREATE":
      return "Criação";
    case "UPDATE":
      return "Alteração";
    case "DELETE":
      return "Exclusão";
    default:
      return action;
  }
}

function renderValue(entityType: string, fieldName: string | null, value: string | null) {
  if (value === null || value === undefined || value === "") return "(vazio)";
  return translateFixedValue(entityType, fieldName, value);
}

export default function AuditLogsPage() {
  const { user } = useAuth();
  const hasAccess = !!user && (user.role === "admin" || (Array.isArray(user.permissions) && user.permissions.includes("menu_audit")));

  const [search, setSearch] = useState("");
  const [action, setAction] = useState("ALL");
  const [entityType, setEntityType] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [limit, setLimit] = useState("300");

  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", limit);
    if (search.trim()) params.set("search", search.trim());
    if (action !== "ALL") params.set("action", action);
    if (entityType !== "ALL") params.set("entityType", entityType);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    return [`/api/audit-logs?${params.toString()}`];
  }, [action, endDate, entityType, limit, search, startDate]);

  const { data: logs, isLoading } = useQuery<AuditLogItem[]>({
    queryKey,
    enabled: hasAccess,
    refetchInterval: 15000,
  });

  if (!hasAccess) {
    return (
      <div className="container mx-auto max-w-6xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Auditoria</CardTitle>
          </CardHeader>
          <CardContent>
            Você não tem permissão para visualizar a auditoria do sistema.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Auditoria</h1>
        <p className="text-muted-foreground mt-2">
          Histórico de quem alterou cada campo, com valores anteriores e novos.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="relative md:col-span-2 xl:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por usuário, entidade, campo ou valor"
              className="pl-9"
            />
          </div>

          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue placeholder="Ação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as ações</SelectItem>
              <SelectItem value="CREATE">Criação</SelectItem>
              <SelectItem value="UPDATE">Alteração</SelectItem>
              <SelectItem value="DELETE">Exclusão</SelectItem>
            </SelectContent>
          </Select>

          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger>
              <SelectValue placeholder="Entidade" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />

          <div className="flex gap-2">
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger>
                <SelectValue placeholder="Limite" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100 registros</SelectItem>
                <SelectItem value="300">300 registros</SelectItem>
                <SelectItem value="1000">1000 registros</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setAction("ALL");
                setEntityType("ALL");
                setStartDate("");
                setEndDate("");
                setLimit("300");
              }}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table className="table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[12%]">Data/Hora</TableHead>
                  <TableHead className="w-[16%]">Usuário</TableHead>
                  <TableHead className="w-[10%]">Ação</TableHead>
                  <TableHead className="w-[18%]">Entidade</TableHead>
                  <TableHead className="w-[14%]">Campo</TableHead>
                  <TableHead className="w-[15%]">Valor Anterior</TableHead>
                  <TableHead className="w-[15%]">Novo Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs && logs.length > 0 ? (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs break-words whitespace-normal">
                        {format(new Date(log.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </TableCell>
                      <TableCell className="break-words whitespace-normal">
                        <div className="font-medium">{log.userName || "Sistema"}</div>
                        <div className="text-xs text-muted-foreground">{log.userEmail || log.requestIp || "-"}</div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.action === "DELETE"
                              ? "destructive"
                              : log.action === "UPDATE"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {actionLabel(log.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="break-words whitespace-normal">
                        <div className="font-medium">{log.entityLabel || log.entityId}</div>
                        <div className="text-xs text-muted-foreground">{entityLabel(log.entityType)}</div>
                      </TableCell>
                      <TableCell className="break-words whitespace-normal">
                        <div>{fieldLabel(log.entityType, log.fieldName)}</div>
                        <div className="text-xs text-muted-foreground">{log.route || "-"}</div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-pre-wrap break-words align-top">
                        {renderValue(log.entityType, log.fieldName, log.oldValue)}
                      </TableCell>
                      <TableCell className="text-xs whitespace-pre-wrap break-words align-top">
                        {renderValue(log.entityType, log.fieldName, log.newValue)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhum registro encontrado para os filtros informados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Campos sensíveis como senhas, segredos, certificados e chave PIX aparecem mascarados na auditoria.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
