import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldAlert, Loader2, Copy } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const start2FASetup = async () => {
    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/2fa/setup");
      const data = await res.json();
      setQrCodeUrl(data.qrCode);
      setSecret(data.secret);
      setIsSetupOpen(true);
    } catch (error: any) {
      toast({
        title: "Erro ao iniciar configuração",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const verifyAndEnable2FA = async () => {
    if (verificationCode.length !== 6) return;
    
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/2fa/verify", { token: verificationCode });
      
      toast({
        title: "2FA Ativado",
        description: "Autenticação de dois fatores foi ativada com sucesso.",
      });
      
      setIsSetupOpen(false);
      setVerificationCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Reload user data is handled by query invalidation usually, 
      // but /api/auth/me might be cached differently in useAuth.
      // Ideally we should reload the page or trigger a re-fetch in AuthProvider.
      window.location.reload(); 
    } catch (error: any) {
      toast({
        title: "Código inválido",
        description: "O código informado está incorreto.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const disable2FA = async () => {
    if (!confirm("Tem certeza que deseja desativar a autenticação de dois fatores? Sua conta ficará menos segura.")) {
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/2fa/disable");
      toast({
        title: "2FA Desativado",
        description: "Autenticação de dois fatores foi desativada.",
      });
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Erro ao desativar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copySecret = () => {
    navigator.clipboard.writeText(secret);
    toast({ description: "Código secreto copiado!" });
  };

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Meu Perfil</h1>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informações Pessoais</CardTitle>
            <CardDescription>Seus dados de identificação no sistema</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={user.name} disabled />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user.email} disabled />
            </div>
            <div className="space-y-2">
              <Label>Função</Label>
              <Input value={user.role} disabled className="capitalize" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Segurança</CardTitle>
            <CardDescription>Gerencie a segurança da sua conta</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-full ${user.isTwoFactorEnabled ? "bg-green-100 text-green-600" : "bg-yellow-100 text-yellow-600"}`}>
                  {user.isTwoFactorEnabled ? <ShieldCheck className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
                </div>
                <div>
                  <h3 className="font-medium">Autenticação de Dois Fatores (2FA)</h3>
                  <p className="text-sm text-muted-foreground">
                    {user.isTwoFactorEnabled 
                      ? "Sua conta está protegida com 2FA." 
                      : "Adicione uma camada extra de segurança."}
                  </p>
                </div>
              </div>
            </div>

            {user.isTwoFactorEnabled ? (
              <Button 
                variant="destructive" 
                className="w-full" 
                onClick={disable2FA}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Desativar 2FA
              </Button>
            ) : (
              <Button 
                className="w-full" 
                onClick={start2FASetup}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Configurar 2FA
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configurar Autenticação de Dois Fatores</DialogTitle>
            <DialogDescription>
              Escaneie o QR Code abaixo com seu aplicativo autenticador (Google Authenticator, Authy, etc).
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex flex-col items-center space-y-4 py-4">
            {qrCodeUrl && (
              <div className="p-4 bg-white rounded-lg border">
                <img src={qrCodeUrl} alt="QR Code 2FA" className="w-48 h-48" />
              </div>
            )}
            
            <div className="w-full space-y-2">
              <Label className="text-xs text-muted-foreground text-center block">
                Não consegue escanear? Use o código manual:
              </Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-muted rounded text-center text-sm font-mono break-all">
                  {secret}
                </code>
                <Button variant="outline" size="icon" onClick={copySecret}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2 text-center w-full">
              <Label>Digite o código de 6 dígitos do app</Label>
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={verificationCode}
                  onChange={(value) => setVerificationCode(value)}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSetupOpen(false)}>Cancelar</Button>
            <Button 
              onClick={verifyAndEnable2FA} 
              disabled={verificationCode.length !== 6 || isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Verificar e Ativar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
