import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, FileCheck, Loader2, Check, AlertCircle, FileText, Trash2, Ban, Download, RefreshCw, Eye, Printer, ListChecks, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PermissionGuard } from "@/components/permission-guard";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Invoice, Landlord, Receipt, Contract, Property, NfseEmissao, Tenant } from "@shared/schema";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiUrl, absoluteApiUrl } from "@/lib/api-base";

const months = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" }, { value: "3", label: "Março" },
  { value: "4", label: "Abril" }, { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" }, { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" }, { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

const LANDLORD_NFSE_INVOICE_CATEGORY = "PROPRIETARIO_NFSE";
const LANDLORD_NFSE_ORIGIN_TYPE = "LANDLORD_NFSE";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  draft: { label: "Rascunho", variant: "outline", icon: FileText },
  issued: { label: "Emitida", variant: "default", icon: Check },
  error: { label: "Erro", variant: "destructive", icon: AlertCircle },
  cancelled: { label: "Cancelada", variant: "secondary", icon: Ban },
  PENDENTE: { label: "Pendente", variant: "secondary", icon: Loader2 },
  ENVIANDO: { label: "Enviando", variant: "secondary", icon: Loader2 },
  EMITIDA: { label: "NFS-e Emitida", variant: "default", icon: Check },
  FALHOU: { label: "Falha Emissão", variant: "destructive", icon: AlertCircle },
};

function getEffectiveEmissaoStatus(emissao?: NfseEmissao | null) {
  if (!emissao) return null;
  if (emissao.status === "ENVIANDO" && (emissao.erroCodigo || emissao.erroMensagem)) {
    return "FALHOU";
  }
  return emissao.status;
}

