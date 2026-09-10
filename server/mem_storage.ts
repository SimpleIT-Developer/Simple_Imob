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
import type { RevenueReportItem, InsuranceReportItem, NfseEmissaoUpdate } from "./storage";
import { randomUUID } from "crypto";

type LandlordSplitOverrideItem = { landlordId: string; amount: number };
type LandlordShareItem = { landlordId: string; percent: number };

function normalizeLandlordSplitOverride(value: unknown): LandlordSplitOverrideItem[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;

  const items: LandlordSplitOverrideItem[] = [];
  for (const raw of value) {
    const landlordId = typeof (raw as any)?.landlordId === "string" ? (raw as any).landlordId : "";
    const amountRaw = (raw as any)?.amount;
    const amount = typeof amountRaw === "number" ? amountRaw : Number(amountRaw);
    if (!landlordId) continue;
    if (!Number.isFinite(amount)) continue;
    items.push({ landlordId, amount });
  }

  return items;
}

function normalizeLandlordShares(value: unknown): LandlordShareItem[] {
  if (!Array.isArray(value)) return [];
  const items: LandlordShareItem[] = [];
  for (const raw of value) {
    const landlordId = typeof (raw as any)?.landlordId === "string" ? (raw as any).landlordId : "";
    const percentRaw = (raw as any)?.percent;
    const percent = typeof percentRaw === "number" ? percentRaw : Number(percentRaw);
    if (!landlordId) continue;
    if (!Number.isFinite(percent) || percent <= 0) continue;
    items.push({ landlordId, percent });
  }
  return items;
}

function normalizeDateString(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.includes("T") ? s.split("T")[0] : s;
}

function normalizeNullableDateString(value: unknown): string | null {
  const s = normalizeDateString(value);
  return s ? s : null;
}

export class MemStorage {
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
    const id = randomUUID();
    const permissionsRaw = (insertUser as any).permissions;
    const permissions = Array.isArray(permissionsRaw) ? permissionsRaw.filter((p) => typeof p === "string") : [];
    const user: User = {
      ...insertUser,
      id,
      role: insertUser.role || "user",
      twoFactorSecret: insertUser.twoFactorSecret ?? null,
      isTwoFactorEnabled: insertUser.isTwoFactorEnabled ?? false,
      permissions,
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
    const id = randomUUID();
    const landlord: Landlord = {
      ...data,
      id,
      code: (data as any).code ?? null,
      address: (data as any).address ?? null,
      phone: (data as any).phone ?? null,
      neighborhood: (data as any).neighborhood ?? null,
      city: (data as any).city ?? null,
      state: (data as any).state ?? null,
      zipCode: (data as any).zipCode ?? null,
      rg: (data as any).rg ?? null,
      maritalStatus: (data as any).maritalStatus ?? null,
      nationality: (data as any).nationality ?? null,
      profession: (data as any).profession ?? null,
      birthDate: (data as any).birthDate ?? null,
      propertyCount: (data as any).propertyCount ?? 0,
      bank: (data as any).bank ?? null,
      branch: (data as any).branch ?? null,
      account: (data as any).account ?? null,
      bankIspb: (data as any).bankIspb ?? null,
      accountType: (data as any).accountType ?? null,
      pixKey: data.pixKey || null,
      pixKeyType: data.pixKeyType || null,
      email: (data as any).email ?? null,
      nfseEnabled: (data as any).nfseEnabled ?? false,
      nfseMunicipalRegistration: (data as any).nfseMunicipalRegistration ?? null,
      nfseMunicipioIbge: (data as any).nfseMunicipioIbge ?? null,
      nfseServiceItem: (data as any).nfseServiceItem ?? null,
      nfseNationalTaxCode: (data as any).nfseNationalTaxCode ?? null,
      nfseServiceDescription: (data as any).nfseServiceDescription ?? null,
      nfseIssRate: (data as any).nfseIssRate ?? null,
      nfseIbsCbsCst: (data as any).nfseIbsCbsCst ?? null,
      nfseIbsCbsClassTrib: (data as any).nfseIbsCbsClassTrib ?? null,
      nfseIbsCbsIndOp: (data as any).nfseIbsCbsIndOp ?? null,
      nfseOpSimpNac: (data as any).nfseOpSimpNac ?? null,
      nfseEnvironment: (data as any).nfseEnvironment ?? null,
      nfseSeries: (data as any).nfseSeries ?? null,
      nfseLastNumber: (data as any).nfseLastNumber ?? 0,
      nfseCertificateFileName: (data as any).nfseCertificateFileName ?? null,
      nfseCertificatePassword: (data as any).nfseCertificatePassword ?? null,
      nfseCertificatePfxBase64: (data as any).nfseCertificatePfxBase64 ?? null,
      nfseCertificateUpdatedAt: (data as any).nfseCertificateUpdatedAt ? new Date((data as any).nfseCertificateUpdatedAt) : null,
      createdAt: new Date(),
    };
    this.landlords.set(id, landlord);
    return landlord;
  }

