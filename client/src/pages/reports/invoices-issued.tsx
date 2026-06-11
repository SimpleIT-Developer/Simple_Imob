import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, FileDown, FileText, ReceiptText, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type IssuedInvoiceReportItem = {
  emissaoId: string;
  invoiceId: string | null;
  emissionDate: string;
  numeroNfse: string;
  codigoVerificacao: string;
  chaveAcesso: string;
  landlordName: string;
  landlordDoc: string;
  propertyTitle: string;
  propertyAddress: string;
  reference: string;
  description: string;
  valorServico: number;
  valorIss: number;
  valorLiquido: number;
};

type IssuedInvoiceReportResponse = {
  startDate: string | null;
  endDate: string | null;
  items: IssuedInvoiceReportItem[];
  summary: {
    totalNotas: number;
    totalValorServico: number;
    totalValorIss: number;
    totalValorLiquido: number;
  };
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function IssuedInvoicesReportPage() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  // #region debug-point E:browser-report-log
  const debugIssuedInvoicesReportClient = (location: string, msg: string, data: Record<string, unknown>) => {
    fetch("http://127.0.0.1:7778/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "issued-invoices-regression",
        runId: "post-fix",
        hypothesisId: "E",
        location,
        msg: `[DEBUG] ${msg}`,
        data,
        ts: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  const { data, isLoading } = useQuery<IssuedInvoiceReportResponse>({
    queryKey: ["/api/reports/invoices-issued", startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      // #region debug-point E:query-start
      debugIssuedInvoicesReportClient("client/reports/invoices-issued.tsx:queryFn:start", "Frontend iniciou busca do relatorio", {
        startDate: startDate || null,
        endDate: endDate || null,
        query: params.toString(),
      });
      // #endregion
      const res = await fetch(`/api/reports/invoices-issued?${params.toString()}`);
      if (!res.ok) {
        // #region debug-point E:query-error
        debugIssuedInvoicesReportClient("client/reports/invoices-issued.tsx:queryFn:error", "Frontend recebeu erro ao buscar o relatorio", {
          status: res.status,
          statusText: res.statusText,
        });
        // #endregion
        throw new Error("Falha ao buscar relatório");
      }
      const json = await res.json();
      // #region debug-point E:query-success
      debugIssuedInvoicesReportClient("client/reports/invoices-issued.tsx:queryFn:success", "Frontend recebeu resposta do relatorio", {
        items: Array.isArray(json?.items) ? json.items.length : null,
        totalNotas: json?.summary?.totalNotas ?? null,
      });
      // #endregion
      return json;
    },
  });

  const filteredItems = (data?.items || [])
    .filter((item) => {
      const term = searchTerm.trim().toLowerCase();
      if (!term) return true;

      return [
        item.numeroNfse,
        item.codigoVerificacao,
        item.reference,
        item.propertyTitle,
        item.propertyAddress,
        item.landlordName,
        item.landlordDoc,
        item.chaveAcesso,
        item.description,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    })
    .sort((a, b) => new Date(a.emissionDate).getTime() - new Date(b.emissionDate).getTime());

  useEffect(() => {
    // #region debug-point E:filtered-items
    debugIssuedInvoicesReportClient("client/reports/invoices-issued.tsx:filteredItems", "Frontend consolidou itens exibidos", {
      searchTerm: searchTerm || null,
      apiItems: data?.items?.length ?? 0,
      filteredItems: filteredItems.length,
      sample: filteredItems.slice(0, 3).map((item) => ({
        emissaoId: item.emissaoId,
        numeroNfse: item.numeroNfse,
        emissionDate: item.emissionDate,
      })),
    });
    // #endregion
  }, [data?.items, filteredItems, searchTerm]);

  const filteredSummary = filteredItems.reduce(
    (acc, item) => {
      acc.totalNotas += 1;
      acc.totalValorServico += Number(item.valorServico || 0);
      acc.totalValorIss += Number(item.valorIss || 0);
      acc.totalValorLiquido += Number(item.valorLiquido || 0);
      return acc;
    },
    {
      totalNotas: 0,
      totalValorServico: 0,
      totalValorIss: 0,
      totalValorLiquido: 0,
    },
  );

  const handleDownloadPdf = async () => {
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("_ts", String(Date.now()));
      const res = await fetch(`/api/reports/invoices-issued/pdf?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error("Falha ao gerar PDF");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const startLabel = startDate || "todos";
      const endLabel = endDate || "todos";
      link.download = `relatorio-notas-fiscais-emitidas-${startLabel}-${endLabel}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível gerar o PDF.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatório de Notas Fiscais Emitidas</h1>
          <p className="text-muted-foreground">Consulta e exportação em PDF das NFS-e emitidas por período.</p>
        </div>
        <Button onClick={handleDownloadPdf} className="w-full sm:w-auto">
          <FileDown className="mr-2 h-4 w-4" />
          Gerar PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="xl:w-[180px]" />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="xl:w-[180px]" />
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por NFS-e, proprietário, imóvel, chave de acesso ou descrição..."
                className="pl-9"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Deixe as datas em branco para listar todas as NFS-e emitidas.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 bg-gradient-to-b from-white to-slate-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Notas Emitidas</p>
                <p className="text-3xl font-bold">{filteredSummary.totalNotas}</p>
              </div>
              <ReceiptText className="h-9 w-9 text-slate-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-gradient-to-b from-white to-emerald-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Valor de Serviço</p>
                <p className="text-2xl font-bold text-emerald-700">R$ {formatCurrency(filteredSummary.totalValorServico)}</p>
              </div>
              <Wallet className="h-9 w-9 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-gradient-to-b from-white to-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">ISS</p>
                <p className="text-2xl font-bold text-amber-700">R$ {formatCurrency(filteredSummary.totalValorIss)}</p>
              </div>
              <FileText className="h-9 w-9 text-amber-600" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200 bg-gradient-to-b from-white to-blue-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Valor Líquido</p>
                <p className="text-2xl font-bold text-blue-700">R$ {formatCurrency(filteredSummary.totalValorLiquido)}</p>
              </div>
              <Wallet className="h-9 w-9 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notas do Período</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              Nenhuma NFS-e emitida encontrada para o período informado.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emissão</TableHead>
                    <TableHead>NFS-e</TableHead>
                    <TableHead>Referência</TableHead>
                    <TableHead>Imóvel</TableHead>
                    <TableHead>Proprietário</TableHead>
                    <TableHead>Verificação</TableHead>
                    <TableHead className="text-right">Serviço</TableHead>
                    <TableHead className="text-right">ISS</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow key={item.emissaoId}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(item.emissionDate).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="font-medium">{item.numeroNfse}</TableCell>
                      <TableCell>{item.reference}</TableCell>
                      <TableCell>
                        <div className="font-medium">{item.propertyTitle}</div>
                        <div className="text-xs text-muted-foreground">{item.propertyAddress}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.landlordName}</div>
                        <div className="text-xs text-muted-foreground">{item.landlordDoc}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.codigoVerificacao}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[220px]" title={item.chaveAcesso}>
                          {item.chaveAcesso}
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        R$ {formatCurrency(item.valorServico)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        R$ {formatCurrency(item.valorIss)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-semibold text-blue-700">
                        R$ {formatCurrency(item.valorLiquido)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