function getTime(value: unknown) {
  if (!value) return 0;
  const dt = value instanceof Date ? value : new Date(String(value));
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getStatusRank(status: string | null) {
  if (status === "EMITIDA") return 3;
  if (status === "ENVIANDO") return 2;
  if (status === "PENDENTE") return 1;
  if (status === "FALHOU") return 0;
  return -1;
}

const debugUpdateNfseNumberClient = (location: string, hypothesisId: "A" | "B" | "C" | "D" | "E", msg: string, data: Record<string, unknown>) => {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "update-nfse-number-json-error",
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};

// #region debug-point D:nfse-reprocess-client-log
const debugNfseReprocessClient = (hypothesisId: "A" | "B" | "C" | "D" | "E", location: string, msg: string, data: Record<string, unknown>) => {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "nfse-reprocess-lock",
      runId: "pre-fix",
      hypothesisId,
      location,
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
};
// #endregion

type InvoiceListItem = Invoice & {
  receiptRefMonth?: number | null;
  receiptRefYear?: number | null;
  propertyTitle?: string | null;
  propertyAddress?: string | null;
};

export default function InvoicesPage() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const { toast } = useToast();

  const [filterMonth, setFilterMonth] = useState(String(currentMonth));
  const [filterYear, setFilterYear] = useState(String(currentYear));
  const [statusFilter, setStatusFilter] = useState<"all" | "issued" | "draft" | "cancelled">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "landlord" | "agency">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEmissao, setSelectedEmissao] = useState<NfseEmissao | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [invoiceToDelete, setInvoiceToDelete] = useState<string | null>(null);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [emittingIds, setEmittingIds] = useState<Set<string>>(new Set());

  const { data: invoices, isLoading: isLoadingInvoices } = useQuery<InvoiceListItem[]>({ queryKey: ["/api/invoices"] });
  const { data: landlords, isLoading: isLoadingLandlords } = useQuery<Landlord[]>({ queryKey: ["/api/landlords"] });
  const { data: tenants, isLoading: isLoadingTenants } = useQuery<Tenant[]>({ queryKey: ["/api/tenants"] });
  const { data: contracts, isLoading: isLoadingContracts } = useQuery<Contract[]>({ queryKey: ["/api/contracts"] });
  const { data: properties, isLoading: isLoadingProperties } = useQuery<Property[]>({ queryKey: ["/api/properties"] });
  const { data: emissoes, isLoading: isLoadingEmissoes } = useQuery<NfseEmissao[]>({ queryKey: ["/api/nfse/emissoes"] });

  const receiptIds = Array.from(new Set((invoices || []).map(i => i.receiptId).filter(Boolean)));
  const { data: receiptsByIds, isLoading: isLoadingReceiptsByIds } = useQuery<Receipt[]>({
    queryKey: ["/api/receipts/by-ids", receiptIds.slice().sort().join(",")],
    enabled: receiptIds.length > 0,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/receipts/by-ids", { ids: receiptIds });
      return res.json();
    },
  });

  const isLoading =
    isLoadingInvoices ||
    isLoadingLandlords ||
    isLoadingTenants ||
    isLoadingContracts ||
    isLoadingProperties ||
    isLoadingEmissoes ||
    isLoadingReceiptsByIds;

  const isLandlordNfseInvoice = (invoice: InvoiceListItem) =>
    (invoice as any).invoiceCategory === LANDLORD_NFSE_INVOICE_CATEGORY;

  const getInvoiceOriginType = (invoice: InvoiceListItem) =>
    isLandlordNfseInvoice(invoice) ? LANDLORD_NFSE_ORIGIN_TYPE : "INVOICE";

  const getInvoiceReference = (invoice: InvoiceListItem) => {
    if (invoice.receiptRefMonth && invoice.receiptRefYear) {
      return `${String(invoice.receiptRefMonth).padStart(2, "0")}/${invoice.receiptRefYear}`;
    }
    return "";
  };

  const getTenantForInvoice = (invoice: InvoiceListItem) => {
    const receipt = receiptsByIds?.find((item) => item.id === invoice.receiptId);
    const contract = receipt ? contracts?.find((item) => item.id === receipt.contractId) : undefined;
    return contract ? tenants?.find((item) => item.id === contract.tenantId) : undefined;
  };

  const getTomadorForInvoice = (invoice: InvoiceListItem) => {
    if (isLandlordNfseInvoice(invoice)) {
      const tenant = getTenantForInvoice(invoice);
      return {
        nome: tenant?.name || "Locatário",
        doc: tenant?.doc || "",
      };
    }

    const landlord = landlords?.find((item) => item.id === invoice.landlordId);
    return {
      nome: landlord?.name || "Desconhecido",
      doc: landlord?.doc || "",
    };
  };

  const getInvoiceDiscriminacao = (invoice: InvoiceListItem) => {
    const ref = getInvoiceReference(invoice);
    if (isLandlordNfseInvoice(invoice)) {
      const address = invoice.propertyAddress || invoice.propertyTitle || "imóvel";
      const competence = ref ? ref.replace("/", ".") : "";
      return `Recebimento de aluguel do imóvel situado à ${address}${competence ? `, referente à competência ${competence}` : ""}, conforme contrato de locação.`;
    }
    return `Serviços de administração imobiliária ref. ${ref} - ${invoice.propertyTitle || ""}`;
  };

  const processNfseMutation = useMutation({
    mutationFn: async (emissaoId: string) => {
      // #region debug-point D:process-mutation-start
      debugNfseReprocessClient("D", "client/src/pages/invoices.tsx:processNfseMutation:start", "Disparando reprocessamento de emissao existente", {
        emissaoId,
      });
      // #endregion
      const res = await fetch(`/api/nfse/emissoes/${emissaoId}/processar`, {
        method: "POST",
        credentials: "include",
      });
      const rawText = await res.text();
      let data: any = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        data = { message: rawText || "Erro ao processar NFS-e" };
      }

      if (!res.ok) {
        // #region debug-point D:process-mutation-failure
        debugNfseReprocessClient("D", "client/src/pages/invoices.tsx:processNfseMutation:failure", "Reprocessamento retornou falha HTTP", {
          emissaoId,
          status: res.status,
          body: data,
        });
        // #endregion
        if (res.status === 400 || res.status === 409) {
          return {
            success: false,
            message: data?.message || data?.error || "Falha ao emitir NFS-e",
            emissao: data?.emissao,
          };
        }

        throw new Error(data?.error || data?.message || rawText || res.statusText);
      }

      // #region debug-point D:process-mutation-success
      debugNfseReprocessClient("D", "client/src/pages/invoices.tsx:processNfseMutation:success", "Reprocessamento retornou sucesso HTTP", {
        emissaoId,
        body: data,
      });
      // #endregion

      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ title: "Sucesso", description: "NFS-e emitida com sucesso!" });
        queryClient.refetchQueries({ queryKey: ["/api/nfse/emissoes"] });
        queryClient.refetchQueries({ queryKey: ["/api/invoices"] });
      } else {
        toast({ title: "Falha", description: data.message || "Erro ao emitir NFS-e", variant: "destructive" });
        if (data.emissao?.id) {
          queryClient.setQueryData<NfseEmissao[]>(["/api/nfse/emissoes"], (current) => {
            if (!current) return current;
            return current.map((item) => item.id === data.emissao.id ? { ...item, ...data.emissao } : item);
          });
        }
      }
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nfse/emissoes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password?: string }) => {
      const headers: Record<string, string> = {};
      if (password) {
        headers["x-confirm-password"] = password;
      }
      const res = await fetch(`/api/invoices/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
          const json = JSON.parse(text);
          if (json.error) message = json.error;
        } catch {}
        throw new Error(message);
      }
      return res.json();
    },
    onSuccess: () => {
      // Forçar atualização imediata dos dados e fechar modal
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      queryClient.refetchQueries({ queryKey: ["/api/invoices"] }); // Refetch explícito
      toast({ title: "Sucesso", description: "Nota fiscal excluída com sucesso." });
      
      // Resetar estados do modal
      setDeleteDialogOpen(false);
      setDeletePassword("");
      setInvoiceToDelete(null);
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const batchEmissionMutation = useMutation({
    mutationFn: async (invoiceIds: string[]) => {
      const items = invoiceIds.map(id => {
        const invoice = invoices?.find(i => i.id === id);
        if (!invoice) throw new Error(`Invoice ${id} not found`);
        const tomador = getTomadorForInvoice(invoice);
        const discriminacao = getInvoiceDiscriminacao(invoice);
        const idempotencyKey = `${getInvoiceOriginType(invoice)}-${invoice.id}`;

        return {
          origemId: invoice.id,
          origemTipo: getInvoiceOriginType(invoice),
          valor: invoice.amount,
          valorServico: invoice.amount,
          valorIss: 0,
          baseCalculo: invoice.amount,
          tomadorCpfCnpj: tomador.doc,
          tomadorNome: tomador.nome,
          discriminacao,
          idempotencyKey
        };
      });

      const res = await apiRequest("POST", "/api/nfse/lotes", { itens: items });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/nfse/emissoes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ 
        title: "Sucesso", 
        description: `Lote criado com ${data.emissoes.length} notas. O processamento ocorrerá em segundo plano.` 
      });
      setSelectedInvoices([]);
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("DELETE", "/api/invoices/bulk", { ids });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/receipts"] });
      toast({ 
        title: "Sucesso", 
        description: `Processo finalizado. Sucesso: ${data.success}, Erros: ${data.errors}` 
      });
      if (data.errors > 0) {
        console.error("Bulk delete errors:", data.details);
      }
      setSelectedInvoices([]);
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const cancelInvoiceMutation = useMutation({
    mutationFn: async ({ emissaoId, motivo }: { emissaoId: string; motivo: string }) => {
      const res = await apiRequest("POST", `/api/nfse/emissoes/${emissaoId}/cancelar`, { motivo });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nfse/emissoes"] });
      toast({ title: "Sucesso", description: "Pedido de cancelamento enviado." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleCancelClick = (emissaoId: string) => {
    const motivo = prompt("Por favor, informe o motivo do cancelamento:");
    if (motivo) {
        cancelInvoiceMutation.mutate({ emissaoId, motivo });
    }
  };

  const manualEmitMutation = useMutation({
    mutationFn: async ({ invoiceId, chaveAcesso }: { invoiceId: string; chaveAcesso: string }) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/manual-nfse`, { chaveAcesso });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/nfse/emissoes"] });
      toast({ title: "Sucesso", description: "NFS-e marcada como emitida manualmente." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const refreshNumeroNfseMutation = useMutation({
    mutationFn: async (emissaoId: string) => {
      // #region debug-point E:update-numero-client-request
      debugUpdateNfseNumberClient("client/src/pages/invoices.tsx:refreshNumeroNfseMutation:start", "E", "Disparando requisicao para atualizar numero da NFS-e", {
        emissaoId,
        url: `/api/nfse/emissoes/${emissaoId}/atualizar-numero-xml`,
      });
      // #endregion
      const res = await fetch(`/api/nfse/emissoes/${emissaoId}/atualizar-numero-xml`, {
        method: "POST",
        credentials: "include",
      });
      const rawText = await res.text();
      // #region debug-point B:update-numero-client-response
      debugUpdateNfseNumberClient("client/src/pages/invoices.tsx:refreshNumeroNfseMutation:response", "B", "Resposta recebida ao atualizar numero da NFS-e", {
        emissaoId,
        status: res.status,
        ok: res.ok,
        redirected: res.redirected,
        contentType: res.headers.get("content-type"),
        bodyHead: rawText.slice(0, 220),
      });
      // #endregion
      if (!res.ok) {
        let message = rawText || res.statusText;
        try {
          const parsed = JSON.parse(rawText);
          message = parsed.error || parsed.message || message;
        } catch {}
        throw new Error(message);
      }
      return JSON.parse(rawText);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/nfse/emissoes"] });
      toast({
        title: "Número atualizado",
        description: `Número da NFS-e atualizado para ${data.numeroNfse}.`,
      });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleViewDetails = (emissao: NfseEmissao) => {
    setSelectedEmissao(emissao);
    setIsDetailsOpen(true);
  };

  const shareWhatsApp = async (emissao: NfseEmissao) => {
    if (!emissao.chaveAcesso) {
      toast({
        title: "Chave ausente",
        description: "Não foi possível localizar a chave de acesso da NFS-e.",
        variant: "destructive",
      });
      return;
    }

    const publicLink = absoluteApiUrl(`/api/public/nfse/danfse/${emissao.chaveAcesso}`);
    const message = `Olá, segue a DANFSe da NFS-e${emissao.numeroNfse ? ` nº ${emissao.numeroNfse}` : ""}.${emissao.chaveAcesso ? ` Chave: ${emissao.chaveAcesso}.` : ""} ${publicLink}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");

    toast({
      title: "Link gerado para envio",
      description: "O envio direto de arquivo pode falhar em alguns dispositivos. Enviando link para a DANFSe.",
    });
  };
  const issueInvoiceMutation = useMutation({
    mutationFn: async (invoice: InvoiceListItem) => {
      // 1. Criar emissão
      const tomador = getTomadorForInvoice(invoice);
      
      const payload = {
        origemId: invoice.id,
        origemTipo: getInvoiceOriginType(invoice),
        valor: invoice.amount,
        tomadorNome: tomador.nome,
        tomadorCpfCnpj: tomador.doc,
        discriminacao: getInvoiceDiscriminacao(invoice),
      };

      // Use Batch endpoint for consistency
      const res = await apiRequest("POST", "/api/nfse/lotes", { itens: [payload] });
      const data = await res.json(); // { lote, emissoes: [] }
      const emissao = data.emissoes?.[0];

      // 2. Processar imediatamente (simulando worker) if needed, but worker handles PENDENTE.
      // However, for UX feedback, we can trigger it.
      if (emissao && emissao.id) {
        await processNfseMutation.mutateAsync(emissao.id);
      }
      return emissao;
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleIssueInvoiceClick = async (invoice: Invoice) => {
    if (emittingIds.has(invoice.id)) return;
    setEmittingIds(prev => {
      const next = new Set(prev);
      next.add(invoice.id);
      return next;
    });
    try {
      const emissao = getNfseEmissao(invoice.id);
      const effectiveEmissaoStatus = getEffectiveEmissaoStatus(emissao);
      // #region debug-point D:handle-click
      debugNfseReprocessClient("D", "client/src/pages/invoices.tsx:handleIssueInvoiceClick", "Clique em emitir/reprocessar NF", {
        invoiceId: invoice.id,
        emissaoId: emissao?.id || null,
        emissaoStatusRaw: emissao?.status || null,
        emissaoStatusEffective: effectiveEmissaoStatus,
        erroCodigo: emissao?.erroCodigo || null,
        erroMensagem: emissao?.erroMensagem || null,
      });
      // #endregion
      if (emissao?.id && (effectiveEmissaoStatus === "FALHOU" || effectiveEmissaoStatus === "PENDENTE")) {
        await processNfseMutation.mutateAsync(emissao.id);
      } else {
        await issueInvoiceMutation.mutateAsync(invoice);
      }
    } finally {
      setEmittingIds(prev => {
        const next = new Set(prev);
        next.delete(invoice.id);
        return next;
      });
    }
  };
  const getLandlordName = (landlordId: string) => landlords?.find((l) => l.id === landlordId)?.name || "-";

  const getNfseEmissao = (invoiceId: string) => {
    const invoice = invoices?.find((item) => item.id === invoiceId);
    const originType = invoice ? getInvoiceOriginType(invoice) : "INVOICE";
    const matches = emissoes?.filter((e) => e.origemId === invoiceId && e.origemTipo === originType) || [];
    if (matches.length === 0) return undefined;
    return matches
      .slice()
      .sort((a, b) => {
        const aEffective = getEffectiveEmissaoStatus(a);
        const bEffective = getEffectiveEmissaoStatus(b);
        const byStatus = getStatusRank(bEffective) - getStatusRank(aEffective);
        if (byStatus !== 0) return byStatus;
        const byUpdated = getTime(b.updatedAt) - getTime(a.updatedAt);
        if (byUpdated !== 0) return byUpdated;
        return getTime(b.createdAt) - getTime(a.createdAt);
      })[0];
  };

  const parseRefFromDescription = (value?: string | null) => {
    const text = String(value || "");
    const m = text.match(/(\d{2})\/(\d{4})/);
    if (!m) return { refMonth: null as number | null, refYear: null as number | null };
    return { refMonth: Number(m[1]), refYear: Number(m[2]) };
  };

  const parsePropertyFromDescription = (value?: string | null) => {
    const text = String(value || "").trim();
    if (!text) return null as string | null;
    const match = text.match(/\d{2}\/\d{4}\s*-\s*(.+)$/i);
    return match?.[1]?.trim() || null;
  };

  const getReceiptInfo = (invoice: InvoiceListItem) => {
    const emissao = getNfseEmissao(invoice.id);
    const receipt = receiptsByIds?.find((r) => r.id === invoice.receiptId);
    const contract = receipt ? contracts?.find((c) => c.id === receipt.contractId) : undefined;
    const property = contract ? properties?.find((p) => p.id === contract.propertyId) : undefined;
    const parsedRef = parseRefFromDescription(emissao?.descricaoServico);
    const refMonth = invoice.receiptRefMonth ?? receipt?.refMonth ?? parsedRef.refMonth ?? null;
    const refYear = invoice.receiptRefYear ?? receipt?.refYear ?? parsedRef.refYear ?? null;
    const propertyLabel =
      invoice.propertyTitle ||
      invoice.propertyAddress ||
      property?.title ||
      property?.address ||
      parsePropertyFromDescription(emissao?.descricaoServico) ||
      "-";

    return {
      property: propertyLabel,
      ref:
        refMonth && refYear
          ? `${String(refMonth).padStart(2, "0")}/${refYear}`
          : "-",
      refMonth,
      refYear,
    };
  };

  const baseInvoices = invoices?.filter((i) => {
    const receipt = getReceiptInfo(i);
    if (receipt.refMonth && receipt.refYear) {
      return String(receipt.refMonth) === filterMonth && String(receipt.refYear) === filterYear;
    }

    const emissao = getNfseEmissao(i.id);
    const fallbackDateRaw = emissao?.updatedAt || emissao?.createdAt || i.createdAt;
    const fallbackDate = fallbackDateRaw ? new Date(fallbackDateRaw) : null;
    if (!fallbackDate || Number.isNaN(fallbackDate.getTime())) return false;
    return String(fallbackDate.getMonth() + 1) === filterMonth && String(fallbackDate.getFullYear()) === filterYear;
  });

  const filteredInvoices = baseInvoices?.filter((i) => {
    const emissao = getNfseEmissao(i.id);
    const displayStatus = emissao ? emissao.status : i.status;

    if (typeFilter === "landlord" && !isLandlordNfseInvoice(i)) {
      return false;
    }
    if (typeFilter === "agency" && isLandlordNfseInvoice(i)) {
      return false;
    }

    if (statusFilter === "issued" && displayStatus !== "EMITIDA" && displayStatus !== "issued") {
      return false;
    }
    if (statusFilter === "draft" && displayStatus !== "draft") {
      return false;
    }
    if (statusFilter === "cancelled" && displayStatus !== "CANCELADA" && displayStatus !== "cancelled") {
      return false;
    }

    const landlord = getLandlordName(i.landlordId);
    const receipt = getReceiptInfo(i);
    const s = searchTerm.toLowerCase();
    return !s
      ? true
      : landlord.toLowerCase().includes(s) ||
          receipt.property.toLowerCase().includes(s) ||
          receipt.ref.toLowerCase().includes(s) ||
          i.number?.toLowerCase().includes(s);
  });

  const draftCount = baseInvoices?.filter((i) => i.status === "draft").length || 0;
  const issuedCount = baseInvoices?.filter((i) => i.status === "issued" || (getNfseEmissao(i.id)?.status === "EMITIDA")).length || 0;

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const eligible = filteredInvoices?.filter(i => {
         const emissao = getNfseEmissao(i.id);
         const status = emissao ? emissao.status : i.status;
         return status === 'draft' || status === 'error' || status === 'FALHOU';
      }).map(i => i.id) || [];
      setSelectedInvoices(eligible);
    } else {
      setSelectedInvoices([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedInvoices(prev => [...prev, id]);
    } else {
      setSelectedInvoices(prev => prev.filter(i => i !== id));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notas Fiscais</h1>
          <p className="text-muted-foreground">Gerencie a emissão de notas fiscais</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rascunhos</CardTitle>
            <div className="p-2 rounded-md bg-yellow-500/10">
              <FileText className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{draftCount}</div>
            <p className="text-xs text-muted-foreground">Aguardando emissão</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Emitidas</CardTitle>
            <div className="p-2 rounded-md bg-green-500/10">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{issuedCount}</div>
            <p className="text-xs text-muted-foreground">Notas emitidas</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4 w-full">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-primary" />
                  Lista de Notas Fiscais
                </CardTitle>
                <CardDescription>{filteredInvoices?.length || 0} notas encontradas</CardDescription>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end w-full sm:w-auto">
              <div className="flex gap-2">
                <Select value={filterMonth} onValueChange={setFilterMonth}>
                  <SelectTrigger className="w-32" data-testid="select-filter-invoices-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={filterYear} onValueChange={setFilterYear}>
                  <SelectTrigger className="w-24" data-testid="select-filter-invoices-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 7 }, (_, i) => String(new Date().getFullYear() - 3 + i)).map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | "issued" | "draft" | "cancelled")}>
                  <SelectTrigger className="w-36" data-testid="select-filter-invoices-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="issued">Emitidas</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="cancelled">Canceladas</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as "all" | "landlord" | "agency")}>
                  <SelectTrigger className="w-40" data-testid="select-filter-invoices-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os Tipos</SelectItem>
                    <SelectItem value="landlord">Proprietario</SelectItem>
                    <SelectItem value="agency">Imobiliaria</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-invoices" />
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
          ) : filteredInvoices && filteredInvoices.length > 0 ? (
            <div className="overflow-x-auto pb-20">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">
                      <Checkbox 
                        checked={
                          selectedInvoices.length > 0 && 
                          filteredInvoices?.filter(i => {
                             const emissao = getNfseEmissao(i.id);
                             const status = emissao ? emissao.status : i.status;
                             return status === 'draft' || status === 'error' || status === 'FALHOU';
                          }).length === selectedInvoices.length
                        }
                        onCheckedChange={(checked) => handleSelectAll(!!checked)}
                      />
                    </TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Proprietário</TableHead>
                    <TableHead className="hidden md:table-cell">Imóvel</TableHead>
                    <TableHead>Referência</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead className="hidden lg:table-cell">Número NF</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right min-w-[320px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredInvoices.map((invoice) => {
                    const landlord = getLandlordName(invoice.landlordId);
                    const receipt = getReceiptInfo(invoice);
                    const emissao = getNfseEmissao(invoice.id);
                    const effectiveEmissaoStatus = getEffectiveEmissaoStatus(emissao);
                    
                    // Prioriza status da emissão NFS-e se existir, senão usa status da invoice
                    const displayStatus = effectiveEmissaoStatus || invoice.status;
                    const StatusIcon = statusLabels[displayStatus]?.icon || FileText;
                    
                    return (
                      <TableRow key={invoice.id} data-testid={`row-invoice-${invoice.id}`}>
                        <TableCell className="w-[50px]">
                          {(displayStatus === "draft" || displayStatus === "error" || displayStatus === "FALHOU") && (
                            <Checkbox 
                              checked={selectedInvoices.includes(invoice.id)}
                              onCheckedChange={(checked) => handleSelectOne(invoice.id, !!checked)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={isLandlordNfseInvoice(invoice) ? "secondary" : "outline"}>
                            {isLandlordNfseInvoice(invoice) ? "Proprietário" : "Imobiliária"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{landlord}</TableCell>
                        <TableCell className="hidden md:table-cell">{receipt.property}</TableCell>
                        <TableCell>{receipt.ref}</TableCell>
                        <TableCell className="font-medium">R$ {Number(invoice.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                        <TableCell className="hidden lg:table-cell font-mono text-sm">{emissao?.numeroNfse || invoice.number || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={statusLabels[displayStatus]?.variant || "secondary"} className="gap-1">
                            <StatusIcon className="h-3 w-3" />
                            {statusLabels[displayStatus]?.label || displayStatus}
                          </Badge>
                          {displayStatus === "FALHOU" && emissao?.erroMensagem && (
                            <span className="text-xs text-destructive block mt-1 max-w-[320px] whitespace-normal break-words" title={emissao.erroMensagem}>
                              {emissao.erroMensagem}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right align-top min-w-[320px]">
                          <div className="ml-auto flex max-w-[360px] flex-wrap justify-end gap-2">
                            {(!emissao || effectiveEmissaoStatus === "PENDENTE" || effectiveEmissaoStatus === "FALHOU") && (
                              <>
                                <PermissionGuard permission="issue_invoice">
                                  <Button
                                    size="sm"
                                    onClick={() => handleIssueInvoiceClick(invoice)}
                                    disabled={emittingIds.has(invoice.id) || issueInvoiceMutation.isPending || processNfseMutation.isPending}
                                    data-testid={`button-issue-invoice-${invoice.id}`}
                                  >
                                    {(emittingIds.has(invoice.id) || issueInvoiceMutation.isPending || processNfseMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : (effectiveEmissaoStatus === "FALHOU" ? <RefreshCw className="mr-2 h-4 w-4" /> : <FileCheck className="mr-2 h-4 w-4" />)}
                                    {effectiveEmissaoStatus === "FALHOU"
                                      ? "Reprocessar"
                                      : isLandlordNfseInvoice(invoice)
                                        ? "Emitir NFS-e"
                                        : "Emitir NF"}
                                  </Button>
                                </PermissionGuard>
                                {emissao && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                    onClick={() => handleViewDetails(emissao)}
                                    title="Ver detalhes da falha"
                                  >
                                    <Eye className="mr-2 h-4 w-4" />
                                    Detalhes
                                  </Button>
                                )}
                                <PermissionGuard permission="issue_invoice">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const chaveAcesso = prompt("Informe a chave de acesso da NFS-e emitida manualmente:");
                                      if (chaveAcesso && chaveAcesso.trim()) {
                                        manualEmitMutation.mutate({ invoiceId: invoice.id, chaveAcesso: chaveAcesso.trim() });
                                      }
                                    }}
                                  >
                                    {isLandlordNfseInvoice(invoice) ? "Informar NFS-e Manual" : "Informar NF Manual"}
                                  </Button>
                                </PermissionGuard>
                              </>
                            )}
                            
                            {emissao?.status === "EMITIDA" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                  onClick={() => handleViewDetails(emissao)}
                                  title="Ver Detalhes (Chave, Retorno)"
                                >
                                  <Eye className="mr-2 h-4 w-4" />
                                  Detalhes
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                  onClick={() => window.open(apiUrl(`/api/nfse/emissoes/${emissao.id}/xml`), '_blank')}
                                  title="Baixar XML"
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  XML
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
                                  onClick={() => refreshNumeroNfseMutation.mutate(emissao.id)}
                                  disabled={refreshNumeroNfseMutation.isPending && refreshNumeroNfseMutation.variables === emissao.id}
                                  title="Baixa o XML temporariamente, lê a tag nNFSe e atualiza o número salvo"
                                >
                                  {refreshNumeroNfseMutation.isPending && refreshNumeroNfseMutation.variables === emissao.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                  )}
                                  Atualizar NFS-e
                                </Button>
                                {emissao.chaveAcesso && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 border-purple-200"
                                      onClick={() => window.open(apiUrl(`/api/nfse/danfse/${emissao.chaveAcesso}`), '_blank')}
                                      title="Imprimir DANFSe"
                                    >
                                      <Printer className="mr-2 h-4 w-4" />
                                      DANFSe
                                    </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"
                                  onClick={() => shareWhatsApp(emissao)}
                                  title="Compartilhar DANFSe no WhatsApp"
                                >
                                  <Share2 className="mr-2 h-4 w-4" />
                                  WhatsApp
                                </Button>
                                {emissao.pdfUrl && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                      onClick={() => window.open(emissao.pdfUrl || '', '_blank')}
                                      title="Baixar PDF"
                                    >
                                      <FileText className="mr-2 h-4 w-4" />
                                      PDF
                                    </Button>
                                )}
                                <PermissionGuard permission="cancel_invoice">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                    onClick={() => handleCancelClick(emissao.id)}
                                    title="Cancelar NFS-e"
                                  >
                                    <Ban className="mr-2 h-4 w-4" />
                                    Cancelar
                                  </Button>
                                </PermissionGuard>
                              </>
                            )}

                            {(invoice.status === "draft" || invoice.status === "cancelled") && (
                              <PermissionGuard permission="delete_invoice">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => {
                                    if (invoice.status === "cancelled") {
                                      setInvoiceToDelete(invoice.id);
                                      setDeleteDialogOpen(true);
                                    } else {
                                      if (confirm("Tem certeza que deseja excluir esta nota fiscal?")) {
                                        deleteInvoiceMutation.mutate({ id: invoice.id });
                                      }
                                    }
                                  }}
                                  disabled={deleteInvoiceMutation.isPending}
                                  title="Excluir NF"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </PermissionGuard>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileCheck className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhuma nota fiscal encontrada</h3>
              <p className="text-sm text-muted-foreground">As notas fiscais são geradas a partir dos recibos pagos.</p>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Bulk Action Bar */}
      {selectedInvoices.length > 0 && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-popover text-popover-foreground shadow-lg border rounded-full px-6 py-3 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <span className="text-sm font-medium">{selectedInvoices.length} selecionado(s)</span>
          <div className="h-4 w-px bg-border" />
          
          <PermissionGuard permission="delete_invoice">
             <Button
                variant="destructive"
                size="sm"
                className="rounded-full"
                onClick={() => {
                  if (confirm(`Tem certeza que deseja excluir ${selectedInvoices.length} notas fiscais?`)) {
                    bulkDeleteMutation.mutate(selectedInvoices);
                  }
                }}
                disabled={bulkDeleteMutation.isPending}
              >
                {bulkDeleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Excluir
              </Button>
          </PermissionGuard>

          <PermissionGuard permission="issue_invoice">
            <Button 
              onClick={() => batchEmissionMutation.mutate(selectedInvoices)} 
              disabled={batchEmissionMutation.isPending}
              size="sm"
              className="gap-2 rounded-full"
            >
              {batchEmissionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
              Emitir em Lote
            </Button>
          </PermissionGuard>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full ml-2"
            onClick={() => setSelectedInvoices([])}
            title="Cancelar seleção"
          >
            <span className="sr-only">Cancelar</span>
            <span aria-hidden="true">✕</span>
          </Button>
        </div>
      )}

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da Emissão NFS-e</DialogTitle>
            <DialogDescription>
                Informações retornadas pela API Nacional
            </DialogDescription>
          </DialogHeader>
          
          {selectedEmissao && (
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Status</label>
                        <p className="font-semibold">{selectedEmissao.status}</p>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Número NFS-e</label>
                        <p className="font-semibold">{selectedEmissao.numeroNfse || "-"}</p>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Código do Erro</label>
                        <p className="font-semibold">{selectedEmissao.erroCodigo || "-"}</p>
                    </div>
                    <div className="col-span-2">
                        <label className="text-sm font-medium text-muted-foreground">Motivo</label>
                        <p className="whitespace-pre-wrap break-words">{selectedEmissao.erroMensagem || "Sem motivo informado"}</p>
                    </div>
                    <div className="col-span-2">
                        <label className="text-sm font-medium text-muted-foreground">Chave de Acesso</label>
                        <div className="flex items-center gap-2">
                             <code className="bg-muted p-2 rounded text-sm w-full break-all">
                                {selectedEmissao.chaveAcesso || "Não disponível"}
                             </code>
                        </div>
                    </div>
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Data Emissão</label>
                        <p>{new Date(selectedEmissao.updatedAt).toLocaleString()}</p>
                    </div>
                </div>

                <div>
                    <label className="text-sm font-medium text-muted-foreground">Retorno da API (Raw)</label>
                    <div className="bg-muted p-4 rounded-md overflow-x-auto mt-1">
                        <pre className="text-xs whitespace-pre-wrap">
                            {selectedEmissao.apiResponseRaw ? 
                                (selectedEmissao.apiResponseRaw.startsWith('{') ? 
                                    JSON.stringify(JSON.parse(selectedEmissao.apiResponseRaw), null, 2) : 
                                    selectedEmissao.apiResponseRaw
                                ) 
                            : "Sem dados brutos"}
                        </pre>
                    </div>
                </div>

                {selectedEmissao.apiRequestRaw && (
                    <div>
                        <label className="text-sm font-medium text-muted-foreground">Requisição Enviada (Raw)</label>
                         <div className="bg-muted p-4 rounded-md overflow-x-auto mt-1">
                            <pre className="text-xs whitespace-pre-wrap">
                                {selectedEmissao.apiRequestRaw}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              Esta nota fiscal está cancelada. Para excluí-la permanentemente, digite sua senha de confirmação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancelar</Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                if (invoiceToDelete) {
                   deleteInvoiceMutation.mutate({ id: invoiceToDelete, password: deletePassword });
                }
              }}
              disabled={!deletePassword || deleteInvoiceMutation.isPending}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
