import { storage } from "../storage";
import { nfseProvider } from "../providers/NfseNationalProvider";
import { sideEffectsEnabled } from "./sideEffects";

export class NfseWorker {
  private isRunning: boolean = false;
  private processing: boolean = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds
  private pausedUntil: number = 0;

  constructor() {}

  start() {
    if (!sideEffectsEnabled()) {
      console.log("[NfseWorker] Efeitos externos desligados neste ambiente; worker não iniciado.");
      return;
    }

    if (this.isRunning) {
      console.log("[NfseWorker] Worker já está rodando.");
      return;
    }

    this.isRunning = true;
    console.log("[NfseWorker] Iniciando serviço de processamento de NFS-e...");

    // Executa imediatamente e depois agenda
    this.processQueue();
    
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, this.CHECK_INTERVAL_MS);
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log("[NfseWorker] Serviço parado.");
  }

  pauseTemporarily(durationMs: number, reason?: string) {
    const nextPausedUntil = Date.now() + Math.max(0, durationMs);
    this.pausedUntil = Math.max(this.pausedUntil, nextPausedUntil);
    console.log(
      `[NfseWorker] Processamento automático pausado por ${Math.max(0, durationMs)}ms${reason ? ` (${reason})` : ""}.`,
    );
  }

  async tick(): Promise<void> {
    if (!sideEffectsEnabled()) return;
    await this.processQueue();
  }

  private async processQueue() {
    if (this.processing) return;
    if (Date.now() < this.pausedUntil) return;
    this.processing = true;

    try {
      // Buscar emissões pendentes
      const pendentes = await storage.getPendingNfseEmissoes();
      
      if (pendentes.length > 0) {
        console.log(`[NfseWorker] Encontradas ${pendentes.length} emissões pendentes.`);
        
        for (const emissao of pendentes) {
          try {
            // Verificar retry count (exemplo: max 3 tentativas)
            if ((emissao.retryCount || 0) >= 3) {
              console.warn(`[NfseWorker] Emissão ${emissao.id} excedeu limite de tentativas. Pulando.`);
              await storage.updateNfseEmissao(emissao.id, { status: "FALHOU", erroMensagem: "Excedeu limite de tentativas" });
              continue;
            }

            console.log(`[NfseWorker] Processando emissão ${emissao.id}...`);
            await nfseProvider.emitirNfse(emissao.id);
            
          } catch (err: any) {
            console.error(`[NfseWorker] Erro ao processar emissão ${emissao.id}:`, err);
            
            // Incrementar retry count
            await storage.updateNfseEmissao(emissao.id, { 
              retryCount: (emissao.retryCount || 0) + 1,
              erroMensagem: err.message || "Erro desconhecido no worker"
            });
          }
        }
      }
    } catch (error) {
      console.error("[NfseWorker] Erro fatal no loop de processamento:", error);
    } finally {
      this.processing = false;
    }
  }
}

export const nfseWorker = new NfseWorker();
