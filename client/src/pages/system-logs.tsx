import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SystemLog } from "@shared/schema";
import { Loader2, Search, AlertCircle, CheckCircle, Info, FileJson, FileCode, ArrowUpRight, Copy, Check, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// Helper function to format XML
function formatXml(xml: string) {
  try {
    let formatted = '';
    const reg = /(>)(<)(\/*)/g;
    xml = xml.replace(reg, '$1\r\n$2$3');
    let pad = 0;
    
    xml.split('\r\n').forEach((node) => {
      let indent = 0;
      if (node.match(/.+<\/\w[^>]*>$/)) {
        indent = 0;
      } else if (node.match(/^<\/\w/)) {
        if (pad !== 0) {
          pad -= 1;
        }
      } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
        indent = 1;
      } else {
        indent = 0;
      }

      let padding = '';
      for (let i = 0; i < pad; i++) {
        padding += '  ';
      }

      formatted += padding + node + '\r\n';
      pad += indent;
    });
    return formatted;
  } catch (e) {
    return xml; // Fallback to original if formatting fails
  }
}

function XmlViewer({ content, title }: { content: string, title: string }) {
  const [isFormatted, setIsFormatted] = useState(true);
  const [copied, setCopied] = useState(false);

  const displayContent = isFormatted ? formatXml(content) : content;

  const handleCopy = () => {
    navigator.clipboard.writeText(content); // Always copy RAW content
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DialogContent className="max-w-4xl max-h-[80vh]">
      <DialogHeader>
        <DialogTitle className="flex justify-between items-center pr-8">
            <span>{title}</span>
            <div className="flex gap-2">
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setIsFormatted(!isFormatted)}
                    className="text-xs"
                >
                    {isFormatted ? "Ver Original (Raw)" : "Ver Formatado"}
                </Button>
                <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleCopy}
                    className="text-xs flex items-center gap-1"
                >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copiado!" : "Copiar Raw"}
                </Button>
            </div>
        </DialogTitle>
        <DialogDescription>
          Conteúdo do XML gerado para esta transação.
        </DialogDescription>
      </DialogHeader>
      <ScrollArea className="h-[500px] w-full rounded-md border p-4 bg-muted/50 font-mono text-xs">
        <pre className="whitespace-pre-wrap break-all">{displayContent}</pre>
      </ScrollArea>
    </DialogContent>
  );
}

export default function SystemLogsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: logs, isLoading } = useQuery<SystemLog[]>({
    queryKey: ["/api/system-logs"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const clearLogsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/system-logs");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-logs"] });
      toast({
        title: "Logs limpos",
        description: "Todos os logs do sistema foram removidos.",
      });
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível limpar os logs.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Logs do Sistema</h1>
        <p className="text-muted-foreground mt-2">
          Histórico de operações, requisições e erros do sistema.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Últimos Registros</CardTitle>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-2">
                <Trash2 className="h-4 w-4" />
                Limpar Logs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                <AlertDialogDescription>
                  Essa ação não pode ser desfeita. Isso excluirá permanentemente todos os logs do sistema.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => clearLogsMutation.mutate()} className="bg-red-600 hover:bg-red-700">
                  Confirmar Limpeza
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Data/Hora</TableHead>
                  <TableHead className="w-[100px]">Nível</TableHead>
                  <TableHead className="w-[120px]">Categoria</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead className="w-[100px] text-right">Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs && logs.length > 0 ? (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-mono text-xs">
                        {format(new Date(log.timestamp), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.level === "ERROR"
                              ? "destructive"
                              : log.level === "WARN"
                              ? "secondary"
                              : "outline"
                          }
                          className="flex w-fit items-center gap-1"
                        >
                          {log.level === "ERROR" && <AlertCircle className="h-3 w-3" />}
                          {log.level === "INFO" && <CheckCircle className="h-3 w-3" />}
                          {log.level === "WARN" && <Info className="h-3 w-3" />}
                          {log.level}
                        </Badge>
                      </TableCell>
                      <TableCell>{log.category}</TableCell>
                      <TableCell>{log.message}</TableCell>
                      <TableCell className="text-right flex justify-end gap-2">
                        {(() => {
                          let detailsObj = null;
                          let xmlContent = null;
                          let requestSent = null;
                          try {
                            if (log.details) {
                              detailsObj = JSON.parse(log.details);
                              // Check for XML in request (standard flow) or direct property (fallback)
                              xmlContent = detailsObj?.request?.xml || detailsObj?.xml;
                              requestSent = detailsObj?.request?.requestSent;
                            }
                          } catch (e) {
                            console.error("Error parsing log details", e);
                          }

                          return (
                            <>
                              {requestSent && (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon" title="Ver Requisição Envio (SOAP/Body)">
                                      <ArrowUpRight className="h-4 w-4 text-green-600" />
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-4xl max-h-[80vh]">
                                    <DialogHeader>
                                      <DialogTitle>Requisição de Envio (Body)</DialogTitle>
                                      <DialogDescription>
                                        Conteúdo enviado no corpo da requisição para a API Nacional.
                                      </DialogDescription>
                                    </DialogHeader>
                                    <ScrollArea className="h-[500px] w-full rounded-md border p-4 bg-muted/50 font-mono text-xs">
                                      <pre className="whitespace-pre-wrap break-all">
                                        {typeof requestSent === 'string' 
                                          ? (requestSent.trim().startsWith('<') ? formatXml(requestSent) : requestSent)
                                          : JSON.stringify(requestSent, null, 2)}
                                      </pre>
                                    </ScrollArea>
                                  </DialogContent>
                                </Dialog>
                              )}

                              {xmlContent && (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="ghost" size="icon" title="Ver XML Assinado">
                                      <FileCode className="h-4 w-4 text-blue-600" />
                                    </Button>
                                  </DialogTrigger>
                                  <XmlViewer content={xmlContent} title="XML Assinado" />
                                </Dialog>
                              )}

                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="ghost" size="icon" title="Ver Detalhes JSON">
                                    <FileJson className="h-4 w-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-3xl max-h-[80vh]">
                                  <DialogHeader>
                                    <DialogTitle>Detalhes do Log</DialogTitle>
                                    <DialogDescription>
                                      ID: {log.id} | Correlation ID: {log.correlationId || "N/A"}
                                    </DialogDescription>
                                  </DialogHeader>
                                  <ScrollArea className="h-[400px] w-full rounded-md border p-4 bg-muted/50 font-mono text-xs">
                                    <pre>{detailsObj ? JSON.stringify(detailsObj, null, 2) : "Sem detalhes adicionais."}</pre>
                                  </ScrollArea>
                                </DialogContent>
                              </Dialog>
                            </>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Nenhum log encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
