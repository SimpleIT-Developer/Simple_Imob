import simpleImobLogo from "@/assets/brand/simple-imob-logo.png";
import simpleImobWatermarkTile from "@/assets/brand/simple-imob-watermark-tile.png";
import { useState } from "react";
import { Eye, EyeOff, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const { login, login2FA } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (requires2FA) {
        await login2FA(twoFactorCode);
        toast({ title: "Bem-vindo!", description: "Login realizado com sucesso." });
      } else {
        const data = await login(email, password);
        if (data?.requireTwoFactor) {
          setRequires2FA(true);
          toast({ 
            title: "Autenticação de Dois Fatores", 
            description: "Por favor, digite o código do seu aplicativo autenticador." 
          });
        } else {
          toast({ title: "Bem-vindo!", description: "Login realizado com sucesso." });
        }
      }
    } catch (error: any) {
      toast({ 
        title: "Erro no login", 
        description: error.message || "Email ou senha inválidos.",
        variant: "destructive" 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden bg-background p-4">
      {/* Marca d'água: símbolo Simple Imob pequeno, repetido e transparente atrás do cartão */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none opacity-[0.07] dark:opacity-[0.1]"
        style={{ backgroundImage: `url(${simpleImobWatermarkTile})`, backgroundSize: "160px 160px", backgroundRepeat: "repeat" }}
      />
      <Card className="relative z-10 w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <img src={simpleImobLogo} alt="Simple Imob - Sistema Imobiliário" className="mx-auto h-40 w-40 object-contain" />
          <div className="sr-only">
            <CardTitle>Simple Imob</CardTitle>
            <CardDescription>Sistema Imobiliário</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {requires2FA ? (
              <div className="space-y-4">
                 <div className="text-center text-sm text-muted-foreground mb-4">
                   Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador.
                 </div>
                 <div className="flex justify-center">
                   <InputOTP
                     maxLength={6}
                     value={twoFactorCode}
                     onChange={(value) => setTwoFactorCode(value)}
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
                 <Button 
                   type="button" 
                   variant="ghost" 
                   className="w-full"
                   onClick={() => {
                     setRequires2FA(false);
                     setTwoFactorCode("");
                     setPassword("");
                   }}
                 >
                   <ArrowLeft className="mr-2 h-4 w-4" />
                   Voltar para login
                 </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid="input-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Digite sua senha"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="pr-10"
                      data-testid="input-password"
                      data-no-case={true}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-0 text-muted-foreground hover:text-foreground focus:outline-none"
                      onClick={() => setShowPassword(!showPassword)}
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
            
            <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login">
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {requires2FA ? "Verificando..." : "Entrando..."}
                </>
              ) : (
                requires2FA ? "Verificar Código" : "Entrar"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
