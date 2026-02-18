import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, FileDown, Calendar, Building2, User, Printer, TrendingUp, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { RevenueReportItem } from "@shared/schema"; // Use shared if possible, or define locally

// Defining locally as it's not in shared schema yet (it's in storage.ts)
interface RevenueReportItem {
  receiptId: string;
  propertyCode: string;
  landlordName: string;
  tenantName: string;
  refYear: number;
  refMonth: number;
  rentAmount: string;
  adminFeeAmount: string;
  transferAmount: string | null;
  status: string;
}

const months = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" }, { value: "3", label: "Março" },
  { value: "4", label: "Abril" }, { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" }, { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" }, { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

export default function RevenueReportPage() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  
  const [filterYear, setFilterYear] = useState(currentYear);
  const [filterMonth, setFilterMonth] = useState(currentMonth);
  const [searchTerm, setSearchTerm] = useState("");

  // Queries
  const { data: revenueItems, isLoading } = useQuery<RevenueReportItem[]>({
    queryKey: ["/api/reports/revenue", filterYear, filterMonth],
    queryFn: async () => {
      const res = await fetch(`/api/reports/revenue?year=${filterYear}&month=${filterMonth}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    }
  });

  // Filter logic
  const filteredItems = revenueItems?.filter(item => {
    const search = searchTerm.toLowerCase();
    const landlordName = item.landlordName?.toLowerCase() || "";
    const tenantName = item.tenantName?.toLowerCase() || "";
    const propertyCode = item.propertyCode?.toLowerCase() || "";
    
    return landlordName.includes(search) || tenantName.includes(search) || propertyCode.includes(search);
  });

  // Totals
  const totalRent = filteredItems?.reduce((sum, item) => sum + Number(item.rentAmount), 0) || 0;
  const totalFee = filteredItems?.reduce((sum, item) => sum + Number(item.adminFeeAmount), 0) || 0;
  const totalTransfer = filteredItems?.reduce((sum, item) => sum + (Number(item.transferAmount) || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
            @page { margin: 1cm; size: landscape; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
            
            /* Esconder elementos padrão da interface e Sidebar do Shadcn */
            aside, nav, header, .sidebar, .print\\:hidden,
            div[data-slot="sidebar"],
            div[data-slot="sidebar-container"],
            div[data-slot="sidebar-gap"] { 
              display: none !important; 
            }

            /* Garantir que o container principal ocupe tudo e sobreponha qualquer layout flex */
            main { 
              padding: 0 !important; 
              margin: 0 !important; 
              overflow: visible !important; 
              width: 100vw !important; 
              max-width: 100vw !important;
              position: absolute !important;
              top: 0 !important;
              left: 0 !important;
              background: white !important;
              z-index: 9999 !important;
              border: none !important;
            }

            /* Resetar cores e sombras para impressão limpa */
            * { box-shadow: none !important; }
          }
      `}</style>

      {/* --- MODO TELA --- */}
      <div className="space-y-6 print:hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Relatório de Receita</h1>
            <p className="text-muted-foreground">Receita, Repasses e Taxas por mês de referência</p>
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
                  <Select value={String(filterMonth)} onValueChange={(v) => setFilterMonth(parseInt(v))}>
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
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
                        <TableHead className="text-right">Aluguel Pago</TableHead>
                        <TableHead className="text-right">Repasse Pago</TableHead>
                        <TableHead className="text-right">Receita (Taxa)</TableHead>
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
                              <span className="truncate max-w-[150px]" title={item.landlordName}>{item.landlordName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate max-w-[150px]" title={item.tenantName}>{item.tenantName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            R$ {Number(item.rentAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right">
                            {item.transferAmount ? (
                              `R$ ${Number(item.transferAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium text-green-600">
                            R$ {Number(item.adminFeeAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t">
                  <div className="flex flex-col items-center p-3 bg-muted/20 rounded-lg border">
                     <span className="text-sm text-muted-foreground flex items-center gap-2">
                       <ArrowDownLeft className="h-4 w-4" /> Total Aluguel
                     </span>
                     <span className="text-lg font-bold">
                       R$ {totalRent.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                     </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-muted/20 rounded-lg border">
                     <span className="text-sm text-muted-foreground flex items-center gap-2">
                       <ArrowUpRight className="h-4 w-4" /> Total Repasse
                     </span>
                     <span className="text-lg font-bold text-orange-600">
                       R$ {totalTransfer.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                     </span>
                  </div>
                  <div className="flex flex-col items-center p-3 bg-green-50/50 rounded-lg border border-green-100">
                     <span className="text-sm text-green-700 flex items-center gap-2">
                       <TrendingUp className="h-4 w-4" /> Total Receita (Taxas)
                     </span>
                     <span className="text-xl font-bold text-green-700">
                       R$ {totalFee.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                     </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma receita encontrada para este período.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- MODO IMPRESSÃO (RELATÓRIO FORMAL) --- */}
      <div className="hidden print:block space-y-6">
        <div className="border-b pb-4 mb-6">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-wider text-black">Relatório de Receita</h1>
              <p className="text-sm text-gray-500 mt-1">Imobiliária Demo System</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Referência: <span className="font-semibold text-black">{months.find(m => m.value === String(filterMonth))?.label} / {filterYear}</span></p>
              <p className="text-xs text-gray-400 mt-1">Gerado em: {new Date().toLocaleString('pt-BR')}</p>
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
                <th className="text-right py-2 font-bold text-black uppercase">Aluguel</th>
                <th className="text-right py-2 font-bold text-black uppercase">Repasse</th>
                <th className="text-right py-2 font-bold text-black uppercase">Receita (Taxa)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredItems?.map((item) => (
                <tr key={item.receiptId}>
                  <td className="py-2 text-black font-medium">{item.propertyCode}</td>
                  <td className="py-2 text-gray-700">{item.landlordName}</td>
                  <td className="py-2 text-gray-700">{item.tenantName}</td>
                  <td className="py-2 text-right text-black">
                    R$ {Number(item.rentAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-2 text-right text-black">
                    {item.transferAmount ? 
                      `R$ ${Number(item.transferAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : 
                      '-'}
                  </td>
                  <td className="py-2 text-right font-bold text-black">
                    R$ {Number(item.adminFeeAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {(!filteredItems || filteredItems.length === 0) && (
                 <tr>
                   <td colSpan={6} className="py-8 text-center text-gray-500 italic">Nenhum registro encontrado.</td>
                 </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t-2 border-black pt-4 mt-8 break-inside-avoid">
          <div className="flex justify-end gap-12">
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Aluguel</p>
              <p className="text-lg font-bold text-gray-700">R$ {totalRent.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Repasse</p>
              <p className="text-lg font-bold text-gray-700">R$ {totalTransfer.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500 mb-1">Total Receita</p>
              <p className="text-xl font-bold text-black">R$ {totalFee.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
        
        <div className="fixed bottom-0 left-0 w-full text-center border-t border-gray-200 pt-2 pb-2">
          <p className="text-[10px] text-gray-400">Imob Simple - Sistema de Gestão Imobiliária</p>
        </div>
      </div>
    </div>
  );
}
