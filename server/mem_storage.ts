import {
  type User, type InsertUser,
  type Landlord, type InsertLandlord,
  type Tenant, type InsertTenant,
  type Guarantor, type InsertGuarantor,
  type ServiceProvider, type InsertServiceProvider,
  type Property, type InsertProperty,
  type Contract, type InsertContract,
  type Service, type InsertService,
  type Receipt, type InsertReceipt,
  type CashTransaction, type InsertCashTransaction,
  type LandlordTransfer, type InsertLandlordTransfer,
  type Invoice, type InsertInvoice,
  type NfseConfig, type InsertNfseConfig,
  type NfseLote, type InsertNfseLote,
  type NfseEmissao, type InsertNfseEmissao,
} from "@shared/schema";
import type { IStorage } from "./storage";
import { randomUUID } from "crypto";

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private landlords: Map<string, Landlord> = new Map();
  private tenants: Map<string, Tenant> = new Map();
  private guarantors: Map<string, Guarantor> = new Map();
  private serviceProviders: Map<string, ServiceProvider> = new Map();
  private properties: Map<string, Property> = new Map();
  private contracts: Map<string, Contract> = new Map();
  private services: Map<string, Service> = new Map();
  private receipts: Map<string, Receipt> = new Map();
  private cashTransactions: Map<string, CashTransaction> = new Map();
  private landlordTransfers: Map<string, LandlordTransfer> = new Map();
  private invoices: Map<string, Invoice> = new Map();
  private nfseConfig: NfseConfig | undefined;
  private nfseLotes: Map<string, NfseLote> = new Map();
  private nfseEmissoes: Map<string, NfseEmissao> = new Map();

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = insertUser.id || randomUUID();
    const user: User = {
      ...insertUser,
      id,
      role: insertUser.role || "user",
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async getLandlords(): Promise<Landlord[]> {
    return Array.from(this.landlords.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getLandlord(id: string): Promise<Landlord | undefined> {
    return this.landlords.get(id);
  }

  async createLandlord(data: InsertLandlord): Promise<Landlord> {
    const id = data.id || randomUUID();
    const landlord: Landlord = {
      ...data,
      id,
      email: data.email || null,
      phone: data.phone || null,
      pixKey: data.pixKey || null,
      pixKeyType: data.pixKeyType || null,
      address: data.address || null,
      createdAt: new Date(),
    };
    this.landlords.set(id, landlord);
    return landlord;
  }

  async updateLandlord(id: string, data: Partial<InsertLandlord>): Promise<Landlord | undefined> {
    const existing = this.landlords.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.landlords.set(id, updated);
    return updated;
  }

  async deleteLandlord(id: string): Promise<void> {
    this.landlords.delete(id);
  }

  async getTenants(): Promise<Tenant[]> {
    return Array.from(this.tenants.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    return this.tenants.get(id);
  }

  async createTenant(data: InsertTenant): Promise<Tenant> {
    const id = data.id || randomUUID();
    const tenant: Tenant = {
      ...data,
      id,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      createdAt: new Date(),
    };
    this.tenants.set(id, tenant);
    return tenant;
  }

  async updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const existing = this.tenants.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.tenants.set(id, updated);
    return updated;
  }

  async deleteTenant(id: string): Promise<void> {
    this.tenants.delete(id);
  }

  async getGuarantors(): Promise<Guarantor[]> {
    return Array.from(this.guarantors.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getGuarantor(id: string): Promise<Guarantor | undefined> {
    return this.guarantors.get(id);
  }

  async createGuarantor(data: InsertGuarantor): Promise<Guarantor> {
    const id = data.id || randomUUID();
    const guarantor: Guarantor = {
      ...data,
      id,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      createdAt: new Date(),
    };
    this.guarantors.set(id, guarantor);
    return guarantor;
  }

  async updateGuarantor(id: string, data: Partial<InsertGuarantor>): Promise<Guarantor | undefined> {
    const existing = this.guarantors.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.guarantors.set(id, updated);
    return updated;
  }

  async deleteGuarantor(id: string): Promise<void> {
    this.guarantors.delete(id);
  }

  async getServiceProviders(): Promise<ServiceProvider[]> {
    return Array.from(this.serviceProviders.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getServiceProvider(id: string): Promise<ServiceProvider | undefined> {
    return this.serviceProviders.get(id);
  }

  async createServiceProvider(data: InsertServiceProvider): Promise<ServiceProvider> {
    const id = data.id || randomUUID();
    const provider: ServiceProvider = {
      ...data,
      id,
      doc: data.doc || null,
      email: data.email || null,
      phone: data.phone || null,
      createdAt: new Date(),
    };
    this.serviceProviders.set(id, provider);
    return provider;
  }

  async updateServiceProvider(id: string, data: Partial<InsertServiceProvider>): Promise<ServiceProvider | undefined> {
    const existing = this.serviceProviders.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.serviceProviders.set(id, updated);
    return updated;
  }

  async deleteServiceProvider(id: string): Promise<void> {
    this.serviceProviders.delete(id);
  }

  async getProperties(): Promise<Property[]> {
    return Array.from(this.properties.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getProperty(id: string): Promise<Property | undefined> {
    return this.properties.get(id);
  }

  async createProperty(data: InsertProperty): Promise<Property> {
    const id = data.id || randomUUID();
    const property: Property = {
      ...data,
      id,
      landlordId: data.landlordId || null,
      status: data.status || "available",
      createdAt: new Date(),
    };
    this.properties.set(id, property);
    return property;
  }

  async updateProperty(id: string, data: Partial<InsertProperty>): Promise<Property | undefined> {
    const existing = this.properties.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.properties.set(id, updated);
    return updated;
  }

  async deleteProperty(id: string): Promise<void> {
    this.properties.delete(id);
  }

  async getContracts(): Promise<Contract[]> {
    return Array.from(this.contracts.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getActiveContracts(): Promise<Contract[]> {
    return Array.from(this.contracts.values())
      .filter((c) => c.status === "active")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getContract(id: string): Promise<Contract | undefined> {
    return this.contracts.get(id);
  }

  async createContract(data: InsertContract): Promise<Contract> {
    const id = data.id || randomUUID();
    // Ensure dates are Dates
    const contract: Contract = {
      ...data,
      id,
      startDate: typeof data.startDate === 'string' ? new Date(data.startDate) : data.startDate as unknown as string,
      endDate: typeof data.endDate === 'string' ? new Date(data.endDate) : data.endDate as unknown as string,
      firstDueDate: data.firstDueDate ? (typeof data.firstDueDate === 'string' ? new Date(data.firstDueDate) : data.firstDueDate as unknown as string) : null,
      status: data.status || "active",
      createdAt: new Date(),
    };
    // Fix type mismatch for date strings vs Date objects if schema differs
    // Schema says date(), which in Drizzle PG is string or Date? Usually string YYYY-MM-DD.
    // In memory we store what matches the type.
    this.contracts.set(id, contract);

    // Update property status
    const property = this.properties.get(data.propertyId);
    if (property) {
      property.status = "rented";
      this.properties.set(data.propertyId, property);
    }

    return contract;
  }

  async updateContract(id: string, data: Partial<InsertContract>): Promise<Contract | undefined> {
    const existing = this.contracts.get(id);
    if (!existing) return undefined;
    
    const updates: any = { ...data };
    if (data.startDate && typeof data.startDate === 'string') {
      updates.startDate = new Date(data.startDate);
    }
    if (data.endDate && typeof data.endDate === 'string') {
      updates.endDate = new Date(data.endDate);
    }
    if (data.firstDueDate && typeof data.firstDueDate === 'string') {
      updates.firstDueDate = new Date(data.firstDueDate);
    }

    const updated = { ...existing, ...updates } as Contract;
    this.contracts.set(id, updated);
    return updated;
  }

  async deleteContract(id: string): Promise<void> {
    this.contracts.delete(id);
  }

  async getServices(): Promise<Service[]> {
    return Array.from(this.services.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getServicesByContractAndRef(contractId: string, year: number, month: number): Promise<Service[]> {
    return Array.from(this.services.values()).filter(
      (s) => s.contractId === contractId && s.refYear === year && s.refMonth === month
    );
  }

  async getService(id: string): Promise<Service | undefined> {
    return this.services.get(id);
  }

  async createService(data: InsertService): Promise<Service> {
    const id = data.id || randomUUID();
    const service: Service = {
      ...data,
      id,
      providerId: data.providerId || null,
      createdAt: new Date(),
    };
    this.services.set(id, service);
    return service;
  }

  async updateService(id: string, data: Partial<InsertService>): Promise<Service | undefined> {
    const existing = this.services.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.services.set(id, updated);
    return updated;
  }

  async deleteService(id: string): Promise<void> {
    this.services.delete(id);
  }

  async getReceipts(): Promise<Receipt[]> {
    return Array.from(this.receipts.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getReceiptsByRef(year: number, month: number): Promise<Receipt[]> {
    return Array.from(this.receipts.values())
      .filter((r) => r.refYear === year && r.refMonth === month)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    return this.receipts.get(id);
  }

  async getReceiptByContractAndRef(contractId: string, year: number, month: number): Promise<Receipt | undefined> {
    return Array.from(this.receipts.values()).find(
      (r) => r.contractId === contractId && r.refYear === year && r.refMonth === month
    );
  }

  async createReceipt(data: InsertReceipt): Promise<Receipt> {
    const id = data.id || randomUUID();
    const receipt: Receipt = {
      ...data,
      id,
      isInvoiceIssued: data.isInvoiceIssued ?? false,
      createdAt: new Date(),
    };
    this.receipts.set(id, receipt);
    return receipt;
  }

  async updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<Receipt | undefined> {
    const existing = this.receipts.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.receipts.set(id, updated);
    return updated;
  }

  async deleteDraftReceiptsByContractId(contractId: string): Promise<void> {
    for (const [id, receipt] of this.receipts.entries()) {
      if (receipt.contractId === contractId && receipt.status === "draft") {
        this.receipts.delete(id);
      }
    }
  }

  async getCashTransactions(): Promise<CashTransaction[]> {
    return Array.from(this.cashTransactions.values()).sort((a, b) => {
      // date can be string or Date
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return dateB - dateA;
    });
  }

  async getCashTransactionsByReceiptIds(receiptIds: string[]): Promise<CashTransaction[]> {
    return Array.from(this.cashTransactions.values()).filter(t => t.receiptId && receiptIds.includes(t.receiptId));
  }

  async getCashTransaction(id: string): Promise<CashTransaction | undefined> {
    return this.cashTransactions.get(id);
  }

  async createCashTransaction(data: InsertCashTransaction): Promise<CashTransaction> {
    const id = data.id || randomUUID();
    const transaction: CashTransaction = {
      ...data,
      id,
      date: typeof data.date === 'string' ? new Date(data.date) : data.date as unknown as string,
      createdAt: new Date(),
    };
    this.cashTransactions.set(id, transaction);
    return transaction;
  }

  async updateCashTransaction(id: string, data: Partial<InsertCashTransaction>): Promise<CashTransaction | undefined> {
    const existing = this.cashTransactions.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data } as CashTransaction;
    this.cashTransactions.set(id, updated);
    return updated;
  }

  async deleteCashTransaction(id: string): Promise<void> {
    this.cashTransactions.delete(id);
  }

  async deleteCashTransactionByReceiptAndType(receiptId: string, type: "IN" | "OUT"): Promise<void> {
    for (const [id, transaction] of this.cashTransactions.entries()) {
      if (transaction.receiptId === receiptId && transaction.type === type) {
        this.cashTransactions.delete(id);
      }
    }
  }

  async getLandlordTransfers(): Promise<LandlordTransfer[]> {
    return Array.from(this.landlordTransfers.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getLandlordTransfer(id: string): Promise<LandlordTransfer | undefined> {
    return this.landlordTransfers.get(id);
  }

  async getEnrichedLandlordTransfers(): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
    return Array.from(this.landlordTransfers.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((transfer) => {
        const receipt = this.receipts.get(transfer.receiptId);
        let propertyName = "-";
        if (receipt) {
          const contract = this.contracts.get(receipt.contractId);
          if (contract) {
            const property = this.properties.get(contract.propertyId);
            if (property) propertyName = property.title;
          }
        }
        return {
          ...transfer,
          propertyName,
          refMonth: receipt?.refMonth || 0,
          refYear: receipt?.refYear || 0,
        };
      });
  }

  async getLandlordTransfersReport(year: number, month: number, type: "ref" | "paid"): Promise<LandlordTransfer[]> {
    const transfers = Array.from(this.landlordTransfers.values());
    const filtered: LandlordTransfer[] = [];
    
    for (const transfer of transfers) {
      if (type === "paid") {
        if (transfer.paidAt) {
          const paidDate = new Date(transfer.paidAt);
          if (paidDate.getFullYear() === year && paidDate.getMonth() + 1 === month) {
            filtered.push(transfer);
          }
        }
      } else {
        const receipt = this.receipts.get(transfer.receiptId);
        if (receipt && receipt.refYear === year && receipt.refMonth === month) {
          filtered.push(transfer);
        }
      }
    }
    
    return filtered;
  }

  async getRevenueReport(year: number, month: number): Promise<RevenueReportItem[]> {
    return [];
  }

  async createLandlordTransfer(data: InsertLandlordTransfer): Promise<LandlordTransfer> {
    const id = data.id || randomUUID();
    const transfer: LandlordTransfer = {
      ...data,
      id,
      referenceDate: typeof data.referenceDate === 'string' ? new Date(data.referenceDate) : data.referenceDate as unknown as string,
      paidAt: data.paidAt ? (typeof data.paidAt === 'string' ? new Date(data.paidAt) : data.paidAt) : null,
      receiptUrl: data.receiptUrl || null,
      createdAt: new Date(),
    };
    this.landlordTransfers.set(id, transfer);
    return transfer;
  }

  async updateLandlordTransfer(id: string, data: Partial<InsertLandlordTransfer>): Promise<LandlordTransfer | undefined> {
    const existing = this.landlordTransfers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data } as LandlordTransfer;
    this.landlordTransfers.set(id, updated);
    return updated;
  }

  async deleteLandlordTransfer(id: string): Promise<void> {
    this.landlordTransfers.delete(id);
  }

  async getInvoices(): Promise<Invoice[]> {
    return Array.from(this.invoices.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  async getPropertyTypeByInvoiceId(invoiceId: string): Promise<string | undefined> {
    // Mock implementation: returns undefined or mock data
    // Since this is memory storage, we would need to traverse the maps manually
    // But for now, returning undefined is safe as it will fallback to default NBS
    return undefined; 
  }

  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const id = data.id || randomUUID();
    const invoice: Invoice = {
      ...data,
      id,
      externalId: data.externalId || null,
      pdfUrl: data.pdfUrl || null,
      errorMessage: data.errorMessage || null,
      createdAt: new Date(),
    };
    this.invoices.set(id, invoice);
    return invoice;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const existing = this.invoices.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.invoices.set(id, updated);
    return updated;
  }

  async deleteInvoice(id: string): Promise<void> {
    this.invoices.delete(id);
  }

  // NFS-e Implementation
  async getNfseConfig(): Promise<NfseConfig | undefined> {
    return this.nfseConfig;
  }

  async createNfseConfig(data: InsertNfseConfig): Promise<NfseConfig> {
    const id = data.id || randomUUID();
    const config: NfseConfig = {
      ...data,
      id,
      regimeTributario: data.regimeTributario || null,
      cnae: data.cnae || null,
      certificadoSenha: data.certificadoSenha || null,
      issRetido: data.issRetido || false,
      ambiente: data.ambiente || "homologacao",
      updatedAt: new Date(),
    };
    this.nfseConfig = config;
    return config;
  }

  async updateNfseConfig(id: string, data: Partial<InsertNfseConfig>): Promise<NfseConfig | undefined> {
    if (!this.nfseConfig || this.nfseConfig.id !== id) return undefined;
    this.nfseConfig = { ...this.nfseConfig, ...data, updatedAt: new Date() };
    return this.nfseConfig;
  }

  async upsertNfseConfig(data: InsertNfseConfig): Promise<NfseConfig> {
    if (this.nfseConfig) {
      this.nfseConfig = { ...this.nfseConfig, ...data, updatedAt: new Date() };
      return this.nfseConfig;
    } else {
      return this.createNfseConfig(data);
    }
  }

  async createNfseLote(data: InsertNfseLote): Promise<NfseLote> {
    const id = data.id || randomUUID();
    const lote: NfseLote = {
      ...data,
      id,
      criadoPorUsuarioId: data.criadoPorUsuarioId || null,
      qtdItens: data.qtdItens || 0,
      valorTotal: data.valorTotal || "0",
      status: data.status || "CRIADO",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.nfseLotes.set(id, lote);
    return lote;
  }

  async getNfseLote(id: string): Promise<NfseLote | undefined> {
    return this.nfseLotes.get(id);
  }

  async updateNfseLote(id: string, data: Partial<InsertNfseLote>): Promise<NfseLote | undefined> {
    const existing = this.nfseLotes.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.nfseLotes.set(id, updated);
    return updated;
  }

  async createNfseEmissao(data: InsertNfseEmissao): Promise<NfseEmissao> {
    const id = data.id || randomUUID();
    const emissao: NfseEmissao = {
      ...data,
      id,
      loteId: data.loteId || null,
      tomadorEmail: data.tomadorEmail || null,
      tomadorEnderecoJson: data.tomadorEnderecoJson || null,
      status: data.status || "PENDENTE",
      idempotencyKey: data.idempotencyKey || null,
      apiRequestRaw: data.apiRequestRaw || null,
      apiResponseRaw: data.apiResponseRaw || null,
      numeroNfse: data.numeroNfse || null,
      codigoVerificacao: data.codigoVerificacao || null,
      chaveAcesso: data.chaveAcesso || null,
      xmlUrl: data.xmlUrl || null,
      pdfUrl: data.pdfUrl || null,
      erroCodigo: data.erroCodigo || null,
      erroMensagem: data.erroMensagem || null,
      retryCount: data.retryCount || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.nfseEmissoes.set(id, emissao);
    return emissao;
  }

  async getNfseEmissoes(): Promise<NfseEmissao[]> {
    return Array.from(this.nfseEmissoes.values());
  }

  async getNfseEmissao(id: string): Promise<NfseEmissao | undefined> {
    return this.nfseEmissoes.get(id);
  }

  async getNfseEmissoesByLote(loteId: string): Promise<NfseEmissao[]> {
    return Array.from(this.nfseEmissoes.values()).filter(e => e.loteId === loteId);
  }

  async updateNfseEmissao(id: string, data: Partial<InsertNfseEmissao>): Promise<NfseEmissao | undefined> {
    const existing = this.nfseEmissoes.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.nfseEmissoes.set(id, updated);
    return updated;
  }

  async getNfseEmissaoByIdempotency(key: string): Promise<NfseEmissao | undefined> {
    return Array.from(this.nfseEmissoes.values()).find(e => e.idempotencyKey === key);
  }

  async getPendingNfseEmissoes(): Promise<NfseEmissao[]> {
    return Array.from(this.nfseEmissoes.values()).filter(e => e.status === "PENDENTE");
  }
}
