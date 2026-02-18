export interface NfEmissionResult {
  success: boolean;
  invoiceId: string | null;
  invoiceNumber: string | null;
  error: string | null;
}

export interface NfCancellationResult {
  success: boolean;
  error: string | null;
}

export interface NfProvider {
  emitInvoice(landlordName: string, landlordDoc: string, amount: number, description: string): Promise<NfEmissionResult>;
  cancelInvoice(invoiceId: string, reason: string): Promise<NfCancellationResult>;
  getInvoiceStatus(invoiceId: string): Promise<{ status: "pending" | "issued" | "error" | "cancelled"; error?: string }>;
  generateXml(invoiceId: string, data: any): Promise<string>;
}

export class MockNfProvider implements NfProvider {
  private invoiceCounter = 1000;

  async generateXml(invoiceId: string, data: any): Promise<string> {
    return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="${invoiceId}" versao="4.00">
    <ide>
      <nNF>${data.number}</nNF>
      <dhEmi>${new Date().toISOString()}</dhEmi>
    </ide>
    <emit>
      <xNome>${data.providerName || "Imobiliária Mock"}</xNome>
      <CNPJ>00000000000000</CNPJ>
    </emit>
    <dest>
      <xNome>${data.customerName}</xNome>
      <CPF>${data.customerDoc}</CPF>
    </dest>
    <total>
      <ICMSTot>
        <vNF>${data.amount}</vNF>
      </ICMSTot>
    </total>
  </infNFe>
</NFe>`;
  }

  async emitInvoice(
    landlordName: string,
    landlordDoc: string,
    amount: number,
    description: string
  ): Promise<NfEmissionResult> {
    console.log(`[MockNF] Invoice emission requested:`, { landlordName, landlordDoc, amount, description });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Force success for user testing
    const success = true; // Math.random() > 0.1;

    if (success) {
      this.invoiceCounter++;
      const invoiceId = `NF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const invoiceNumber = `NF-${this.invoiceCounter}`;
      console.log(`[MockNF] Invoice issued successfully: ${invoiceNumber}`);
      return {
        success: true,
        invoiceId,
        invoiceNumber,
        error: null,
      };
    } else {
      console.log(`[MockNF] Invoice emission failed`);
      return {
        success: false,
        invoiceId: null,
        invoiceNumber: null,
        error: "Falha na comunicação com o ambiente nacional (mock)",
      };
    }
  }

  async cancelInvoice(invoiceId: string, reason: string): Promise<NfCancellationResult> {
    console.log(`[MockNF] Invoice cancellation requested:`, { invoiceId, reason });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { success: true, error: null };
  }

  async getInvoiceStatus(invoiceId: string): Promise<{ status: "pending" | "issued" | "error" | "cancelled"; error?: string }> {
    console.log(`[MockNF] Checking status for: ${invoiceId}`);
    return { status: "issued" };
  }
}

export const nfProvider = new MockNfProvider();
