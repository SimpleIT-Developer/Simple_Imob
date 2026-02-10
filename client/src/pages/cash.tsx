import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, DollarSign, Loader2, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CashTransaction } from "@shared/schema";
import { PermissionGuard } from "@/components/permission-guard";

const categories = [
  "Aluguel",
  "Taxa de Administração",
  "Repasse ao Proprietário",
  "Serviços",
  "Despesas Operacionais",
  "Outros",
];

export default function CashPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const { data: transactions, isLoading } = useQuery<CashTransaction[]>({ queryKey: ["/api/cash"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/cash", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      setIsDialogOpen(false);
      toast({ title: "Sucesso", description: "Transação cadastrada com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/cash/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      setIsDialogOpen(false);
      setEditingTransaction(null);
      toast({ title: "Sucesso", description: "Transação atualizada com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/cash/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cash"] });
      toast({ title: "Sucesso", description: "Transação excluída com sucesso." });
    },
    onError: (error: any) => toast({ title: "Erro", description: error.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      type: formData.get("type") as string,
      date: formData.get("date") as string,
      category: formData.get("category") as string,
      description: formData.get("description") as string || null,
      amount: formData.get("amount") as string,
    };

    if (editingTransaction) {
      updateMutation.mutate({ id: editingTransaction.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filteredTransactions = transactions?.filter((t) =>
    t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalIn = transactions?.filter((t) => t.type === "IN").reduce((sum, t) => sum + Number(t.amount), 0) || 0;
  const totalOut = transactions?.filter((t) => t.type === "OUT").reduce((sum, t) => sum + Number(t.amount), 0) || 0;
  const balance = totalIn - totalOut;

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Caixa</h1>
          <p className="text-muted-foreground">Controle de entradas e saídas</p>
        </div>
        <PermissionGuard permission="create_transaction">
          <Button onClick={() => { setEditingTransaction(null); setIsDialogOpen(true); }} data-testid="button-new-transaction">
            <Plus className="mr-2 h-4 w-4" />
            Nova Transação
          </Button>
        </PermissionGuard>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Entradas</CardTitle>
            <div className="p-2 rounded-md bg-green-500/10">
              <ArrowUpRight className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              R$ {totalIn.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Saídas</CardTitle>
            <div className="p-2 rounded-md bg-red-500/10">
              <ArrowDownRight className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              R$ {totalOut.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Saldo</CardTitle>
            <div className={`p-2 rounded-md ${balance >= 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
              {balance >= 0 ? <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" /> : <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${balance >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              R$ {balance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                Movimentações
              </CardTitle>
              <CardDescription>{transactions?.length || 0} transações registradas</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-cash" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredTransactions && filteredTransactions.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="hidden md:table-cell">Descrição</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((transaction) => (
                    <TableRow key={transaction.id} data-testid={`row-cash-${transaction.id}`}>
                      <TableCell>
                        <Badge variant={transaction.type === "IN" ? "default" : "destructive"}>
                          {transaction.type === "IN" ? "Entrada" : "Saída"}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(transaction.date).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>{transaction.category}</TableCell>
                      <TableCell className="hidden md:table-cell">{transaction.description || "-"}</TableCell>
                      <TableCell className={`font-medium ${transaction.type === "IN" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                        {transaction.type === "IN" ? "+" : "-"} R$ {Number(transaction.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <PermissionGuard permission="edit_transaction">
                            <Button size="icon" variant="ghost" onClick={() => { setEditingTransaction(transaction); setIsDialogOpen(true); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </PermissionGuard>
                          <PermissionGuard permission="delete_transaction">
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              onClick={() => deleteMutation.mutate(transaction.id)}
                              disabled={!!transaction.receiptId}
                              title={transaction.receiptId ? "Transação vinculada a um recibo. Não pode ser excluída manualmente." : "Excluir transação"}
                            >
                              <Trash2 className={`h-4 w-4 ${transaction.receiptId ? "opacity-50" : ""}`} />
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
              <DollarSign className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">Nenhuma transação encontrada</h3>
              <p className="text-sm text-muted-foreground">Comece adicionando uma nova transação.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTransaction ? "Editar Transação" : "Nova Transação"}</DialogTitle>
            <DialogDescription>{editingTransaction ? "Atualize os dados da transação." : "Preencha os dados da nova transação."}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Tipo *</Label>
                <Select name="type" defaultValue={editingTransaction?.type || "IN"}>
                  <SelectTrigger data-testid="select-cash-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IN">Entrada</SelectItem>
                    <SelectItem value="OUT">Saída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="date">Data *</Label>
                <Input id="date" name="date" type="date" defaultValue={editingTransaction?.date || new Date().toISOString().split("T")[0]} required data-testid="input-cash-date" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Categoria *</Label>
                <Select name="category" defaultValue={editingTransaction?.category || categories[0]}>
                  <SelectTrigger data-testid="select-cash-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Valor (R$) *</Label>
                <Input id="amount" name="amount" type="number" step="0.01" defaultValue={editingTransaction?.amount || ""} required data-testid="input-cash-amount" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Descrição</Label>
              <Input id="description" name="description" defaultValue={editingTransaction?.description || ""} data-testid="input-cash-description" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-cash">
                {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {editingTransaction ? "Salvar" : "Cadastrar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