  async updateLandlord(id: string, data: Partial<InsertLandlord>): Promise<Landlord | undefined> {
    const existing = this.landlords.get(id);
    if (!existing) return undefined;
    const updated = {
      ...existing,
      ...data,
      ...(Object.prototype.hasOwnProperty.call(data as any, "nfseCertificateUpdatedAt")
        ? {
            nfseCertificateUpdatedAt: (data as any).nfseCertificateUpdatedAt
              ? new Date((data as any).nfseCertificateUpdatedAt)
              : null,
          }
        : {}),
    };
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
    const id = randomUUID();
    const tenant: Tenant = {
      ...data,
      id,
      code: (data as any).code ?? null,
      address: (data as any).address ?? null,
      phone: (data as any).phone ?? null,
      neighborhood: (data as any).neighborhood ?? null,
      city: (data as any).city ?? null,
      state: (data as any).state ?? null,
      zipCode: (data as any).zipCode ?? null,
      rg: (data as any).rg ?? null,
      email: (data as any).email ?? null,
      maritalStatus: (data as any).maritalStatus ?? null,
      profession: (data as any).profession ?? null,
      birthDate: (data as any).birthDate ?? null,
      class: (data as any).class ?? null,
      pixKeyType: (data as any).pixKeyType ?? null,
      pixKey: (data as any).pixKey ?? null,
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
    const id = randomUUID();
    const guarantor: Guarantor = {
      ...data,
      id,
      code: (data as any).code ?? null,
      address: (data as any).address ?? null,
      phone: (data as any).phone ?? null,
      neighborhood: (data as any).neighborhood ?? null,
      city: (data as any).city ?? null,
      state: (data as any).state ?? null,
      zipCode: (data as any).zipCode ?? null,
      rg: (data as any).rg ?? null,
      email: (data as any).email ?? null,
      maritalStatus: (data as any).maritalStatus ?? null,
      profession: (data as any).profession ?? null,
      birthDate: (data as any).birthDate ?? null,
      class: (data as any).class ?? null,
      spouseName: (data as any).spouseName ?? null,
      spouseDoc: (data as any).spouseDoc ?? null,
      spouseRg: (data as any).spouseRg ?? null,
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
    const id = randomUUID();
    const provider: ServiceProvider = {
      ...data,
      id,
      doc: (data as any).doc ?? null,
      email: (data as any).email ?? null,
      phone: (data as any).phone ?? null,
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
    const id = randomUUID();
    const property: Property = {
      ...data,
      id,
      type: (data as any).type ?? null,
      saleRent: (data as any).saleRent ?? null,
      status: data.status || "available",
      neighborhood: (data as any).neighborhood ?? null,
      zipCode: (data as any).zipCode ?? null,
      landlordId: (data as any).landlordId ?? null,
      landlordShares: normalizeLandlordShares((data as any).landlordShares),
      createdAt: new Date(),
    };
    this.properties.set(id, property);

    if (property.landlordId) {
      const landlord = this.landlords.get(property.landlordId);
      if (landlord) {
        this.landlords.set(property.landlordId, {
          ...landlord,
          propertyCount: (landlord.propertyCount || 0) + 1,
        });
      }
    }

    return property;
  }

  async updateProperty(id: string, data: Partial<InsertProperty>): Promise<Property | undefined> {
    const existing = this.properties.get(id);
    if (!existing) return undefined;

    const landlordShares = Object.prototype.hasOwnProperty.call(data, "landlordShares")
      ? normalizeLandlordShares((data as any).landlordShares)
      : existing.landlordShares;
    const saleRent = Object.prototype.hasOwnProperty.call(data, "saleRent")
      ? ((data as any).saleRent ?? null)
      : existing.saleRent;
    const updated = { ...existing, ...data, landlordShares, saleRent };
    this.properties.set(id, updated);

    // Handle landlord change
    if (data.landlordId !== undefined && data.landlordId !== existing.landlordId) {
      // 1. Decrement old landlord count
      if (existing.landlordId) {
        const oldLandlord = this.landlords.get(existing.landlordId);
        if (oldLandlord) {
          this.landlords.set(existing.landlordId, {
            ...oldLandlord,
            propertyCount: Math.max((oldLandlord.propertyCount || 0) - 1, 0),
          });
        }
      }

      // 2. Increment new landlord count
      if (data.landlordId) {
        const newLandlord = this.landlords.get(data.landlordId);
        if (newLandlord) {
          this.landlords.set(data.landlordId, {
            ...newLandlord,
            propertyCount: (newLandlord.propertyCount || 0) + 1,
          });
        }
      }
    }

    return updated;
  }

  async deleteProperty(id: string): Promise<void> {
    const existing = this.properties.get(id);
    if (existing?.landlordId) {
      const landlord = this.landlords.get(existing.landlordId);
      if (landlord) {
        this.landlords.set(existing.landlordId, {
          ...landlord,
          propertyCount: Math.max((landlord.propertyCount || 0) - 1, 0),
        });
      }
    }
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
    const id = randomUUID();
    const contract: Contract = {
      ...data,
      id,
      guarantorId: data.guarantorId ?? null,
      guaranteeType: data.guaranteeType ?? "guarantor",
      insuranceValue: data.insuranceValue ?? null,
      startDate: normalizeDateString((data as any).startDate),
      endDate: normalizeDateString((data as any).endDate),
      firstDueDate: normalizeNullableDateString((data as any).firstDueDate),
      status: data.status ?? "active",
      createdAt: new Date(),
    };
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
    if (Object.prototype.hasOwnProperty.call(data, "startDate")) {
      updates.startDate = normalizeDateString((data as any).startDate);
    }
    if (Object.prototype.hasOwnProperty.call(data, "endDate")) {
      updates.endDate = normalizeDateString((data as any).endDate);
    }
    if (Object.prototype.hasOwnProperty.call(data, "firstDueDate")) {
      updates.firstDueDate = normalizeNullableDateString((data as any).firstDueDate);
    }

    const updated = { ...existing, ...updates } as Contract;
    this.contracts.set(id, updated);

    if (updated.status === "inactive" || updated.status === "terminated") {
      const property = this.properties.get(updated.propertyId);
      if (property) {
        property.status = "available";
        this.properties.set(updated.propertyId, property);
      }
    }

    return updated;
  }

  async deleteContract(id: string): Promise<void> {
    const contract = this.contracts.get(id);
    if (contract) {
      const property = this.properties.get(contract.propertyId);
      if (property) {
        property.status = "available";
        this.properties.set(contract.propertyId, property);
      }
    }
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
    const id = randomUUID();
    const service: Service = {
      ...data,
      id,
      providerId: data.providerId || null,
      discountFrom: (data as any).discountFrom ?? null,
      receiptDiscountTo: (data as any).receiptDiscountTo ?? null,
      passThrough: (data as any).passThrough ?? false,
      isTribute: (data as any).isTribute ?? false,
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

  async getReceiptsByIds(ids: string[]): Promise<Receipt[]> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const set = new Set(ids);
    return Array.from(this.receipts.values())
      .filter(r => set.has(r.id))
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
    const id = randomUUID();
    const receipt: Receipt = {
      ...data,
      id,
      dueDate: (data as any).dueDate ?? null,
      status: data.status ?? "draft",
      servicesTenantTotal: (data as any).servicesTenantTotal ?? "0",
      servicesLandlordTotal: (data as any).servicesLandlordTotal ?? "0",
      isSlipIssued: (data as any).isSlipIssued ?? false,
      slipPdfUrl: (data as any).slipPdfUrl ?? null,
      slipOurNumber: (data as any).slipOurNumber ?? null,
      slipDigitableLine: (data as any).slipDigitableLine ?? null,
      slipBarcode: (data as any).slipBarcode ?? null,
      interestAmount: (data as any).interestAmount ?? "0",
      landlordSplitOverride: normalizeLandlordSplitOverride((data as any).landlordSplitOverride),
      isInvoiceGenerated: data.isInvoiceGenerated ?? false,
      isInvoiceIssued: data.isInvoiceIssued ?? false,
      isInvoiceCancelled: data.isInvoiceCancelled ?? false,
      createdAt: new Date(),
    };
    this.receipts.set(id, receipt);
    return receipt;
  }

  async updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<Receipt | undefined> {
    const existing = this.receipts.get(id);
    if (!existing) return undefined;
    const landlordSplitOverride = Object.prototype.hasOwnProperty.call(data, "landlordSplitOverride")
      ? normalizeLandlordSplitOverride((data as any).landlordSplitOverride)
      : existing.landlordSplitOverride;
    const updated: Receipt = { ...existing, ...data, landlordSplitOverride };
    this.receipts.set(id, updated);
    return updated;
  }

  async deleteReceipt(id: string): Promise<void> {
    this.receipts.delete(id);
  }

  async deleteDraftReceiptsByContractId(contractId: string): Promise<Receipt[]> {
    const deletedReceipts: Receipt[] = [];
    for (const [id, receipt] of this.receipts.entries()) {
      if (receipt.contractId === contractId && receipt.status === "draft") {
        deletedReceipts.push(receipt);
        this.receipts.delete(id);
      }
    }
    return deletedReceipts;
  }

  async deleteDraftReceiptsByRef(year: number, month: number): Promise<Receipt[]> {
    const toDelete: Receipt[] = [];
    for (const [id, receipt] of this.receipts.entries()) {
      if (receipt.status === "draft" && receipt.refYear === year && receipt.refMonth === month) {
        toDelete.push(receipt);
      }
    }
    for (const receipt of toDelete) {
      this.receipts.delete(receipt.id);
    }
    return toDelete;
  }

  async getCashTransactions(startDate?: string, endDate?: string): Promise<CashTransaction[]> {
    let transactions = Array.from(this.cashTransactions.values());
    
    if (startDate && endDate) {
      const start = new Date(startDate).getTime();
      const end = new Date(endDate).getTime();
      transactions = transactions.filter(t => {
        const date = new Date(t.date).getTime();
        return date >= start && date <= end;
      });
    }

    return transactions.sort((a, b) => {
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
    const id = randomUUID();
    const transaction: CashTransaction = {
      ...data,
      id,
      date: String((data as any).date),
      description: (data as any).description ?? null,
      receiptId: (data as any).receiptId ?? null,
      createdAt: new Date(),
    };
    this.cashTransactions.set(id, transaction);
    return transaction;
  }

  async updateCashTransaction(id: string, data: Partial<InsertCashTransaction>): Promise<CashTransaction | undefined> {
    const existing = this.cashTransactions.get(id);
    if (!existing) return undefined;
    const date = Object.prototype.hasOwnProperty.call(data, "date") ? String((data as any).date) : existing.date;
    const updated: CashTransaction = { ...existing, ...data, date } as CashTransaction;
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

  async getEnrichedLandlordTransfers(month?: number, year?: number): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
    return Array.from(this.landlordTransfers.values())
      .filter(t => {
        if (!month || !year) return true;
        const receipt = this.receipts.get(t.receiptId);
        return receipt?.refMonth === month && receipt?.refYear === year;
      })
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

  async getLandlordTransfersReport(year: number, month: number, type: "ref" | "paid"): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
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
    
    return filtered.map(transfer => {
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

  async getLandlordTransfersByPaymentPeriod(startDate: string, endDate: string, landlordId?: string): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
    const start = new Date(startDate + "T00:00:00.000Z");
    const end = new Date(endDate + "T23:59:59.999Z");
    const transfers = Array.from(this.landlordTransfers.values());
    return transfers
      .filter(t => t.paidAt && new Date(t.paidAt) >= start && new Date(t.paidAt) <= end)
      .filter(t => !landlordId || t.landlordId === landlordId)
      .sort((a, b) => (b.paidAt?.getTime() || 0) - (a.paidAt?.getTime() || 0))
      .map(transfer => {
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

  async getRevenueReport(year: number, month: number): Promise<RevenueReportItem[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

    const items: RevenueReportItem[] = [];
    for (const receipt of this.receipts.values()) {
      if (receipt.status === "paid" || receipt.status === "transferred") {
        
        // Check for valid cash transaction
        const hasValidTransaction = Array.from(this.cashTransactions.values()).some(t => 
          t.receiptId === receipt.id && 
          t.type === "IN" &&
          t.date >= startDate && 
          t.date <= endDate
        );

        if (!hasValidTransaction) continue;

        const contract = this.contracts.get(receipt.contractId);
        if (!contract) continue;
        const property = this.properties.get(contract.propertyId);
        const landlord = this.landlords.get(contract.landlordId);
        const tenant = this.tenants.get(contract.tenantId);
        if (!property || !landlord || !tenant) continue;

        const transfer = Array.from(this.landlordTransfers.values()).find(
          (t) => t.receiptId === receipt.id
        );

        items.push({
          receiptId: receipt.id,
          propertyCode: property.code,
          landlordName: landlord.name,
          tenantName: tenant.name,
          refYear: receipt.refYear,
          refMonth: receipt.refMonth,
          rentAmount: String(receipt.rentAmount),
          adminFeeAmount: String(receipt.adminFeeAmount),
          interestAmount: String((receipt as any).interestAmount ?? "0"),
          transferAmount: transfer ? String(transfer.amount) : null,
          status: receipt.status,
        });
      }
    }
    return items.sort((a, b) => a.propertyCode.localeCompare(b.propertyCode));
  }

  async getInsuranceReport(startDate: string, endDate: string, statuses: ("paid" | "transferred" | "closed")[] = ["paid", "transferred"]): Promise<InsuranceReportItem[]> {
    const items: InsuranceReportItem[] = [];
    for (const receipt of this.receipts.values()) {
      if (statuses.includes(receipt.status as any)) {
        // Check for valid cash transaction
        const hasValidTransaction = Array.from(this.cashTransactions.values()).some(t => 
          t.receiptId === receipt.id && 
          t.type === "IN" &&
          t.date >= startDate && 
          t.date <= endDate
        );

        if (!hasValidTransaction) continue;

        const contract = this.contracts.get(receipt.contractId);
        if (!contract) continue;
        if (contract.guaranteeType !== "insurance") continue;
        const property = this.properties.get(contract.propertyId);
        const landlord = this.landlords.get(contract.landlordId);
        const tenant = this.tenants.get(contract.tenantId);
        if (!property || !landlord || !tenant) continue;

        items.push({
          receiptId: receipt.id,
          contractId: contract.id,
          propertyCode: property.code,
          landlordName: landlord.name,
          tenantName: tenant.name,
          refYear: receipt.refYear,
          refMonth: receipt.refMonth,
          insuranceValue: String(contract.insuranceValue || "0"),
          status: receipt.status,
        });
      }
    }
    return items.sort((a, b) => a.propertyCode.localeCompare(b.propertyCode));
  }

  async createLandlordTransfer(data: InsertLandlordTransfer): Promise<LandlordTransfer> {
    const id = randomUUID();
    const rawPaidAt = (data as any).paidAt;
    const paidAt: Date | null = rawPaidAt
      ? rawPaidAt instanceof Date
        ? rawPaidAt
        : new Date(String(rawPaidAt))
      : null;
    const transfer: LandlordTransfer = {
      ...data,
      id,
      status: data.status ?? "pending",
      paymentMethod: data.paymentMethod ?? null,
      paidAt,
      providerTransferId: data.providerTransferId ?? null,
      errorMessage: data.errorMessage ?? null,
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
    const id = randomUUID();
    const invoice: Invoice = {
      ...data,
      id,
      invoiceCategory: (data as any).invoiceCategory ?? "ADMINISTRACAO",
      status: data.status ?? "draft",
      providerInvoiceId: data.providerInvoiceId ?? null,
      number: data.number ?? null,
      errorMessage: data.errorMessage ?? null,
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
    const id = randomUUID();
    const config: NfseConfig = {
      ...data,
      id,
      regimeTributario: data.regimeTributario || null,
      cnae: data.cnae || null,
      certificadoSenha: data.certificadoSenha || null,
      issRetido: data.issRetido || false,
      ambiente: data.ambiente || "homologacao",
      ultimoNumeroNfse: (data as any).ultimoNumeroNfse ?? 0,
      serieNfse: (data as any).serieNfse ?? "900",
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
    const id = randomUUID();
    const lote: NfseLote = {
      ...data,
      id,
      criadoPorUsuarioId: data.criadoPorUsuarioId || null,
      qtdItens: data.qtdItens ?? 0,
      valorTotal: data.valorTotal ?? "0",
      status: data.status ?? "CRIADO",
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
    const id = randomUUID();
    const emissao: NfseEmissao = {
      ...data,
      id,
      loteId: data.loteId || null,
      tomadorEmail: data.tomadorEmail || null,
      tomadorEnderecoJson: data.tomadorEnderecoJson || null,
      imovelEnderecoJson: data.imovelEnderecoJson || null,
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
      retryCount: data.retryCount ?? 0,
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

  async updateNfseEmissao(id: string, data: NfseEmissaoUpdate): Promise<NfseEmissao | undefined> {
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
