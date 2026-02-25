
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow,
  TableFooter
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, Pencil, PiggyBank, Search, Filter, ArrowUpDown, DollarSign, Lock, LockOpen } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FinancialRecord, insertFinancialRecordSchema } from "@shared/schema";
import { Badge } from "@/components/ui/badge";

const expenseFormSchema = insertFinancialRecordSchema.extend({
  amount: z.string().min(1, "Valor é obrigatório"),
});

type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export default function Expenses() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Date state
  const currentDate = new Date();
  const [refMonth, setRefMonth] = useState(currentDate.getMonth() + 1);
  const [refYear, setRefYear] = useState(currentDate.getFullYear());
  const [filterDate, setFilterDate] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FinancialRecord | null>(null);

  // Queries
  const { data, isLoading } = useQuery({
    queryKey: ["financial-records", refYear, refMonth],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/financial-records?year=${refYear}&month=${refMonth}`);
      return res.json() as Promise<{
        records: FinancialRecord[];
        previousBalance: number;
      }>;
    },
  });

  const { data: periodData, isLoading: isLoadingPeriod } = useQuery({
    queryKey: ["financial-period", refYear, refMonth],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/financial-periods?year=${refYear}&month=${refMonth}`);
      return res.json() as Promise<{ status: "OPEN" | "CLOSED" }>;
    },
  });

  const togglePeriodMutation = useMutation({
    mutationFn: async (status: "OPEN" | "CLOSED") => {
      const res = await apiRequest("POST", "/api/financial-periods/toggle", {
        month: refMonth.toString(),
        year: refYear.toString(),
        status
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-period", refYear, refMonth] });
      toast({ title: "Sucesso", description: "Status do mês atualizado." });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });

  const isPeriodClosed = periodData?.status === "CLOSED";

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: ExpenseFormValues) => {
      const res = await apiRequest("POST", "/api/financial-records", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-records"] });
      toast({ title: "Sucesso", description: "Registro criado com sucesso." });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      // Check if error is json or plain text
      let message = error.message;
      try {
        const json = JSON.parse(error.message);
        if (json.error) message = json.error;
      } catch (e) {
        // use default message
      }
      toast({ variant: "destructive", title: "Erro", description: message });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ExpenseFormValues> }) => {
      const res = await apiRequest("PUT", `/api/financial-records/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-records"] });
      toast({ title: "Sucesso", description: "Registro atualizado com sucesso." });
      setIsDialogOpen(false);
      setEditingRecord(null);
    },
    onError: (error: Error) => {
      // Check if error is json or plain text
      let message = error.message;
      try {
        const json = JSON.parse(error.message);
        if (json.error) message = json.error;
      } catch (e) {
        // use default message
      }
      toast({ variant: "destructive", title: "Erro", description: message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/financial-records/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial-records"] });
      toast({ title: "Sucesso", description: "Registro excluído com sucesso." });
    },
    onError: (error: Error) => {
      // Check if error is json or plain text
      let message = error.message;
      try {
        const json = JSON.parse(error.message);
        if (json.error) message = json.error;
      } catch (e) {
        // use default message
      }
      toast({ variant: "destructive", title: "Erro", description: message });
    },
  });

  // Form
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      type: "OUT",
      category: "CORPORATE",
      description: "",
      amount: "",
      refMonth: refMonth,
      refYear: refYear,
    },
  });

  const watchedType = form.watch("type");

  const onSubmit = (values: ExpenseFormValues) => {
    if (editingRecord) {
      updateMutation.mutate({ id: editingRecord.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleEdit = (record: FinancialRecord) => {
    setEditingRecord(record);
    form.reset({
      ...record,
      date: record.date.toString(),
      amount: record.amount.toString(),
    });
    setIsDialogOpen(true);
  };

  const handleOpenDialog = (type: "IN" | "OUT" | "BALANCE" = "OUT", isBalance = false) => {
    setEditingRecord(null);
    const today = new Date();
    // Ajustar para fuso horário local
    const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000));
    
    form.reset({
      date: localDate.toISOString().split("T")[0],
      type: isBalance ? "BALANCE" : type,
      category: isBalance ? "BALANCE" : "CORPORATE",
      description: isBalance ? "Saldo Inicial" : "",
      amount: "",
      refMonth: refMonth,
      refYear: refYear,
    });
    setIsDialogOpen(true);
  };

  // Calculations
  const records = data?.records || [];
  const filteredRecords = records.filter((r) => {
    if (filterDate && r.date.toString() !== filterDate) return false;
    if (filterCategory !== "ALL" && r.category !== filterCategory) return false;
    return true;
  });

  const previousBalance = Number(data?.previousBalance || 0);

  // Totals for current view (filtered)
  // Note: Previous Balance is NOT affected by date filter, it's always the start of the month.
  // Current Balance = Previous Balance + (Sum of all INs up to now) - (Sum of all OUTs up to now)
  // But the grid shows records for the selected month.
  
  const monthTotalIn = records
    .filter(r => r.type === "IN" || r.type === "BALANCE")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const monthTotalOut = records
    .filter(r => r.type === "OUT")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  const currentBalance = previousBalance + monthTotalIn - monthTotalOut;

  // Totals for Footer display (based on FILTERED records)
  const totalPrivateIn = filteredRecords
    .filter(r => r.type === "IN" && r.category === "PRIVATE")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const totalPrivateOut = filteredRecords
    .filter(r => r.type === "OUT" && r.category === "PRIVATE")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  const totalCorporateIn = filteredRecords
    .filter(r => r.type === "IN" && r.category === "CORPORATE")
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const totalCorporateOut = filteredRecords
    .filter(r => r.type === "OUT" && r.category === "CORPORATE")
    .reduce((sum, r) => sum + Number(r.amount), 0);

  // Totals for Footer display
  const totalPrivate = totalPrivateIn - totalPrivateOut;
  const totalCorporate = totalCorporateIn - totalCorporateOut;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Controle de Despesas</h1>
        
        <div className="flex items-center gap-2">
          <Select
            value={refMonth.toString()}
            onValueChange={(v) => setRefMonth(parseInt(v))}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={(i + 1).toString()}>
                  {format(new Date(2000, i, 1), "MMMM", { locale: ptBR })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={refYear.toString()}
            onValueChange={(v) => setRefYear(parseInt(v))}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Ano" />
            </SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027].map((year) => (
                <SelectItem key={year} value={year.toString()}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant={isPeriodClosed ? "secondary" : "default"}
            size="icon"
            onClick={() => togglePeriodMutation.mutate(isPeriodClosed ? "OPEN" : "CLOSED")}
            disabled={togglePeriodMutation.isPending || isLoadingPeriod}
            title={isPeriodClosed ? "Reabrir Mês" : "Fechar Mês"}
          >
            {isPeriodClosed ? (
              <Lock className="h-4 w-4 text-red-500" />
            ) : (
              <LockOpen className="h-4 w-4 text-green-500" />
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Anterior</CardTitle>
            <PiggyBank className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {previousBalance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </div>
            <p className="text-xs text-muted-foreground">
              Acumulado até o mês anterior
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Movimentação do Mês</CardTitle>
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${monthTotalIn - monthTotalOut >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {(monthTotalIn - monthTotalOut).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </div>
            <p className="text-xs text-muted-foreground">
              Entradas - Saídas (Filtro atual)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Atual</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${currentBalance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {currentBalance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </div>
            <p className="text-xs text-muted-foreground">
              Saldo Anterior + Movimentação
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle>Lançamentos</CardTitle>
            <div className="flex flex-col md:flex-row gap-2">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="w-[160px]"
                />
                {filterDate && (
                  <Button variant="ghost" size="icon" onClick={() => setFilterDate("")}>
                    <Filter className="h-4 w-4" />
                  </Button>
                )}
              </div>
              
              <Select
                value={filterCategory}
                onValueChange={setFilterCategory}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  <SelectItem value="CORPORATE">Corporativa</SelectItem>
                  <SelectItem value="PRIVATE">Particular</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => handleOpenDialog("BALANCE", true)}
                  disabled={isPeriodClosed}
                  title={isPeriodClosed ? "Mês fechado" : "Incluir Saldo"}
                >
                  <PiggyBank className="mr-2 h-4 w-4" />
                  Incluir Saldo
                </Button>
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogTrigger asChild>
                    <Button 
                      onClick={() => handleOpenDialog()}
                      disabled={isPeriodClosed}
                      title={isPeriodClosed ? "Mês fechado" : "Novo Lançamento"}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Novo Lançamento
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{editingRecord ? "Editar Lançamento" : "Novo Lançamento"}</DialogTitle>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="date"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Data</FormLabel>
                                <FormControl>
                                  <Input type="date" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="amount"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Valor (R$)</FormLabel>
                                <FormControl>
                                  <Input type="number" step="0.01" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="type"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Tipo</FormLabel>
                                {field.value === "BALANCE" ? (
                                  <Input value="Saldo Inicial" disabled />
                                ) : (
                                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Selecione" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="IN">Entrada</SelectItem>
                                      <SelectItem value="OUT">Saída</SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          {watchedType === "BALANCE" ? null : (
                            <FormField
                              control={form.control}
                              name="category"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Categoria</FormLabel>
                                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Selecione" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="CORPORATE">Corporativa</SelectItem>
                                      <SelectItem value="PRIVATE">Particular</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          )}
                        </div>

                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Descrição</FormLabel>
                              <FormControl>
                                <Input {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <div className="flex justify-end gap-2 pt-4">
                          <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancelar
                          </Button>
                          <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                            {editingRecord ? "Salvar Alterações" : "Criar Lançamento"}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="w-[40%]">Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Nenhum lançamento encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filteredRecords.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell>{format(new Date(record.date), "dd/MM/yyyy")}</TableCell>
                    <TableCell>
                      <Badge 
                        variant={record.type === "OUT" ? "destructive" : "default"} 
                        className={
                          record.type === "IN" ? "bg-green-600 hover:bg-green-700" : 
                          record.type === "BALANCE" ? "bg-blue-600 hover:bg-blue-700" : ""
                        }
                      >
                        {record.type === "IN" ? "Entrada" : record.type === "BALANCE" ? "Saldo Inicial" : "Saída"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {record.type === "BALANCE" ? (
                        <span className="text-muted-foreground italic">-</span>
                      ) : (
                        <Badge variant="outline">
                          {record.category === "PRIVATE" ? "Particular" : "Corporativa"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{record.description}</TableCell>
                    <TableCell className={`text-right font-medium ${record.type === "OUT" ? "text-red-600" : "text-green-600"}`}>
                      {Number(record.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleEdit(record)}
                          disabled={isPeriodClosed}
                          title={isPeriodClosed ? "Mês fechado" : "Editar"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          disabled={isPeriodClosed}
                          title={isPeriodClosed ? "Mês fechado" : "Excluir"}
                          onClick={() => {
                            if (confirm("Tem certeza que deseja excluir este lançamento?")) {
                              deleteMutation.mutate(record.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-bold">Total Particular</TableCell>
                <TableCell className={`text-right font-bold ${totalPrivate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totalPrivate.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </TableCell>
                <TableCell />
              </TableRow>
              <TableRow>
                <TableCell colSpan={4} className="font-bold">Total Corporativa</TableCell>
                <TableCell className={`text-right font-bold ${totalCorporate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {totalCorporate.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
