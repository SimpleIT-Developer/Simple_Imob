import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, date, timestamp, pgEnum, uniqueIndex, index, boolean, json, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);
export const propertyStatusEnum = pgEnum("property_status", [
  "available",
  "documentation_in_progress",
  "inspection",
  "contract",
  "available_for_signature",
  "rented",
  "maintenance",
]);
export const contractStatusEnum = pgEnum("contract_status", ["active", "inactive", "terminated"]);
export const chargedToEnum = pgEnum("charged_to", ["TENANT", "LANDLORD", "NONE"]);
export const receiptDiscountToEnum = pgEnum("receipt_discount_to", ["TENANT", "LANDLORD", "BOTH"]);
export const receiptStatusEnum = pgEnum("receipt_status", ["draft", "closed", "paid", "transferred"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["IN", "OUT"]);
export const transferStatusEnum = pgEnum("transfer_status", ["pending", "paid", "failed", "reversed"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued", "error", "cancelled"]);
export const pixKeyTypeEnum = pgEnum("pix_key_type", ["cpf", "cnpj", "email", "phone", "random", "agencia_conta"]);
export const nfseStatusEnum = pgEnum("nfse_status", ["PENDENTE", "ENVIANDO", "EMITIDA", "FALHOU", "CANCELADA"]);
export const nfseLoteStatusEnum = pgEnum("nfse_lote_status", ["CRIADO", "VALIDADO", "PROCESSANDO", "FINALIZADO", "FINALIZADO_COM_FALHAS"]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").default("user").notNull(),
  twoFactorSecret: text("two_factor_secret"),
  isTwoFactorEnabled: boolean("is_two_factor_enabled").default(false).notNull(),
  permissions: json("permissions").$type<string[]>().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const landlords = pgTable("landlords", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").unique(), // Código (novo)
  name: text("name").notNull(), // Nome
  address: text("address"), // Endereço
  phone: text("phone"), // Telefone
  neighborhood: text("neighborhood"), // Bairro
  city: text("city"), // Cidade
  state: text("state"), // UF
  zipCode: text("zip_code"), // CEP
  doc: text("doc").notNull(), // CPF
  rg: text("rg"), // RG
  maritalStatus: text("marital_status"), // Estado Civil
  nationality: text("nationality"), // Naturalidade
  profession: text("profession"), // Profissão
  birthDate: text("birth_date"), // Data de Nascimento (armazenado como string para simplificar formato DD/MM/AAAA ou ISO)
  propertyCount: integer("property_count").default(0), // Quantidade de Imóveis
  bank: text("bank"), // Banco
  branch: text("branch"), // Agência
  account: text("account"), // Conta
  bankIspb: text("bank_ispb"), // Código ISPB do Banco
  accountType: text("account_type"), // Tipo de Conta (ex: CORRENTE, POUPANCA)
  pixKeyType: pixKeyTypeEnum("pix_key_type"), // Tipo Chave Pix
  pixKey: text("pix_key"), // Chave Pix
  email: text("email"),
  nfseEnabled: boolean("nfse_enabled").default(false).notNull(),
  nfseMunicipalRegistration: text("nfse_municipal_registration"),
  nfseMunicipioIbge: text("nfse_municipio_ibge"),
  nfseServiceItem: text("nfse_service_item"),
  nfseNationalTaxCode: text("nfse_national_tax_code"),
  nfseServiceDescription: text("nfse_service_description"),
  nfseIssRate: decimal("nfse_iss_rate", { precision: 5, scale: 2 }),
  nfseIbsCbsCst: text("nfse_ibs_cbs_cst"),
  nfseIbsCbsClassTrib: text("nfse_ibs_cbs_class_trib"),
  nfseIbsCbsIndOp: text("nfse_ibs_cbs_ind_op"),
  nfseOpSimpNac: text("nfse_op_simp_nac"),
  nfseEnvironment: text("nfse_environment"),
  nfseSeries: text("nfse_series"),
  nfseLastNumber: integer("nfse_last_number").default(0),
  nfseCertificateFileName: text("nfse_certificate_file_name"),
  nfseCertificatePassword: text("nfse_certificate_password"),
  nfseCertificatePfxBase64: text("nfse_certificate_pfx_base64"),
  nfseCertificateUpdatedAt: timestamp("nfse_certificate_updated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tenants = pgTable("tenants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").unique(), // Código
  name: text("name").notNull(), // Nome
  address: text("address"), // Endereço
  phone: text("phone"), // Telefone
  neighborhood: text("neighborhood"), // Bairro
  city: text("city"), // Cidade
  state: text("state"), // UF
  zipCode: text("zip_code"), // CEP
  doc: text("doc").notNull(), // CPF
  rg: text("rg"), // RG
  email: text("email"),
  maritalStatus: text("marital_status"), // Estado Civil
  profession: text("profession"), // Profissão
  birthDate: text("birth_date"), // Data de Nascimento
  class: text("class"), // Classe (ex: 01-BOM)
  pixKeyType: pixKeyTypeEnum("pix_key_type"), // Tipo Chave Pix
  pixKey: text("pix_key"), // Chave Pix
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const guarantors = pgTable("guarantors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").unique(),
  name: text("name").notNull(),
  address: text("address"),
  neighborhood: text("neighborhood"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  phone: text("phone"),
  doc: text("doc").notNull(),
  rg: text("rg"),
  email: text("email"),
  maritalStatus: text("marital_status"),
  profession: text("profession"),
  birthDate: text("birth_date"),
  class: text("class"),
  spouseName: text("spouse_name"),
  spouseDoc: text("spouse_doc"),
  spouseRg: text("spouse_rg"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const serviceProviders = pgTable("service_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  doc: text("doc"),
  email: text("email"),
  phone: text("phone"),
  serviceType: text("service_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const properties = pgTable("properties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  type: text("type"), // Tipo do imóvel
  saleRent: text("sale_rent"), // Aluguel/Venda
  address: text("address").notNull(),
  neighborhood: text("neighborhood"), // Bairro
  city: text("city").notNull(),
  state: text("state").notNull(),
  zipCode: text("zip_code"), // CEP
  rentDefault: decimal("rent_default", { precision: 10, scale: 2 }).notNull(),
  landlordId: varchar("landlord_id").references(() => landlords.id),
  landlordShares: json("landlord_shares")
    .$type<Array<{ landlordId: string; percent: number }>>()
    .default([])
    .notNull(),
  status: propertyStatusEnum("status").default("available").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: varchar("property_id").references(() => properties.id).notNull(),
  landlordId: varchar("landlord_id").references(() => landlords.id).notNull(),
  tenantId: varchar("tenant_id").references(() => tenants.id).notNull(),
  guarantorId: varchar("guarantor_id").references(() => guarantors.id),
  guaranteeType: text("guarantee_type").default("guarantor"), // guarantor, insurance, deposit, none
  insuranceValue: decimal("insurance_value", { precision: 10, scale: 2 }), // Valor do Seguro Fiança
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  firstDueDate: date("first_due_date"),
  dueDay: integer("due_day").notNull(),
  rentAmount: decimal("rent_amount", { precision: 10, scale: 2 }).notNull(),
  adminFeePercent: decimal("admin_fee_percent", { precision: 5, scale: 2 }).notNull(),
  status: contractStatusEnum("status").default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contractRecurringItems = pgTable("contract_recurring_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").references(() => contracts.id).notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  chargedTo: chargedToEnum("charged_to").notNull(),
  discountFrom: chargedToEnum("discount_from"),
  passThrough: boolean("pass_through").default(false).notNull(), // Added to match services
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").references(() => contracts.id).notNull(),
  providerId: varchar("provider_id").references(() => serviceProviders.id),
  refYear: integer("ref_year").notNull(),
  refMonth: integer("ref_month").notNull(),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  chargedTo: chargedToEnum("charged_to").notNull(),
  discountFrom: chargedToEnum("discount_from"),
  receiptDiscountTo: receiptDiscountToEnum("receipt_discount_to"),
  passThrough: boolean("pass_through").default(false).notNull(),
  isTribute: boolean("is_tribute").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  contractRefIdx: index("services_contract_ref_idx").on(table.contractId, table.refYear, table.refMonth),
}));

export const receipts = pgTable("receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  contractId: varchar("contract_id").references(() => contracts.id).notNull(),
  refYear: integer("ref_year").notNull(),
  refMonth: integer("ref_month").notNull(),
  rentAmount: decimal("rent_amount", { precision: 10, scale: 2 }).notNull(),
  adminFeePercent: decimal("admin_fee_percent", { precision: 5, scale: 2 }).notNull(),
  adminFeeAmount: decimal("admin_fee_amount", { precision: 10, scale: 2 }).notNull(),
  servicesTenantTotal: decimal("services_tenant_total", { precision: 10, scale: 2 }).default("0").notNull(),
  servicesLandlordTotal: decimal("services_landlord_total", { precision: 10, scale: 2 }).default("0").notNull(),
  tenantTotalDue: decimal("tenant_total_due", { precision: 10, scale: 2 }).notNull(),
  landlordTotalDue: decimal("landlord_total_due", { precision: 10, scale: 2 }).notNull(),
  dueDate: date("due_date"), // Data de Vencimento
  status: receiptStatusEnum("status").default("draft").notNull(),
  isInvoiceGenerated: boolean("is_invoice_generated").default(false).notNull(),
  isInvoiceIssued: boolean("is_invoice_issued").default(false).notNull(),
  isInvoiceCancelled: boolean("is_invoice_cancelled").default(false).notNull(),
  isSlipIssued: boolean("is_slip_issued").default(false).notNull(),
  slipPdfUrl: text("slip_pdf_url"),
  slipOurNumber: text("slip_our_number"),
  slipDigitableLine: text("slip_digitable_line"),
  slipBarcode: text("slip_barcode"),
  interestAmount: decimal("interest_amount", { precision: 10, scale: 2 }).default("0").notNull(),
  landlordSplitOverride: json("landlord_split_override").$type<Array<{ landlordId: string; amount: number }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  contractRefUnique: uniqueIndex("receipts_contract_ref_unique").on(table.contractId, table.refYear, table.refMonth),
}));

export const cashTransactions = pgTable("cash_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: transactionTypeEnum("type").notNull(),
  date: date("date").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  receiptId: varchar("receipt_id").references(() => receipts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  receiptIdx: index("cash_transactions_receipt_idx").on(table.receiptId),
}));

export const landlordTransfers = pgTable("landlord_transfers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  landlordId: varchar("landlord_id").references(() => landlords.id).notNull(),
  receiptId: varchar("receipt_id").references(() => receipts.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: transferStatusEnum("status").default("pending").notNull(),
  paymentMethod: text("payment_method"), // "pix" or "manual"
  paidAt: timestamp("paid_at"),
  providerTransferId: text("provider_transfer_id"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  landlordId: varchar("landlord_id").references(() => landlords.id).notNull(),
  receiptId: varchar("receipt_id").references(() => receipts.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  invoiceCategory: text("invoice_category").default("ADMINISTRACAO").notNull(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  providerInvoiceId: text("provider_invoice_id"),
  number: text("number"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const propertiesRelations = relations(properties, ({ one }) => ({
  landlord: one(landlords, {
    fields: [properties.landlordId],
    references: [landlords.id],
  }),
}));

export const contractsRelations = relations(contracts, ({ one }) => ({
  property: one(properties, {
    fields: [contracts.propertyId],
    references: [properties.id],
  }),
  landlord: one(landlords, {
    fields: [contracts.landlordId],
    references: [landlords.id],
  }),
  tenant: one(tenants, {
    fields: [contracts.tenantId],
    references: [tenants.id],
  }),
  guarantor: one(guarantors, {
    fields: [contracts.guarantorId],
    references: [guarantors.id],
  }),
}));

export const servicesRelations = relations(services, ({ one }) => ({
  contract: one(contracts, {
    fields: [services.contractId],
    references: [contracts.id],
  }),
  provider: one(serviceProviders, {
    fields: [services.providerId],
    references: [serviceProviders.id],
  }),
}));

export const receiptsRelations = relations(receipts, ({ one }) => ({
  contract: one(contracts, {
    fields: [receipts.contractId],
    references: [contracts.id],
  }),
}));

export const cashTransactionsRelations = relations(cashTransactions, ({ one }) => ({
  receipt: one(receipts, {
    fields: [cashTransactions.receiptId],
    references: [receipts.id],
  }),
}));

export const landlordTransfersRelations = relations(landlordTransfers, ({ one }) => ({
  landlord: one(landlords, {
    fields: [landlordTransfers.landlordId],
    references: [landlords.id],
  }),
  receipt: one(receipts, {
    fields: [landlordTransfers.receiptId],
    references: [receipts.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  landlord: one(landlords, {
    fields: [invoices.landlordId],
    references: [landlords.id],
  }),
  receipt: one(receipts, {
    fields: [invoices.receiptId],
    references: [receipts.id],
  }),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertLandlordSchema = createInsertSchema(landlords).omit({ id: true, createdAt: true });
export const insertTenantSchema = createInsertSchema(tenants).omit({ id: true, createdAt: true });
export const insertGuarantorSchema = createInsertSchema(guarantors).omit({ id: true, createdAt: true });
export const insertServiceProviderSchema = createInsertSchema(serviceProviders).omit({ id: true, createdAt: true });
export const nfseConfig = pgTable("nfse_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  cnpjPrestador: text("cnpj_prestador").notNull(),
  inscricaoMunicipal: text("inscricao_municipal").notNull(),
  codigoMunicipioIbge: text("codigo_municipio_ibge").notNull(),
  regimeTributario: text("regime_tributario"),
  itemServico: text("item_servico").notNull(),
  cnae: text("cnae"),
  descricaoServicoPadrao: text("descricao_servico_padrao").notNull(),
  aliquotaIss: decimal("aliquota_iss", { precision: 5, scale: 2 }).notNull(),
  issRetido: boolean("iss_retido").default(false).notNull(),
  ambiente: text("ambiente").default("homologacao").notNull(),
  certificadoSenha: text("certificado_senha"),
  ultimoNumeroNfse: integer("ultimo_numero_nfse").default(0).notNull(),
  serieNfse: text("serie_nfse").default("900").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const nfseLotes = pgTable("nfse_lotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  criadoPorUsuarioId: varchar("criado_por_usuario_id").references(() => users.id),
  qtdItens: integer("qtd_itens").notNull().default(0),
  valorTotal: decimal("valor_total", { precision: 10, scale: 2 }).notNull().default("0"),
  status: nfseLoteStatusEnum("status").default("CRIADO").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const nfseEmissoes = pgTable("nfse_emissoes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loteId: varchar("lote_id").references(() => nfseLotes.id),
  origemTipo: text("origem_tipo").notNull(), // ex: "COMISSAO"
  origemId: varchar("origem_id").notNull(),
  tomadorNome: text("tomador_nome").notNull(),
  tomadorCpfCnpj: text("tomador_cpf_cnpj").notNull(),
  tomadorEmail: text("tomador_email"),
  tomadorEnderecoJson: text("tomador_endereco_json"), // JSON stringified
  imovelEnderecoJson: text("imovel_endereco_json"), // JSON stringified - endereço do imóvel para IBSCBS (grupo <imovel>)
  valorServico: decimal("valor_servico", { precision: 10, scale: 2 }).notNull(),
  baseCalculo: decimal("base_calculo", { precision: 10, scale: 2 }).notNull(),
  aliquotaIss: decimal("aliquota_iss", { precision: 5, scale: 2 }).notNull(),
  valorIss: decimal("valor_iss", { precision: 10, scale: 2 }).notNull(),
  descricaoServico: text("descricao_servico").notNull(),
  status: nfseStatusEnum("status").default("PENDENTE").notNull(),
  idempotencyKey: text("idempotency_key").unique(),
  apiRequestRaw: text("api_request_raw"),
  apiResponseRaw: text("api_response_raw"),
  numeroNfse: text("numero_nfse"),
  codigoVerificacao: text("codigo_verificacao"),
  chaveAcesso: text("chave_acesso"),
  xmlUrl: text("xml_url"),
  pdfUrl: text("pdf_url"),
  erroCodigo: text("erro_codigo"),
  erroMensagem: text("erro_mensagem"),
  retryCount: integer("retry_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const systemLogs = pgTable("system_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  level: text("level").notNull(), // INFO, ERROR, WARN
  category: text("category").notNull(), // NFSE, SYSTEM, API
  message: text("message").notNull(),
  details: text("details"), // JSON stringified
  correlationId: text("correlation_id"),
});

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: varchar("user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id").notNull(),
  entityLabel: text("entity_label"),
  fieldName: text("field_name"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  route: text("route"),
  requestIp: text("request_ip"),
}, (table) => ({
  userFk: foreignKey({
    columns: [table.userId],
    foreignColumns: [users.id],
    name: "audit_logs_user_id_fkey",
  }).onDelete("set null"),
  entityIdx: index("audit_logs_entity_idx").on(table.entityType, table.entityId, table.timestamp),
  userIdx: index("audit_logs_user_idx").on(table.userId, table.timestamp),
  timestampIdx: index("audit_logs_timestamp_idx").on(table.timestamp),
}));

export const pixTransferAttempts = pgTable("pix_transfer_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transferId: varchar("transfer_id").notNull(),
  receiptId: varchar("receipt_id"),
  contractId: varchar("contract_id"),
  propertyId: varchar("property_id"),
  landlordId: varchar("landlord_id"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  pixKey: text("pix_key").notNull(),
  pixKeyType: text("pix_key_type"),
  bankApi: text("bank_api").notNull(),
  requestId: text("request_id").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  status: text("status").notNull(),
  reference: text("reference"),
  payloadSent: text("payload_sent"),
  responseReceived: text("response_received"),
  errorMessage: text("error_message"),
  providerTransferId: text("provider_transfer_id"),
  providerStatus: text("provider_status"),
  requestSentAt: timestamp("request_sent_at"),
  responseReceivedAt: timestamp("response_received_at"),
  createdByUserId: varchar("created_by_user_id"),
  requestIp: text("request_ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  transferFk: foreignKey({
    columns: [table.transferId],
    foreignColumns: [landlordTransfers.id],
    name: "pix_transfer_attempts_transfer_id_fkey",
  }).onDelete("cascade"),
  receiptFk: foreignKey({
    columns: [table.receiptId],
    foreignColumns: [receipts.id],
    name: "pix_transfer_attempts_receipt_id_fkey",
  }).onDelete("set null"),
  contractFk: foreignKey({
    columns: [table.contractId],
    foreignColumns: [contracts.id],
    name: "pix_transfer_attempts_contract_id_fkey",
  }).onDelete("set null"),
  propertyFk: foreignKey({
    columns: [table.propertyId],
    foreignColumns: [properties.id],
    name: "pix_transfer_attempts_property_id_fkey",
  }).onDelete("set null"),
  landlordFk: foreignKey({
    columns: [table.landlordId],
    foreignColumns: [landlords.id],
    name: "pix_transfer_attempts_landlord_id_fkey",
  }).onDelete("set null"),
  createdByUserFk: foreignKey({
    columns: [table.createdByUserId],
    foreignColumns: [users.id],
    name: "pix_transfer_attempts_created_by_user_id_fkey",
  }).onDelete("set null"),
  requestIdIdx: uniqueIndex("pix_transfer_attempts_request_id_uidx").on(table.requestId),
  transferIdx: index("pix_transfer_attempts_transfer_idx").on(table.transferId, table.createdAt),
  providerTransferIdx: index("pix_transfer_attempts_provider_transfer_idx").on(table.providerTransferId),
  dedupeBlockingIdx: uniqueIndex("pix_transfer_attempts_dedupe_blocking_uidx")
    .on(table.dedupeKey)
    .where(sql`${table.status} IN ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'CONFIRMADO', 'ERRO_CONFIRMAR')`),
  transferBlockingIdx: uniqueIndex("pix_transfer_attempts_transfer_blocking_uidx")
    .on(table.transferId)
    .where(sql`${table.status} IN ('PENDENTE', 'ENVIANDO', 'ENVIADO', 'CONFIRMADO', 'ERRO_CONFIRMAR')`),
}));

export const financialRecords = pgTable("financial_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: date("date").notNull(),
  type: text("type").notNull(), // 'IN' | 'OUT'
  category: text("category").notNull(), // 'PRIVATE' | 'CORPORATE'
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  refMonth: integer("ref_month").notNull(),
  refYear: integer("ref_year").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const financialPeriods = pgTable("financial_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  status: text("status").notNull().default("OPEN"), // 'OPEN' | 'CLOSED'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relationships
export const nfseEmissoesRelations = relations(nfseEmissoes, ({ one }) => ({
  lote: one(nfseLotes, {
    fields: [nfseEmissoes.loteId],
    references: [nfseLotes.id],
  }),
}));

export const nfseLotesRelations = relations(nfseLotes, ({ many }) => ({
  emissoes: many(nfseEmissoes),
}));

export const insertNfseConfigSchema = createInsertSchema(nfseConfig).omit({ id: true, updatedAt: true });
export const insertNfseLoteSchema = createInsertSchema(nfseLotes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertNfseEmissaoSchema = createInsertSchema(nfseEmissoes).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPixTransferAttemptSchema = createInsertSchema(pixTransferAttempts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFinancialRecordSchema = createInsertSchema(financialRecords).omit({ id: true, createdAt: true });
export const insertFinancialPeriodSchema = createInsertSchema(financialPeriods).omit({ id: true, createdAt: true });

export type InsertNfseConfig = z.infer<typeof insertNfseConfigSchema>;
export type NfseConfig = typeof nfseConfig.$inferSelect;
export type InsertNfseLote = z.infer<typeof insertNfseLoteSchema>;
export type NfseLote = typeof nfseLotes.$inferSelect;
export type InsertNfseEmissao = z.infer<typeof insertNfseEmissaoSchema>;
export type NfseEmissao = typeof nfseEmissoes.$inferSelect;
export type InsertPixTransferAttempt = z.infer<typeof insertPixTransferAttemptSchema>;
export type PixTransferAttempt = typeof pixTransferAttempts.$inferSelect;
export type InsertFinancialRecord = z.infer<typeof insertFinancialRecordSchema>;
export type FinancialRecord = typeof financialRecords.$inferSelect;
export type InsertFinancialPeriod = z.infer<typeof insertFinancialPeriodSchema>;
export type FinancialPeriod = typeof financialPeriods.$inferSelect;

export const insertSystemLogSchema = createInsertSchema(systemLogs).omit({ id: true, timestamp: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, timestamp: true });
export type InsertSystemLog = z.infer<typeof insertSystemLogSchema>;
export type SystemLog = typeof systemLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const insertPropertySchema = createInsertSchema(properties).omit({ id: true, createdAt: true });
export const insertContractSchema = createInsertSchema(contracts).omit({ id: true, createdAt: true });
export const insertContractRecurringItemSchema = createInsertSchema(contractRecurringItems).omit({ id: true, createdAt: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true, createdAt: true });
export const insertReceiptSchema = createInsertSchema(receipts).omit({ id: true, createdAt: true });
export const insertCashTransactionSchema = createInsertSchema(cashTransactions).omit({ id: true, createdAt: true });
export const insertLandlordTransferSchema = createInsertSchema(landlordTransfers).omit({ id: true, createdAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertLandlord = z.infer<typeof insertLandlordSchema>;
export type Landlord = typeof landlords.$inferSelect;
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenants.$inferSelect;
export type InsertGuarantor = z.infer<typeof insertGuarantorSchema>;
export type Guarantor = typeof guarantors.$inferSelect;
export type InsertServiceProvider = z.infer<typeof insertServiceProviderSchema>;
export type ServiceProvider = typeof serviceProviders.$inferSelect;
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof properties.$inferSelect;
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contracts.$inferSelect;
export type InsertContractRecurringItem = z.infer<typeof insertContractRecurringItemSchema>;
export type ContractRecurringItem = typeof contractRecurringItems.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;
export type Receipt = typeof receipts.$inferSelect;
export type InsertCashTransaction = z.infer<typeof insertCashTransactionSchema>;
export type CashTransaction = typeof cashTransactions.$inferSelect;
export type InsertLandlordTransfer = z.infer<typeof insertLandlordTransferSchema>;
export type LandlordTransfer = typeof landlordTransfers.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginInput = z.infer<typeof loginSchema>;
