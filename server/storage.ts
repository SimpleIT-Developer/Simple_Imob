import {
  users, landlords, tenants, guarantors, serviceProviders, properties, contracts, services,
  receipts, cashTransactions, landlordTransfers, invoices,
  type User, type InsertUser,
  type Landlord, type InsertLandlord,
  type Tenant, type InsertTenant,
  type Guarantor, type InsertGuarantor,
  type ServiceProvider, type InsertServiceProvider,
  type Property, type InsertProperty,
  type Contract, type InsertContract,
  type ContractRecurringItem, type InsertContractRecurringItem,
  type Service, type InsertService,
  type Receipt, type InsertReceipt,
  type CashTransaction, type InsertCashTransaction,
  type LandlordTransfer, type InsertLandlordTransfer,
  type Invoice, type InsertInvoice,
  type NfseConfig, type InsertNfseConfig,
  type NfseLote, type InsertNfseLote,
  type NfseEmissao, type InsertNfseEmissao,
  type SystemLog, type InsertSystemLog,
  type FinancialRecord, type InsertFinancialRecord,
  type FinancialPeriod, type InsertFinancialPeriod,
  nfseConfig, nfseLotes, nfseEmissoes, systemLogs, contractRecurringItems, financialRecords, financialPeriods,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, gte, lte, inArray, ne, sql, or, lt, gt } from "drizzle-orm";
import { MemStorage } from "./mem_storage";

export type RevenueReportItem = {
  receiptId: string;
  propertyCode: string;
  landlordName: string;
  tenantName: string;
  refYear: number;
  refMonth: number;
  rentAmount: string;
  adminFeeAmount: string;
  interestAmount: string;
  transferAmount: string | null;
  status: string;
};

export type InsuranceReportItem = {
  receiptId: string;
  contractId: string;
  propertyCode: string;
  landlordName: string;
  tenantName: string;
  refYear: number;
  refMonth: number;
  insuranceValue: string;
  status: string;
};

