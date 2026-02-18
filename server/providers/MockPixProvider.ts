export interface PixTransferResult {
  success: boolean;
  transferId: string | null;
  error: string | null;
}

export interface PixProvider {
  createTransfer(beneficiaryPixKey: string, beneficiaryName: string, amount: number, description: string): Promise<PixTransferResult>;
  getTransferStatus(transferId: string): Promise<{ status: "pending" | "completed" | "failed"; error?: string }>;
}

export class MockPixProvider implements PixProvider {
  async createTransfer(
    beneficiaryPixKey: string,
    beneficiaryName: string,
    amount: number,
    description: string
  ): Promise<PixTransferResult> {
    console.log(`[MockPIX] Transfer requested:`, { beneficiaryPixKey, beneficiaryName, amount, description });
    
    await new Promise((resolve) => setTimeout(resolve, 500));

    const success = Math.random() > 0.1;
    
    if (success) {
      const transferId = `PIX-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log(`[MockPIX] Transfer successful: ${transferId}`);
      return {
        success: true,
        transferId,
        error: null,
      };
    } else {
      console.log(`[MockPIX] Transfer failed`);
      return {
        success: false,
        transferId: null,
        error: "Falha na comunicação com o provedor PIX (mock)",
      };
    }
  }

  async getTransferStatus(transferId: string): Promise<{ status: "pending" | "completed" | "failed"; error?: string }> {
    console.log(`[MockPIX] Checking status for: ${transferId}`);
    return { status: "completed" };
  }
}

export const pixProvider = new MockPixProvider();
