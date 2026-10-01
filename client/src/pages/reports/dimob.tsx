import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, FileDown, FileSpreadsheet, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface DimobFichaMonth {
  month: number;
  renBruto: number;
  comissao: number;
  impostoRetido: number;
}

interface DimobFicha {
  contractId: string;
  contractNumber: string;
  contractDate: string | null;
  landlordName: string;
  landlordDoc: string;
  tenantName: string;
  tenantDoc: string;
  propertyAddress: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyType: string;
  months: DimobFichaMonth[];
  totalRenBruto: number;
  totalComissao: number;
  totalImpostoRetido: number;
}

interface DimobResponse {
  year: number;
  fichas: DimobFicha[];
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function DimobReportPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [searchTerm, setSearchTerm] = useState("");
  const [downloading, setDownloading] = useState<"pdf" | "excel" | null>(null);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<DimobResponse>({
    queryKey: ["/api/reports/dimob", year],
    queryFn: async () => {
      const res = await fetch(`/api/reports/dimob?year=${year}`);
      if (!res.ok) throw new Error("Falha ao buscar relatório");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const fichas = data?.fichas ?? [];
    if (!term) return fichas;
    return fichas.filter((f) =>
      [f.landlordName, f.tenantName, f.propertyAddress, f.landlordDoc, f.tenantDoc]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(term)),
    );
  }, [data, searchTerm]);

  const totals = useMemo(
    () => ({
      renBruto: filtered.reduce((s, f) => s + f.totalRenBruto, 0),
      comissao: filtered.reduce((s, f) => s + f.totalComissao, 0),
    }),
    [filtered],
  );

  const download = async (format: "pdf" | "excel") => {
    setDownloading(format);
    try {
      const res = await fetch(`/api/reports/dimob/${format}?year=${year}`);
      if (!res.ok) throw new Error("Falha ao gerar arquivo");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dimob-${year}.${format === "pdf" ? "pdf" : "csv"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Erro ao exportar",
        description: error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Relatório DIMOB (Imposto de Renda)</h1>
          <p className="text-muted-foreground">
            Ficha de rendimentos por contrato — aluguel e comissão mês a mês
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => download("pdf")} disabled={downloading !== null}>
            <FileDown className="mr-2 h-4 w-4" />
            {downloading === "pdf" ? "Gerando..." : "PDF"}
          </Button>
          <Button variant="outline" onClick={() => download("excel")} disabled={downloading !== null}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            {downloading === "excel" ? "Gerando..." : "Excel"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Filtros
            </CardTitle>
            <Input
              type="number"
              className="w-28"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value) || currentYear)}
            />
          </div>
          <div className="relative mt-4">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por proprietário, locatário, imóvel ou CPF/CNPJ..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proprietário</TableHead>
                      <TableHead>Locatário</TableHead>
                      <TableHead>Imóvel</TableHead>
                      <TableHead className="text-right">Ren. Bruto (ano)</TableHead>
                      <TableHead className="text-right">Comissão (ano)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((f) => (
                      <TableRow key={`${f.contractId}-${f.landlordDoc || f.landlordName}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate max-w-[180px]" title={f.landlordName}>
                              {f.landlordName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="truncate max-w-[180px] block" title={f.tenantName}>
                            {f.tenantName}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="truncate max-w-[220px] block" title={f.propertyAddress}>
                            {f.propertyAddress || "-"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">R$ {brl(f.totalRenBruto)}</TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          R$ {brl(f.totalComissao)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t">
                <div className="flex flex-col items-center p-3 bg-muted/20 rounded-lg border">
                  <span className="text-sm text-muted-foreground">Fichas</span>
                  <span className="text-lg font-bold">{filtered.length}</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-muted/20 rounded-lg border">
                  <span className="text-sm text-muted-foreground">Total Ren. Bruto</span>
                  <span className="text-lg font-bold">R$ {brl(totals.renBruto)}</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-green-50/50 rounded-lg border border-green-100">
                  <span className="text-sm text-green-700">Total Comissão</span>
                  <span className="text-lg font-bold text-green-700">R$ {brl(totals.comissao)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum recibo encontrado para {year}.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