export type NfseEmissaoUpdate = Partial<typeof nfseEmissoes.$inferInsert>;

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getLandlords(): Promise<Landlord[]>;
  getNextLandlordCode(): Promise<string>;
  getLandlord(id: string): Promise<Landlord | undefined>;
  createLandlord(data: InsertLandlord): Promise<Landlord>;
  updateLandlord(id: string, data: Partial<InsertLandlord>): Promise<Landlord | undefined>;
  deleteLandlord(id: string): Promise<void>;

  getTenants(): Promise<Tenant[]>;
  getNextTenantCode(): Promise<string>;
  getTenant(id: string): Promise<Tenant | undefined>;
  createTenant(data: InsertTenant): Promise<Tenant>;
  updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined>;
  deleteTenant(id: string): Promise<void>;

  getGuarantors(): Promise<Guarantor[]>;
  getNextGuarantorCode(): Promise<string>;
  getGuarantor(id: string): Promise<Guarantor | undefined>;
  createGuarantor(data: InsertGuarantor): Promise<Guarantor>;
  updateGuarantor(id: string, data: Partial<InsertGuarantor>): Promise<Guarantor | undefined>;
  deleteGuarantor(id: string): Promise<void>;

  getServiceProviders(): Promise<ServiceProvider[]>;
  getServiceProvider(id: string): Promise<ServiceProvider | undefined>;
  createServiceProvider(data: InsertServiceProvider): Promise<ServiceProvider>;
  updateServiceProvider(id: string, data: Partial<InsertServiceProvider>): Promise<ServiceProvider | undefined>;
  deleteServiceProvider(id: string): Promise<void>;

  getProperties(): Promise<Property[]>;
  getNextPropertyCode(): Promise<string>;
  getProperty(id: string): Promise<Property | undefined>;
  createProperty(data: InsertProperty): Promise<Property>;
  updateProperty(id: string, data: Partial<InsertProperty>): Promise<Property | undefined>;
  deleteProperty(id: string): Promise<void>;

  getContracts(): Promise<Contract[]>;
  getActiveContracts(): Promise<Contract[]>;
  getContract(id: string): Promise<Contract | undefined>;
  createContract(data: InsertContract): Promise<Contract>;
  updateContract(id: string, data: Partial<InsertContract>): Promise<Contract | undefined>;
  deleteContract(id: string): Promise<void>;

  getContractRecurringItems(contractId: string): Promise<ContractRecurringItem[]>;
  createContractRecurringItem(data: InsertContractRecurringItem): Promise<ContractRecurringItem>;
  deleteContractRecurringItem(id: string): Promise<void>;

  getServices(): Promise<Service[]>;
  getServicesByContractAndRef(contractId: string, year: number, month: number): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(data: InsertService): Promise<Service>;
  updateService(id: string, data: Partial<InsertService>): Promise<Service | undefined>;
  deleteService(id: string): Promise<void>;
  deleteServicesBulk(ids: string[]): Promise<void>;

  getReceipts(): Promise<Receipt[]>;
  getReceiptsByRef(year: number, month: number): Promise<Receipt[]>;
  getReceiptsByIds(ids: string[]): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | undefined>;
  getReceiptByContractAndRef(contractId: string, year: number, month: number): Promise<Receipt | undefined>;
  createReceipt(data: InsertReceipt): Promise<Receipt>;
  updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<Receipt | undefined>;
  deleteReceipt(id: string): Promise<void>;
  deleteDraftReceiptsByContractId(contractId: string): Promise<void>;

  getCashTransactions(startDate?: string, endDate?: string): Promise<CashTransaction[]>;
  getCashTransactionsByReceiptIds(receiptIds: string[]): Promise<CashTransaction[]>;
  getCashTransaction(id: string): Promise<CashTransaction | undefined>;
  createCashTransaction(data: InsertCashTransaction): Promise<CashTransaction>;
  updateCashTransaction(id: string, data: Partial<InsertCashTransaction>): Promise<CashTransaction | undefined>;
  deleteCashTransaction(id: string): Promise<void>;
  deleteCashTransactionByReceiptAndType(receiptId: string, type: "IN" | "OUT"): Promise<void>;

  getLandlordTransfers(): Promise<LandlordTransfer[]>;
  getLandlordTransfer(id: string): Promise<LandlordTransfer | undefined>;
  getEnrichedLandlordTransfers(month?: number, year?: number): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]>;
  getLandlordTransfersReport(year: number, month: number, type: "ref" | "paid"): Promise<LandlordTransfer[]>;
  getLandlordTransfersByPaymentPeriod(startDate: string, endDate: string, landlordId?: string): Promise<LandlordTransfer[]>;
  getLandlordTransfersByReceipt(receiptId: string): Promise<LandlordTransfer[]>;
  getRevenueReport(year: number, month: number): Promise<RevenueReportItem[]>;
  getInsuranceReport(startDate: string, endDate: string, statuses?: ("paid" | "transferred" | "closed")[]): Promise<InsuranceReportItem[]>;

  createLandlordTransfer(data: InsertLandlordTransfer): Promise<LandlordTransfer>;
  updateLandlordTransfer(id: string, data: Partial<InsertLandlordTransfer>): Promise<LandlordTransfer | undefined>;
  deleteLandlordTransfer(id: string): Promise<void>;

  getInvoices(): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  getPropertyTypeByInvoiceId(invoiceId: string): Promise<string | undefined>;
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  deleteInvoice(id: string): Promise<void>;

  // Financial Records (Expense Control)
  getFinancialRecords(year: number, month: number): Promise<FinancialRecord[]>;
  getFinancialRecord(id: string): Promise<FinancialRecord | undefined>;
  createFinancialRecord(data: InsertFinancialRecord): Promise<FinancialRecord>;
  updateFinancialRecord(id: string, data: Partial<InsertFinancialRecord>): Promise<FinancialRecord | undefined>;
  deleteFinancialRecord(id: string): Promise<void>;
  getFinancialRecordPreviousBalance(year: number, month: number): Promise<number>;

  // Financial Periods
  getFinancialPeriod(year: number, month: number): Promise<FinancialPeriod | undefined>;
  toggleFinancialPeriod(year: number, month: number, status: string): Promise<FinancialPeriod>;

  // NFS-e methods
  getNfseConfig(): Promise<NfseConfig | undefined>;
  createNfseConfig(data: InsertNfseConfig): Promise<NfseConfig>;
  updateNfseConfig(id: string, data: Partial<InsertNfseConfig>): Promise<NfseConfig | undefined>;
  upsertNfseConfig(data: InsertNfseConfig): Promise<NfseConfig>;
  
  createNfseLote(data: InsertNfseLote): Promise<NfseLote>;
  getNfseLote(id: string): Promise<NfseLote | undefined>;
  updateNfseLote(id: string, data: Partial<InsertNfseLote>): Promise<NfseLote | undefined>;
  
  createNfseEmissao(data: InsertNfseEmissao): Promise<NfseEmissao>;
  getNfseEmissoes(): Promise<NfseEmissao[]>;
  getNfseEmissao(id: string): Promise<NfseEmissao | undefined>;
  getNfseEmissoesByLote(loteId: string): Promise<NfseEmissao[]>;
  updateNfseEmissao(id: string, data: NfseEmissaoUpdate): Promise<NfseEmissao | undefined>;
  getNfseEmissaoByIdempotency(key: string): Promise<NfseEmissao | undefined>;
  getPendingNfseEmissoes(): Promise<NfseEmissao[]>;

  // System Logs
  createSystemLog(data: InsertSystemLog): Promise<SystemLog>;
  getSystemLogs(limit?: number): Promise<SystemLog[]>;
  clearSystemLogs(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const normalized = {
      ...insertUser,
      permissions: Array.isArray((insertUser as any).permissions)
        ? (insertUser as any).permissions.map((p: unknown) => String(p))
        : [],
    } satisfies typeof users.$inferInsert;

    const [user] = await db.insert(users).values(normalized).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const normalized: Partial<typeof users.$inferInsert> = {
      ...data,
      ...(Object.prototype.hasOwnProperty.call(data as any, "permissions")
        ? {
            permissions: Array.isArray((data as any).permissions)
              ? (data as any).permissions.map((p: unknown) => String(p))
              : [],
          }
        : {}),
    };

    const [user] = await db.update(users).set(normalized).where(eq(users.id, id)).returning();
    return user || undefined;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getLandlords(): Promise<Landlord[]> {
    return db.select().from(landlords).orderBy(desc(landlords.createdAt));
  }

  async getNextLandlordCode(): Promise<string> {
    const result = await db.select({ code: landlords.code }).from(landlords);
    let maxId = 0;
    const prefix = "P";
    const pattern = /^P(\d+)$/;
    
    for (const r of result) {
      if (!r.code) continue;
      const match = r.code.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    }
    
    return `${prefix}${(maxId + 1).toString().padStart(5, '0')}`;
  }

  async getLandlord(id: string): Promise<Landlord | undefined> {
    const [landlord] = await db.select().from(landlords).where(eq(landlords.id, id));
    return landlord || undefined;
  }

  async createLandlord(data: InsertLandlord): Promise<Landlord> {
    const [landlord] = await db.insert(landlords).values(data).returning();
    return landlord;
  }

  async updateLandlord(id: string, data: Partial<InsertLandlord>): Promise<Landlord | undefined> {
    const [landlord] = await db.update(landlords).set(data).where(eq(landlords.id, id)).returning();
    return landlord || undefined;
  }

  async deleteLandlord(id: string): Promise<void> {
    await db.delete(landlords).where(eq(landlords.id, id));
  }

  async getTenants(): Promise<Tenant[]> {
    return db.select().from(tenants).orderBy(desc(tenants.createdAt));
  }

  async getNextTenantCode(): Promise<string> {
    const result = await db.select({ code: tenants.code }).from(tenants);
    let maxId = 0;
    const prefix = "L";
    const pattern = /^L(\d+)$/;
    
    for (const r of result) {
      if (!r.code) continue;
      const match = r.code.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    }
    
    return `${prefix}${(maxId + 1).toString().padStart(5, '0')}`;
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant || undefined;
  }

  async createTenant(data: InsertTenant): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values(data).returning();
    return tenant;
  }

  async updateTenant(id: string, data: Partial<InsertTenant>): Promise<Tenant | undefined> {
    const [tenant] = await db.update(tenants).set(data).where(eq(tenants.id, id)).returning();
    return tenant || undefined;
  }

  async deleteTenant(id: string): Promise<void> {
    await db.delete(tenants).where(eq(tenants.id, id));
  }

  async getGuarantors(): Promise<Guarantor[]> {
    return db.select().from(guarantors).orderBy(desc(guarantors.createdAt));
  }

  async getNextGuarantorCode(): Promise<string> {
    const result = await db.select({ code: guarantors.code }).from(guarantors);
    let maxId = 0;
    const prefix = "F";
    const pattern = /^F(\d+)$/;
    
    for (const r of result) {
      if (!r.code) continue;
      const match = r.code.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    }
    
    return `${prefix}${(maxId + 1).toString().padStart(5, '0')}`;
  }

  async getGuarantor(id: string): Promise<Guarantor | undefined> {
    const [guarantor] = await db.select().from(guarantors).where(eq(guarantors.id, id));
    return guarantor || undefined;
  }

  async createGuarantor(data: InsertGuarantor): Promise<Guarantor> {
    const [guarantor] = await db.insert(guarantors).values(data).returning();
    return guarantor;
  }

  async updateGuarantor(id: string, data: Partial<InsertGuarantor>): Promise<Guarantor | undefined> {
    const [guarantor] = await db.update(guarantors).set(data).where(eq(guarantors.id, id)).returning();
    return guarantor || undefined;
  }

  async deleteGuarantor(id: string): Promise<void> {
    await db.delete(guarantors).where(eq(guarantors.id, id));
  }

  async getServiceProviders(): Promise<ServiceProvider[]> {
    return db.select().from(serviceProviders).orderBy(desc(serviceProviders.createdAt));
  }

  async getServiceProvider(id: string): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    return provider || undefined;
  }

  async createServiceProvider(data: InsertServiceProvider): Promise<ServiceProvider> {
    const [provider] = await db.insert(serviceProviders).values(data).returning();
    return provider;
  }

  async updateServiceProvider(id: string, data: Partial<InsertServiceProvider>): Promise<ServiceProvider | undefined> {
    const [provider] = await db.update(serviceProviders).set(data).where(eq(serviceProviders.id, id)).returning();
    return provider || undefined;
  }

  async deleteServiceProvider(id: string): Promise<void> {
    await db.delete(serviceProviders).where(eq(serviceProviders.id, id));
  }

  async getProperties(): Promise<Property[]> {
    return db.select().from(properties).orderBy(desc(properties.createdAt));
  }

  async getNextPropertyCode(): Promise<string> {
    const result = await db.select({ code: properties.code }).from(properties);
    let maxId = 0;
    const prefix = "I";
    const pattern = /^I(\d+)$/;
    
    for (const r of result) {
      if (!r.code) continue;
      const match = r.code.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    }
    
    return `${prefix}${(maxId + 1).toString().padStart(5, '0')}`;
  }

  async getProperty(id: string): Promise<Property | undefined> {
    const [property] = await db.select().from(properties).where(eq(properties.id, id));
    return property || undefined;
  }

  async createProperty(data: InsertProperty): Promise<Property> {
    const insertData = {
      ...data,
      landlordShares: (data as any).landlordShares ?? [],
    } as any;
    const [property] = await db.insert(properties).values(insertData).returning();

    if (data.landlordId) {
      await db
        .update(landlords)
        .set({ 
          propertyCount: sql`COALESCE(${landlords.propertyCount}, 0) + 1` 
        })
        .where(eq(landlords.id, data.landlordId));
    }

    return property;
  }

  async updateProperty(id: string, data: Partial<InsertProperty>): Promise<Property | undefined> {
    // Get current property state to check for landlord changes
    const currentProperty = await this.getProperty(id);
    if (!currentProperty) return undefined;

    const updateData = {
      ...data,
      ...(Object.prototype.hasOwnProperty.call(data, "landlordShares")
        ? { landlordShares: (data as any).landlordShares ?? [] }
        : null),
    } as any;
    const [property] = await db.update(properties).set(updateData).where(eq(properties.id, id)).returning();

    // Handle landlord change
    if (data.landlordId !== undefined && data.landlordId !== currentProperty.landlordId) {
      // 1. Decrement old landlord count (if exists)
      if (currentProperty.landlordId) {
        await db
          .update(landlords)
          .set({ 
            propertyCount: sql`GREATEST(COALESCE(${landlords.propertyCount}, 0) - 1, 0)` 
          })
          .where(eq(landlords.id, currentProperty.landlordId));
      }

      // 2. Increment new landlord count (if exists)
      if (data.landlordId) {
        await db
          .update(landlords)
          .set({ 
            propertyCount: sql`COALESCE(${landlords.propertyCount}, 0) + 1` 
          })
          .where(eq(landlords.id, data.landlordId));
      }
    }

    return property || undefined;
  }

  async deleteProperty(id: string): Promise<void> {
    const currentProperty = await this.getProperty(id);
    
    await db.delete(properties).where(eq(properties.id, id));

    if (currentProperty?.landlordId) {
      await db
        .update(landlords)
        .set({ 
          propertyCount: sql`GREATEST(COALESCE(${landlords.propertyCount}, 0) - 1, 0)` 
        })
        .where(eq(landlords.id, currentProperty.landlordId));
    }
  }

  async getContracts(): Promise<Contract[]> {
    return db.select().from(contracts).orderBy(desc(contracts.createdAt));
  }

  async getActiveContracts(): Promise<Contract[]> {
    return db.select().from(contracts).where(eq(contracts.status, "active")).orderBy(desc(contracts.createdAt));
  }

  async getContract(id: string): Promise<Contract | undefined> {
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, id));
    return contract || undefined;
  }

  async createContract(data: InsertContract): Promise<Contract> {
    const [contract] = await db.insert(contracts).values(data).returning();
    await db
      .update(properties)
      .set({ status: "rented" })
      .where(eq(properties.id, data.propertyId));
    return contract;
  }

  async updateContract(id: string, data: Partial<InsertContract>): Promise<Contract | undefined> {
    const [contract] = await db.update(contracts).set(data).where(eq(contracts.id, id)).returning();

    if (contract && (contract.status === "inactive" || contract.status === "terminated")) {
      await db
        .update(properties)
        .set({ status: "available" })
        .where(eq(properties.id, contract.propertyId));
    }

    return contract || undefined;
  }

  async deleteContract(id: string): Promise<void> {
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, id));
    
    await db.delete(contracts).where(eq(contracts.id, id));

    if (contract) {
      await db
        .update(properties)
        .set({ status: "available" })
        .where(eq(properties.id, contract.propertyId));
    }
  }

  async getContractRecurringItems(contractId: string): Promise<ContractRecurringItem[]> {
    return db.select().from(contractRecurringItems).where(eq(contractRecurringItems.contractId, contractId));
  }

  async createContractRecurringItem(data: InsertContractRecurringItem): Promise<ContractRecurringItem> {
    const [item] = await db.insert(contractRecurringItems).values(data).returning();
    return item;
  }

  async deleteContractRecurringItem(id: string): Promise<void> {
    await db.delete(contractRecurringItems).where(eq(contractRecurringItems.id, id));
  }

  async getServices(): Promise<Service[]> {
    return db.select().from(services).orderBy(desc(services.createdAt));
  }

  async getServicesByContractAndRef(contractId: string, year: number, month: number): Promise<Service[]> {
    return db.select().from(services).where(
      and(eq(services.contractId, contractId), eq(services.refYear, year), eq(services.refMonth, month))
    );
  }

  async getService(id: string): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service || undefined;
  }

  async createService(data: InsertService): Promise<Service> {
    const [service] = await db.insert(services).values(data).returning();
    return service;
  }

  async updateService(id: string, data: Partial<InsertService>): Promise<Service | undefined> {
    const [service] = await db.update(services).set(data).where(eq(services.id, id)).returning();
    return service || undefined;
  }

  async deleteService(id: string): Promise<void> {
    await db.delete(services).where(eq(services.id, id));
  }

  async deleteServicesBulk(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.delete(services).where(inArray(services.id, ids));
  }

  async getReceipts(): Promise<Receipt[]> {
    return db.select().from(receipts).orderBy(desc(receipts.createdAt));
  }

  async getReceiptsByRef(year: number, month: number): Promise<Receipt[]> {
    return db.select().from(receipts).where(
      and(eq(receipts.refYear, year), eq(receipts.refMonth, month))
    ).orderBy(desc(receipts.createdAt));
  }

  async getReceiptsByIds(ids: string[]): Promise<Receipt[]> {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    return db
      .select()
      .from(receipts)
      .where(inArray(receipts.id, ids))
      .orderBy(desc(receipts.createdAt));
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.id, id));
    return receipt || undefined;
  }

  async getReceiptByContractAndRef(contractId: string, year: number, month: number): Promise<Receipt | undefined> {
    const [receipt] = await db.select().from(receipts).where(
      and(eq(receipts.contractId, contractId), eq(receipts.refYear, year), eq(receipts.refMonth, month))
    );
    return receipt || undefined;
  }

  async createReceipt(data: InsertReceipt): Promise<Receipt> {
    const normalized: typeof receipts.$inferInsert = {
      ...(data as any),
      landlordSplitOverride: Array.isArray((data as any).landlordSplitOverride)
        ? (data as any).landlordSplitOverride.map((s: any) => ({
            landlordId: String(s.landlordId),
            amount: Number(s.amount),
          }))
        : ((data as any).landlordSplitOverride ?? null),
    };

    const [receipt] = await db.insert(receipts).values(normalized).returning();
    return receipt;
  }

  async updateReceipt(id: string, data: Partial<InsertReceipt>): Promise<Receipt | undefined> {
    const normalized: Partial<typeof receipts.$inferInsert> = {
      ...(data as any),
      ...(Object.prototype.hasOwnProperty.call(data as any, "landlordSplitOverride")
        ? {
            landlordSplitOverride: Array.isArray((data as any).landlordSplitOverride)
              ? (data as any).landlordSplitOverride.map((s: any) => ({
                  landlordId: String(s.landlordId),
                  amount: Number(s.amount),
                }))
              : ((data as any).landlordSplitOverride ?? null),
          }
        : {}),
    };

    const [receipt] = await db.update(receipts).set(normalized).where(eq(receipts.id, id)).returning();
    return receipt || undefined;
  }

  async deleteReceipt(id: string): Promise<void> {
    await db.delete(receipts).where(eq(receipts.id, id));
  }

  async deleteDraftReceiptsByContractId(contractId: string): Promise<void> {
    // Get IDs of draft receipts to be deleted
    const draftReceipts = await db.select({ id: receipts.id })
      .from(receipts)
      .where(
        and(
          eq(receipts.contractId, contractId),
          eq(receipts.status, "draft")
        )
      );

    const initialReceiptIds = draftReceipts.map(r => r.id);

    if (initialReceiptIds.length === 0) return;

    // 1. Check for blocking conditions
    
    // Check for Issued Invoices
    const receiptsWithIssuedInvoices = await db.select({ id: invoices.receiptId })
      .from(invoices)
      .where(
        and(
          inArray(invoices.receiptId, initialReceiptIds),
          eq(invoices.status, "issued")
        )
      );
    const blockedByInvoice = new Set(receiptsWithIssuedInvoices.map(r => r.id));

    // Check for Paid/Reversed Transfers
    const receiptsWithPaidTransfers = await db.select({ id: landlordTransfers.receiptId })
      .from(landlordTransfers)
      .where(
        and(
          inArray(landlordTransfers.receiptId, initialReceiptIds),
          inArray(landlordTransfers.status, ["paid", "reversed"])
        )
      );
    const blockedByTransfer = new Set(receiptsWithPaidTransfers.map(r => r.id));

    // Filter receipts that are safe to delete
    const receiptsToDelete = initialReceiptIds.filter(id => 
      !blockedByInvoice.has(id) && !blockedByTransfer.has(id)
    );

    if (receiptsToDelete.length === 0) return;

    // 2. Execute cascade deletions for safe receipts

    // Delete linked invoices (all non-issued ones linked to these receipts)
    await db.delete(invoices).where(
      inArray(invoices.receiptId, receiptsToDelete)
    );

    // Delete linked landlord transfers (pending/failed)
    await db.delete(landlordTransfers).where(
      inArray(landlordTransfers.receiptId, receiptsToDelete)
    );

    // Delete linked cash transactions
    await db.delete(cashTransactions).where(
      inArray(cashTransactions.receiptId, receiptsToDelete)
    );

    // Delete the receipts
    await db.delete(receipts).where(
      inArray(receipts.id, receiptsToDelete)
    );
  }

  async getCashTransactions(startDate?: string, endDate?: string): Promise<CashTransaction[]> {
    if (startDate && endDate) {
      return db
        .select()
        .from(cashTransactions)
        .where(
          and(
            gte(cashTransactions.date, startDate),
            lte(cashTransactions.date, endDate)
          )
        )
        .orderBy(desc(cashTransactions.date), desc(cashTransactions.createdAt));
    }
    return db.select().from(cashTransactions).orderBy(desc(cashTransactions.date), desc(cashTransactions.createdAt));
  }

  async getCashTransactionsByReceiptIds(receiptIds: string[]): Promise<CashTransaction[]> {
    if (receiptIds.length === 0) return [];
    return db.select().from(cashTransactions).where(inArray(cashTransactions.receiptId, receiptIds));
  }

  async getCashTransaction(id: string): Promise<CashTransaction | undefined> {
    const [transaction] = await db.select().from(cashTransactions).where(eq(cashTransactions.id, id));
    return transaction || undefined;
  }

  async createCashTransaction(data: InsertCashTransaction): Promise<CashTransaction> {
    const [transaction] = await db.insert(cashTransactions).values(data).returning();
    return transaction;
  }

  async updateCashTransaction(id: string, data: Partial<InsertCashTransaction>): Promise<CashTransaction | undefined> {
    const [transaction] = await db.update(cashTransactions).set(data).where(eq(cashTransactions.id, id)).returning();
    return transaction || undefined;
  }

  async deleteCashTransaction(id: string): Promise<void> {
    await db.delete(cashTransactions).where(eq(cashTransactions.id, id));
  }

  async deleteCashTransactionByReceiptAndType(receiptId: string, type: "IN" | "OUT"): Promise<void> {
    await db.delete(cashTransactions).where(
      and(
        eq(cashTransactions.receiptId, receiptId),
        eq(cashTransactions.type, type)
      )
    );
  }

  async deleteDraftReceiptsByRef(year: number, month: number): Promise<void> {
    const draftReceipts = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(
        and(
          eq(receipts.refYear, year),
          eq(receipts.refMonth, month),
          eq(receipts.status, "draft")
        )
      );

    const initialReceiptIds = draftReceipts.map((r) => r.id);
    if (initialReceiptIds.length === 0) return;

    const receiptsWithIssuedInvoices = await db
      .select({ id: invoices.receiptId })
      .from(invoices)
      .where(and(inArray(invoices.receiptId, initialReceiptIds), eq(invoices.status, "issued")));
    const blockedByInvoice = new Set(receiptsWithIssuedInvoices.map((r) => r.id));

    const receiptsWithPaidTransfers = await db
      .select({ id: landlordTransfers.receiptId })
      .from(landlordTransfers)
      .where(
        and(
          inArray(landlordTransfers.receiptId, initialReceiptIds),
          inArray(landlordTransfers.status, ["paid", "reversed"])
        )
      );
    const blockedByTransfer = new Set(receiptsWithPaidTransfers.map((r) => r.id));

    const receiptsToDelete = initialReceiptIds.filter((id) => !blockedByInvoice.has(id) && !blockedByTransfer.has(id));
    if (receiptsToDelete.length === 0) return;

    await db.delete(invoices).where(inArray(invoices.receiptId, receiptsToDelete));
    await db.delete(landlordTransfers).where(inArray(landlordTransfers.receiptId, receiptsToDelete));
    await db.delete(cashTransactions).where(inArray(cashTransactions.receiptId, receiptsToDelete));
    await db.delete(receipts).where(inArray(receipts.id, receiptsToDelete));
  }

  async getLandlordTransfers(): Promise<LandlordTransfer[]> {
    return db.select().from(landlordTransfers).orderBy(desc(landlordTransfers.createdAt));
  }

  async getLandlordTransfer(id: string): Promise<LandlordTransfer | undefined> {
    const [transfer] = await db.select().from(landlordTransfers).where(eq(landlordTransfers.id, id));
    return transfer || undefined;
  }

  async getEnrichedLandlordTransfers(month?: number, year?: number): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
    let query = db
      .select({
        transfer: landlordTransfers,
        propertyName: properties.address,
        refMonth: receipts.refMonth,
        refYear: receipts.refYear,
      })
      .from(landlordTransfers)
      .innerJoin(receipts, eq(landlordTransfers.receiptId, receipts.id))
      .innerJoin(contracts, eq(receipts.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .$dynamic();

    if (month && year) {
      query = query.where(and(eq(receipts.refMonth, month), eq(receipts.refYear, year)));
    }

    const result = await query.orderBy(desc(landlordTransfers.createdAt));

    return result.map(r => ({
      ...r.transfer,
      propertyName: r.propertyName,
      refMonth: r.refMonth,
      refYear: r.refYear,
    }));
  }

  async getLandlordTransfersReport(year: number, month: number, type: "ref" | "paid"): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
    if (type === "ref") {
      // Join with receipts to filter by refYear and refMonth
      const result = await db
        .select({
          transfer: landlordTransfers,
          propertyName: properties.address,
          refMonth: receipts.refMonth,
          refYear: receipts.refYear,
        })
        .from(landlordTransfers)
        .innerJoin(receipts, eq(landlordTransfers.receiptId, receipts.id))
        .innerJoin(contracts, eq(receipts.contractId, contracts.id))
        .innerJoin(properties, eq(contracts.propertyId, properties.id))
        .where(and(eq(receipts.refYear, year), eq(receipts.refMonth, month)));
      
      return result.map(r => ({
        ...r.transfer,
        propertyName: r.propertyName,
        refMonth: r.refMonth,
        refYear: r.refYear,
      }));
    } else {
      // Filter by paidAt date
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      
      const result = await db
        .select({
          transfer: landlordTransfers,
          propertyName: properties.address,
          refMonth: receipts.refMonth,
          refYear: receipts.refYear,
        })
        .from(landlordTransfers)
        .innerJoin(receipts, eq(landlordTransfers.receiptId, receipts.id))
        .innerJoin(contracts, eq(receipts.contractId, contracts.id))
        .innerJoin(properties, eq(contracts.propertyId, properties.id))
        .where(and(
          gte(landlordTransfers.paidAt, startDate),
          lte(landlordTransfers.paidAt, endDate)
        ))
        .orderBy(desc(landlordTransfers.paidAt));

      return result.map(r => ({
        ...r.transfer,
        propertyName: r.propertyName,
        refMonth: r.refMonth,
        refYear: r.refYear,
      }));
    }
  }

  async getLandlordTransfersByPaymentPeriod(startDate: string, endDate: string, landlordId?: string): Promise<(LandlordTransfer & { propertyName: string; refMonth: number; refYear: number })[]> {
    const start = new Date(startDate + "T00:00:00.000Z");
    const end = new Date(endDate + "T23:59:59.999Z");
    const filters = [gte(landlordTransfers.paidAt, start), lte(landlordTransfers.paidAt, end)];
    if (landlordId) {
      filters.push(eq(landlordTransfers.landlordId, landlordId));
    }
    
    const result = await db
      .select({
        transfer: landlordTransfers,
        propertyName: properties.address,
        refMonth: receipts.refMonth,
        refYear: receipts.refYear,
      })
      .from(landlordTransfers)
      .innerJoin(receipts, eq(landlordTransfers.receiptId, receipts.id))
      .innerJoin(contracts, eq(receipts.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(and(...filters))
      .orderBy(desc(landlordTransfers.paidAt));

    return result.map(r => ({
      ...r.transfer,
      propertyName: r.propertyName,
      refMonth: r.refMonth,
      refYear: r.refYear,
    }));
  }

  async getRevenueReport(year: number, month: number): Promise<RevenueReportItem[]> {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;

    const result = await db
      .select({
        receiptId: receipts.id,
        propertyCode: properties.code,
        landlordName: landlords.name,
        tenantName: tenants.name,
        refYear: receipts.refYear,
        refMonth: receipts.refMonth,
        rentAmount: receipts.rentAmount,
        adminFeeAmount: receipts.adminFeeAmount,
        interestAmount: receipts.interestAmount,
        transferAmount: sql<string>`COALESCE((SELECT SUM(amount) FROM landlord_transfers lt WHERE lt.receipt_id = ${receipts.id}), ${receipts.landlordTotalDue})`,
        status: receipts.status,
      })
      .from(receipts)
      .leftJoin(contracts, eq(receipts.contractId, contracts.id))
      .leftJoin(properties, eq(contracts.propertyId, properties.id))
      .leftJoin(landlords, eq(contracts.landlordId, landlords.id))
      .leftJoin(tenants, eq(contracts.tenantId, tenants.id))
      .innerJoin(cashTransactions, eq(receipts.id, cashTransactions.receiptId))
      .where(
        and(
          eq(cashTransactions.type, "IN"),
          gte(cashTransactions.date, startDate),
          lte(cashTransactions.date, endDate),
          inArray(receipts.status, ["paid", "transferred"])
        )
      )
      .orderBy(properties.code);

    const uniqueMap = new Map();
    for (const row of result) {
      if (!uniqueMap.has(row.receiptId)) {
        uniqueMap.set(row.receiptId, row);
      }
    }

    return Array.from(uniqueMap.values()).map((row) => ({
      receiptId: row.receiptId,
      propertyCode: row.propertyCode ?? "",
      landlordName: row.landlordName ?? "",
      tenantName: row.tenantName ?? "",
      refYear: row.refYear,
      refMonth: row.refMonth,
      rentAmount: String(row.rentAmount),
      adminFeeAmount: String(row.adminFeeAmount),
      interestAmount: String(row.interestAmount || "0"),
      transferAmount: row.transferAmount != null ? String(row.transferAmount) : null,
      status: row.status,
    }));
  }

  async getInsuranceReport(startDate: string, endDate: string, statuses: ("paid" | "transferred" | "closed")[] = ["paid", "transferred"]): Promise<InsuranceReportItem[]> {
    const result = await db
      .select({
        receiptId: receipts.id,
        contractId: contracts.id,
        propertyCode: properties.code,
        landlordName: landlords.name,
        tenantName: tenants.name,
        refYear: receipts.refYear,
        refMonth: receipts.refMonth,
        insuranceValue: contracts.insuranceValue,
        status: receipts.status,
      })
      .from(receipts)
      .innerJoin(contracts, eq(receipts.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .innerJoin(landlords, eq(contracts.landlordId, landlords.id))
      .innerJoin(tenants, eq(contracts.tenantId, tenants.id))
      .innerJoin(cashTransactions, eq(receipts.id, cashTransactions.receiptId))
      .where(
        and(
          inArray(receipts.status, statuses),
          eq(contracts.guaranteeType, "insurance"),
          eq(cashTransactions.type, "IN"),
          gte(cashTransactions.date, startDate),
          lte(cashTransactions.date, endDate)
        )
      )
      .orderBy(properties.code);

    const uniqueMap = new Map();
    for (const row of result) {
      if (!uniqueMap.has(row.receiptId)) {
        uniqueMap.set(row.receiptId, {
          ...row,
          insuranceValue: String(row.insuranceValue ?? "0"),
        });
      }
    }

    return Array.from(uniqueMap.values());
  }

  async getLandlordTransfersByReceipt(receiptId: string): Promise<LandlordTransfer[]> {
    return db.select().from(landlordTransfers).where(eq(landlordTransfers.receiptId, receiptId));
  }

  async createLandlordTransfer(data: InsertLandlordTransfer): Promise<LandlordTransfer> {
    const [transfer] = await db.insert(landlordTransfers).values(data).returning();
    return transfer;
  }

  async updateLandlordTransfer(id: string, data: Partial<InsertLandlordTransfer>): Promise<LandlordTransfer | undefined> {
    const [transfer] = await db.update(landlordTransfers).set(data).where(eq(landlordTransfers.id, id)).returning();
    return transfer || undefined;
  }

  async deleteLandlordTransfer(id: string): Promise<void> {
    await db.delete(landlordTransfers).where(eq(landlordTransfers.id, id));
  }

  async getInvoices(): Promise<Invoice[]> {
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getPropertyTypeByInvoiceId(invoiceId: string): Promise<string | undefined> {
    const result = await db
      .select({ type: properties.type })
      .from(invoices)
      .innerJoin(receipts, eq(invoices.receiptId, receipts.id))
      .innerJoin(contracts, eq(receipts.contractId, contracts.id))
      .innerJoin(properties, eq(contracts.propertyId, properties.id))
      .where(eq(invoices.id, invoiceId));
      
    return result[0]?.type || undefined;
  }

  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const [invoice] = await db.insert(invoices).values(data).returning();
    return invoice;
  }

  async updateInvoice(id: string, data: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [invoice] = await db.update(invoices).set(data).where(eq(invoices.id, id)).returning();
    return invoice || undefined;
  }

  async deleteInvoice(id: string): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
  }

  // Financial Records (Expense Control)
  async getFinancialRecords(year: number, month: number): Promise<FinancialRecord[]> {
    return db
      .select()
      .from(financialRecords)
      .where(
        and(
          eq(financialRecords.refYear, year),
          eq(financialRecords.refMonth, month)
        )
      )
      .orderBy(desc(financialRecords.date), desc(financialRecords.createdAt));
  }

  async getFinancialRecord(id: string): Promise<FinancialRecord | undefined> {
    const [record] = await db.select().from(financialRecords).where(eq(financialRecords.id, id));
    return record || undefined;
  }

  async createFinancialRecord(data: InsertFinancialRecord): Promise<FinancialRecord> {
    const period = await this.getFinancialPeriod(data.refYear, data.refMonth);
    if (period && period.status === "CLOSED") {
      throw new Error("Período fechado. Não é possível criar registros.");
    }
    const [record] = await db.insert(financialRecords).values(data).returning();
    return record;
  }

  async updateFinancialRecord(id: string, data: Partial<InsertFinancialRecord>): Promise<FinancialRecord | undefined> {
    const existing = await this.getFinancialRecord(id);
    if (!existing) return undefined;

    // Check existing record's period
    const existingPeriod = await this.getFinancialPeriod(existing.refYear, existing.refMonth);
    if (existingPeriod && existingPeriod.status === "CLOSED") {
      throw new Error("Período de origem fechado. Não é possível editar registros.");
    }

    // Check target period if changing dates
    if (data.refYear && data.refMonth) {
      const targetPeriod = await this.getFinancialPeriod(data.refYear, data.refMonth);
      if (targetPeriod && targetPeriod.status === "CLOSED") {
        throw new Error("Período de destino fechado. Não é possível mover registros para este período.");
      }
    }

    const [record] = await db
      .update(financialRecords)
      .set(data)
      .where(eq(financialRecords.id, id))
      .returning();
    return record || undefined;
  }

  async deleteFinancialRecord(id: string): Promise<void> {
    const existing = await this.getFinancialRecord(id);
    if (existing) {
      const period = await this.getFinancialPeriod(existing.refYear, existing.refMonth);
      if (period && period.status === "CLOSED") {
        throw new Error("Período fechado. Não é possível excluir registros.");
      }
    }
    await db.delete(financialRecords).where(eq(financialRecords.id, id));
  }

  // Financial Periods
  async getFinancialPeriod(year: number, month: number): Promise<FinancialPeriod | undefined> {
    const [period] = await db
      .select()
      .from(financialPeriods)
      .where(and(eq(financialPeriods.year, year), eq(financialPeriods.month, month)));
    return period || undefined;
  }

  async toggleFinancialPeriod(year: number, month: number, status: string): Promise<FinancialPeriod> {
    const existing = await this.getFinancialPeriod(year, month);
    if (existing) {
      const [updated] = await db
        .update(financialPeriods)
        .set({ status })
        .where(eq(financialPeriods.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(financialPeriods)
        .values({ year, month, status })
        .returning();
      return created;
    }
  }

  async getFinancialRecordPreviousBalance(year: number, month: number): Promise<number> {
    // 1. Find the LATEST "BALANCE" record strictly before the target month
    const [latestBalance] = await db
      .select()
      .from(financialRecords)
      .where(
        and(
          eq(financialRecords.type, "BALANCE"),
          or(
            lt(financialRecords.refYear, year),
            and(
              eq(financialRecords.refYear, year),
              lt(financialRecords.refMonth, month)
            )
          )
        )
      )
      .orderBy(desc(financialRecords.refYear), desc(financialRecords.refMonth), desc(financialRecords.createdAt))
      .limit(1);

    let baseBalance = 0;
    let cutoffYear = 0;
    let cutoffMonth = 0;
    let cutoffId = "";

    if (latestBalance) {
      baseBalance = Number(latestBalance.amount);
      cutoffYear = latestBalance.refYear;
      cutoffMonth = latestBalance.refMonth;
      cutoffId = latestBalance.id;
    }

    // 2. Sum (IN - OUT) for all records AFTER the cutoff (inclusive of month, exclusive of ID) and BEFORE target
    const records = await db
      .select({
        id: financialRecords.id,
        type: financialRecords.type,
        amount: financialRecords.amount,
        refYear: financialRecords.refYear,
        refMonth: financialRecords.refMonth,
      })
      .from(financialRecords)
      .where(
        and(
          // Greater than or equal to cutoff
          or(
            gt(financialRecords.refYear, cutoffYear),
            and(
              eq(financialRecords.refYear, cutoffYear),
              gte(financialRecords.refMonth, cutoffMonth)
            )
          ),
          // Less than target
          or(
            lt(financialRecords.refYear, year),
            and(
              eq(financialRecords.refYear, year),
              lt(financialRecords.refMonth, month)
            )
          )
        )
      );

    const delta = records.reduce((sum, r) => {
      // Skip the checkpoint record itself if it appears (should be covered by ID check or type logic, 
      // but let's be explicit: we use baseBalance, so we don't add it again)
      if (r.id === cutoffId) return sum;
      
      // Also skip any other older BALANCE records that might have been picked up 
      // (though our query logic for 'latest' implies we only care about the latest one as base. 
      // Any other BALANCE in the same month would be either older (ignore) or newer (impossible as we picked latest).
      // Wait, if we picked latest, there are no newer ones. So any other BALANCE is older.
      // We should ignore older BALANCE records as they are superseded.)
      if (r.type === "BALANCE") return sum;

      const amount = Number(r.amount);
      if (r.type === "IN") return sum + amount;
      return sum - amount;
    }, 0);

    return baseBalance + delta;
  }

  // NFS-e methods
  async getNfseConfig(): Promise<NfseConfig | undefined> {
    const [config] = await db.select().from(nfseConfig).limit(1);
    return config || undefined;
  }

  async createNfseConfig(data: InsertNfseConfig): Promise<NfseConfig> {
    const [config] = await db.insert(nfseConfig).values(data).returning();
    return config;
  }

  async updateNfseConfig(id: string, data: Partial<InsertNfseConfig>): Promise<NfseConfig | undefined> {
    const [config] = await db.update(nfseConfig).set(data).where(eq(nfseConfig.id, id)).returning();
    return config || undefined;
  }

  async upsertNfseConfig(data: InsertNfseConfig): Promise<NfseConfig> {
    const existing = await this.getNfseConfig();
    if (existing) {
      const [config] = await db.update(nfseConfig).set(data).where(eq(nfseConfig.id, existing.id)).returning();
      return config;
    } else {
      return this.createNfseConfig(data);
    }
  }

  async createNfseLote(data: InsertNfseLote): Promise<NfseLote> {
    const [lote] = await db.insert(nfseLotes).values(data).returning();
    return lote;
  }

  async getNfseLote(id: string): Promise<NfseLote | undefined> {
    const [lote] = await db.select().from(nfseLotes).where(eq(nfseLotes.id, id));
    return lote || undefined;
  }

  async updateNfseLote(id: string, data: Partial<InsertNfseLote>): Promise<NfseLote | undefined> {
    const [lote] = await db.update(nfseLotes).set(data).where(eq(nfseLotes.id, id)).returning();
    return lote || undefined;
  }

  async createNfseEmissao(data: InsertNfseEmissao): Promise<NfseEmissao> {
    const [emissao] = await db.insert(nfseEmissoes).values(data).returning();
    return emissao;
  }

  async getNfseEmissoes(): Promise<NfseEmissao[]> {
    return db.select().from(nfseEmissoes).orderBy(desc(nfseEmissoes.createdAt));
  }

  async getNfseEmissao(id: string): Promise<NfseEmissao | undefined> {
    const [emissao] = await db.select().from(nfseEmissoes).where(eq(nfseEmissoes.id, id));
    return emissao || undefined;
  }

  async getNfseEmissoesByLote(loteId: string): Promise<NfseEmissao[]> {
    return db.select().from(nfseEmissoes).where(eq(nfseEmissoes.loteId, loteId)).orderBy(desc(nfseEmissoes.createdAt));
  }

  async updateNfseEmissao(id: string, data: NfseEmissaoUpdate): Promise<NfseEmissao | undefined> {
    const [emissao] = await db.update(nfseEmissoes).set(data).where(eq(nfseEmissoes.id, id)).returning();
    return emissao || undefined;
  }

  async getNfseEmissaoByIdempotency(key: string): Promise<NfseEmissao | undefined> {
    const [emissao] = await db.select().from(nfseEmissoes).where(eq(nfseEmissoes.idempotencyKey, key));
    return emissao || undefined;
  }

  async getPendingNfseEmissoes(): Promise<NfseEmissao[]> {
    return db.select().from(nfseEmissoes).where(
      and(
        inArray(nfseEmissoes.status, ['PENDENTE', 'FALHOU']),
        lt(nfseEmissoes.retryCount, 3)
      )
    );
  }

  // System Logs
  async createSystemLog(data: InsertSystemLog): Promise<SystemLog> {
    const [log] = await db.insert(systemLogs).values(data).returning();
    return log;
  }

  async getSystemLogs(limit: number = 100): Promise<SystemLog[]> {
    return db.select().from(systemLogs).orderBy(desc(systemLogs.timestamp)).limit(limit);
  }

  async clearSystemLogs(): Promise<void> {
    await db.delete(systemLogs);
  }
}

export const storage = new DatabaseStorage();
