import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, DollarSign, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ContractRecurringItem } from "@shared/schema";

interface ContractRecurringItemsProps {
  contractId: string;
}

export function ContractRecurringItems({ contractId }: ContractRecurringItemsProps) {
  const { toast } = useToast();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [chargedTo, setChargedTo] = useState<"TENANT" | "LANDLORD" | "NONE">("TENANT");
  const [discountFrom, setDiscountFrom] = useState<"TENANT" | "LANDLORD" | "NONE">("NONE");
  const [passThrough, setPassThrough] = useState("false"); // "true" or "false" string for Select

  const { data: items, isLoading } = useQuery<ContractRecurringItem[]>({
    queryKey: [`/api/contracts/${contractId}/recurring-items`],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", `/api/contracts/${contractId}/recurring-items`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contracts/${contractId}/recurring-items`] });
      setDescription("");
      setAmount("");
      setChargedTo("TENANT");
      setDiscountFrom("NONE");
      setPassThrough("false");
      toast({ title: "Sucesso", description: "Item recorrente adicionado." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/recurring-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/contracts/${contractId}/recurring-items`] });
      toast({ title: "Sucesso", description: "Item recorrente removido." });
    },
    onError: (error: any) => {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !amount) return;

    createMutation.mutate({
      description,
      amount: amount.replace(",", "."), // Normalize basic decimal
      chargedTo,
      discountFrom: discountFrom === "NONE" ? null : discountFrom,
      passThrough: passThrough === "true",
    });
  };

  return (
    <div className="space-y-4 border-t pt-4 mt-4">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-lg">Itens Recorrentes (Despesas/Serviços Fixos)</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Estes itens serão adicionados automaticamente aos novos recibos gerados para este contrato.
      </p>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-12 items-end border p-4 rounded-md bg-muted/20">
        <div className="sm:col-span-3 space-y-2">
          <Label htmlFor="rec-desc">Descrição</Label>
          <Input 
            id="rec-desc" 
            value={description} 
            onChange={(e) => setDescription(e.target.value)} 
            placeholder="Ex: Taxa de Lixo" 
            required 
          />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label htmlFor="rec-amount">Valor (R$)</Label>
          <Input 
            id="rec-amount" 
            type="number" 
            step="0.01" 
            value={amount} 
            onChange={(e) => setAmount(e.target.value)} 
            placeholder="0,00" 
            required 
          />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label htmlFor="rec-charged">Cobrar de</Label>
          <Select value={chargedTo} onValueChange={(v: "TENANT" | "LANDLORD" | "NONE") => setChargedTo(v)}>
            <SelectTrigger id="rec-charged">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Nenhum</SelectItem>
              <SelectItem value="TENANT">Locatário</SelectItem>
              <SelectItem value="LANDLORD">Proprietário</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label htmlFor="rec-discount">Descontar de</Label>
          <Select value={discountFrom} onValueChange={(v: any) => setDiscountFrom(v)}>
            <SelectTrigger id="rec-discount">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Nenhum</SelectItem>
              <SelectItem value="TENANT">Locatário</SelectItem>
              <SelectItem value="LANDLORD">Proprietário</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label htmlFor="rec-pass">Repasse?</Label>
          <Select value={passThrough} onValueChange={setPassThrough}>
            <SelectTrigger id="rec-pass">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Não</SelectItem>
              <SelectItem value="true">Sim</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-1">
          <Button type="submit" size="icon" disabled={createMutation.isPending}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Cobrado de</TableHead>
              <TableHead>Descontado de</TableHead>
              <TableHead>Repasse</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-4">Carregando...</TableCell>
              </TableRow>
            ) : items?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-4 text-muted-foreground">Nenhum item recorrente cadastrado.</TableCell>
              </TableRow>
            ) : (
              items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>R$ {Number(item.amount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    {item.chargedTo === "TENANT" ? "Locatário" : item.chargedTo === "LANDLORD" ? "Proprietário" : "Nenhum"}
                  </TableCell>
                  <TableCell>
                    {(item as any).discountFrom ? (
                      <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50">
                        {(item as any).discountFrom === "TENANT" ? "Locatário" : "Proprietário"}
                      </Badge>
                    ) : "-"}
                  </TableCell>
                  <TableCell>
                    {item.passThrough ? "Sim" : "Não"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-8 w-8 text-destructive" 
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
