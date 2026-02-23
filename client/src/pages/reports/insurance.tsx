import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, FileDown, Calendar, Building2, User, Printer, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface InsuranceReportItem {
  receiptId: string;
  contractId: string;
  propertyCode: string;
  landlordName: string;
  tenantName: string;
  refYear: number;
  refMonth: number;
  insuranceValue: string;
  status: string;
}

const months = [
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
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

export default function InsuranceReportPage() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(currentMonth);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"paid_transferred" | "all">("paid_transferred");

  const { data: items, isLoading } = useQuery<InsuranceReportItem[]>({
    queryKey: ["/api/reports/insurance", filterYear, filterMonth, filterStatus],
    queryFn: async () => {
      const res = await fetch(`/api/reports/insurance?year=${filterYear}&month=${filterMonth}&status=${filterStatus}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
  });

  const filteredItems = items?.filter((item) => {
    const search = searchTerm.toLowerCase();
    const landlordName = item.landlordName?.toLowerCase() || "";
    const tenantName = item.tenantName?.toLowerCase() || "";
    const propertyCode = item.propertyCode?.toLowerCase() || "";

    return landlordName.includes(search) || tenantName.includes(search) || propertyCode.includes(search);
  });

  const totalInsurance =
    filteredItems?.reduce((sum, item) => sum + Number(item.insuranceValue || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="space-y-6 print:hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Relatório de Seguro Fiança</h1>
            <p className="text-muted-foreground">
              Recibos pagos de contratos com Seguro Fiança, por mês de referência
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <FileDown className="mr-2 h-4 w-4" />
              Gerar PDF
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
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <div className="flex gap-2">
                  <Select
                    value={String(filterMonth)}
                    onValueChange={(v) => setFilterMonth(parseInt(v))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    className="w-24"
                    value={filterYear}
                    onChange={(e) => setFilterYear(parseInt(e.target.value))}
                  />
                </div>
                <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Status dos recibos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid_transferred">Pago ou Repassado</SelectItem>
                    <SelectItem value="all">Todos os status</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por proprietário, inquilino ou código..."
                  className="pl-8"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
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
            ) : filteredItems && filteredItems.length > 0 ? (
              <div className="space-y-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cód.</TableHead>
                        <TableHead>Proprietário</TableHead>
                        <TableHead>Inquilino</TableHead>
                        <TableHead>Referência</TableHead>
                        <TableHead className="text-right">Seguro Fiança</TableHead>
                        <TableHead className="text-center">Status Recibo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => (
                        <TableRow key={item.receiptId}>
                          <TableCell className="font-medium">
                            {item.propertyCode}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span
                                className="truncate max-w-[150px]"
                                title={item.landlordName}
                              >
                                {item.landlordName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span
                                className="truncate max-w-[150px]"
                                title={item.tenantName}
                              >
                                {item.tenantName}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {String(item.refMonth).padStart(2, "0")}/{item.refYear}
                          </TableCell>
                          <TableCell className="text-right">
                            R$ {Number(item.insuranceValue || 0).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline">
                              {item.status === "paid"
                                ? "Pago"
                                : item.status === "transferred"
                                ? "Repassado"
                                : item.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex flex-col items-start p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                    <span className="text-sm text-blue-700 flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Total Seguro Fiança
                    </span>
                    <span className="text-xl font-bold text-blue-700">
                      R$ {totalInsurance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhum registro de Seguro Fiança encontrado para este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="hidden print:block space-y-6">
        <div className="border-b pb-4 mb-6">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-wider text-black">
                Relatório de Seguro Fiança
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Demonstrativo analítico de Seguro Fiança por contrato
              </p>
              <p className="text-sm text-gray-500 mt-1">Imob Simple</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">
                Referência:{" "}
                <span className="font-semibold text-black">
                  {months.find((m) => m.value === String(filterMonth))?.label} / {filterYear}
                </span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Gerado em: {new Date().toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-[500px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-2 font-bold text-black uppercase">Cód.</th>
                <th className="text-left py-2 font-bold text-black uppercase">Proprietário</th>
                <th className="text-left py-2 font-bold text-black uppercase">Inquilino</th>
                <th className="text-center py-2 font-bold text-black uppercase">Ref.</th>
                <th className="text-right py-2 font-bold text-black uppercase">Seguro Fiança</th>
                <th className="text-center py-2 font-bold text-black uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredItems?.map((item) => (
                <tr key={item.receiptId}>
                  <td className="py-2 text-black font-medium">{item.propertyCode}</td>
                  <td className="py-2 text-black">
                    <span className="truncate max-w-[160px] inline-block" title={item.landlordName}>
                      {item.landlordName}
                    </span>
                  </td>
                  <td className="py-2 text-black">
                    <span className="truncate max-w-[160px] inline-block" title={item.tenantName}>
                      {item.tenantName}
                    </span>
                  </td>
                  <td className="py-2 text-center text-black">
                    {String(item.refMonth).padStart(2, "0")}/{item.refYear}
                  </td>
                  <td className="py-2 text-right text-black">
                    R${" "}
                    {Number(item.insuranceValue || 0).toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-2 text-center text-black">
                    {item.status === "paid"
                      ? "Pago"
                      : item.status === "transferred"
                      ? "Repassado"
                      : item.status}
                  </td>
                </tr>
              ))}
              {(!filteredItems || filteredItems.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500 italic">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t-2 border-black pt-4 mt-8 break-inside-avoid">
          <div className="flex justify-end gap-12">
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Seguro Fiança</p>
              <p className="text-lg font-bold text-gray-700">
                R$ {totalInsurance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
