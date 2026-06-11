import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { PermissionGuard } from "@/components/permission-guard";

const months = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Marco" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

function getFileNameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }
  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  return simpleMatch?.[1] || fallback;
}

export default function AccountingExportNfsePage() {
  const today = new Date();
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));
  const { toast } = useToast();

  // #region debug-point E:accounting-export-client-log
  const debugAccountingExport = (location: string, msg: string, data: Record<string, unknown>) => {
    fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "accounting-export-zip",
        runId: "pre-fix",
        hypothesisId: "E",
        location,
        msg: `[DEBUG] ${msg}`,
        data,
        ts: Date.now(),
      }),
    }).catch(() => {});
  };
  // #endregion

  const yearOptions = useMemo(() => {
    const currentYear = today.getFullYear();
    return Array.from({ length: 11 }, (_, index) => String(currentYear - 5 + index));
  }, [today]);

  const exportMutation = useMutation({
    mutationFn: async () => {
      // #region debug-point E:request-start
      debugAccountingExport("client/accounting-export-nfse.tsx:mutationFn:start", "Frontend iniciou exportacao contabil de NFs", {
        month,
        year,
      });
      // #endregion
      const response = await fetch(`/api/accounting/export-nfse?month=${month}&year=${year}`, {
        credentials: "include",
      });

      if (!response.ok) {
        // #region debug-point E:request-error
        debugAccountingExport("client/accounting-export-nfse.tsx:mutationFn:error", "Frontend recebeu erro na exportacao contabil", {
          month,
          year,
          status: response.status,
          statusText: response.statusText,
        });
        // #endregion
        let message = "Erro ao exportar notas fiscais.";
        try {
          const data = await response.json();
          message = data.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      // #region debug-point E:request-success
      debugAccountingExport("client/accounting-export-nfse.tsx:mutationFn:success", "Frontend recebeu blob da exportacao contabil", {
        month,
        year,
        blobSize: blob.size,
        blobType: blob.type || null,
        contentDisposition: response.headers.get("Content-Disposition"),
        xmlCount: Number(response.headers.get("X-Exported-Xml-Count") || 0),
        danfseCount: Number(response.headers.get("X-Exported-Danfse-Count") || 0),
        skippedCount: Number(response.headers.get("X-Export-Skipped-Count") || 0),
      });
      // #endregion
      return {
        blob,
        fileName: getFileNameFromDisposition(
          response.headers.get("Content-Disposition"),
          `contabilidade_nfs_${year}_${month.padStart(2, "0")}.zip`,
        ),
        xmlCount: Number(response.headers.get("X-Exported-Xml-Count") || 0),
        danfseCount: Number(response.headers.get("X-Exported-Danfse-Count") || 0),
        skippedCount: Number(response.headers.get("X-Export-Skipped-Count") || 0),
      };
    },
    onSuccess: ({ blob, fileName, xmlCount, danfseCount, skippedCount }) => {
      // #region debug-point E:download-trigger
      debugAccountingExport("client/accounting-export-nfse.tsx:onSuccess", "Frontend disparou download do ZIP contabil", {
        fileName,
        blobSize: blob.size,
        xmlCount,
        danfseCount,
        skippedCount,
      });
      // #endregion
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);

      toast({
        title: "Exportacao concluida",
        description: `${xmlCount} XML e ${danfseCount} DANFSE exportados${skippedCount ? ` (${skippedCount} com falha)` : ""}.`,
      });
    },
    onError: (error: any) => {
      // #region debug-point E:onError
      debugAccountingExport("client/accounting-export-nfse.tsx:onError", "Frontend exibiu erro na exportacao contabil", {
        month,
        year,
        message: error?.message || null,
      });
      // #endregion
      toast({
        title: "Erro",
        description: error.message || "Nao foi possivel exportar as notas fiscais.",
        variant: "destructive",
      });
    },
  });

  return (
    <PermissionGuard
      permission="menu_accounting_export_nfs"
      fallback={
        <Card>
          <CardHeader>
            <CardTitle>Acesso negado</CardTitle>
            <CardDescription>Voce nao possui permissao para acessar a exportacao de NF's.</CardDescription>
          </CardHeader>
        </Card>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Exportar NF&apos;s</h1>
          <p className="text-muted-foreground">Baixe um ZIP com XML e DANFSE das notas emitidas no periodo selecionado.</p>
        </div>

        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-primary" />
              Exportacao Contabil
            </CardTitle>
            <CardDescription>
              O sistema considera apenas NFs emitidas/autorizadas e reutiliza as rotinas atuais de XML e DANFSE.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label>Mes</Label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger data-testid="select-accounting-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Ano</Label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger data-testid="select-accounting-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending}
                data-testid="button-export-accounting-nfse"
              >
                {exportMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Exportar
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </PermissionGuard>
  );
}
