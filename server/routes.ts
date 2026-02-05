import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import { pixProvider } from "./providers/MockPixProvider";
import { nfProvider } from "./providers/MockNfProvider";
import { nfseProvider } from "./providers/NfseNationalProvider";
import { sicoobProvider } from "./providers/SicoobProvider";
import { loginSchema } from "@shared/schema";
import { z } from "zod";

// Helper function to convert Digitable Line to Barcode
function digitableToBarcode(line: string): string | null {
  if (!line) return null;
  const d = line.replace(/\D/g, '');
  if (d.length !== 47) return null;
  const bank = d.substring(0, 3);
  const currency = d.substring(3, 4);
  const dv = d.substring(32, 33);
  const factor = d.substring(33, 37);
  const value = d.substring(37, 47);
  const freeField1 = d.substring(4, 9);
  const freeField2 = d.substring(10, 20);
  const freeField3 = d.substring(21, 31);
  return bank + currency + dv + factor + value + freeField1 + freeField2 + freeField3;
}

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  next();
};

// Helper to safely calculate Due Date (clamping to end of month)
function calculateReceiptDueDate(year: number, month: number, dueDay: number): string {
  // month is 1-12
  // Date constructor uses 0-11 for month
  const targetMonthIndex = month - 1;
  const date = new Date(year, targetMonthIndex, dueDay);
  
  // Check if month rolled over (e.g. Feb 30 -> Mar 2)
  if (date.getMonth() !== targetMonthIndex) {
    // Clamp to last day of the intended month
    const lastDayOfMonth = new Date(year, month, 0); // Day 0 of next month is last day of current
    return lastDayOfMonth.toISOString().split('T')[0];
  }
  
  return date.toISOString().split('T')[0];
}

async function seedAdminUser() {
  const existingAdmin = await storage.getUserByEmail("admin@admin.com");
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash("Admin@123", 10);
    await storage.createUser({
      name: "Administrador",
      email: "admin@admin.com",
      passwordHash,
      role: "admin",
    });
    console.log("Admin user created: admin@admin.com / Admin@123");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "imobiliaria-simples-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
      },
    })
  );

  await seedAdminUser();

  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ error: "Email ou senha inválidos" });
      }
      const validPassword = await bcrypt.compare(data.password, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: "Email ou senha inválidos" });
      }
      req.session.userId = user.id;
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Dados inválidos" });
      }
      console.error("Login error:", error);
      res.status(500).json({ error: "Erro interno" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const [contracts, properties, landlords, tenants, receipts, transfers] = await Promise.all([
        storage.getContracts(),
        storage.getProperties(),
        storage.getLandlords(),
        storage.getTenants(),
        storage.getReceipts(),
        storage.getLandlordTransfers(),
      ]);

      const activeContracts = contracts.filter((c) => c.status === "active");
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const openReceipts = receipts.filter((r) => r.refYear === currentYear && r.refMonth === currentMonth && r.status === "draft");
      const paidReceipts = receipts.filter((r) => r.refYear === currentYear && r.refMonth === currentMonth && (r.status === "paid" || r.status === "transferred"));
      const pendingPayments = receipts.filter((r) => r.status === "closed");
      const pendingTransfers = transfers.filter((t) => t.status === "pending");
      const monthlyRevenue = pendingPayments.reduce((sum, r) => sum + Number(r.tenantTotalDue), 0);

      res.json({
        activeContracts: activeContracts.length,
        totalProperties: properties.length,
        totalLandlords: landlords.length,
        totalTenants: tenants.length,
        openReceipts: openReceipts.length,
        paidReceipts: paidReceipts.length,
        pendingPayments: pendingPayments.length,
        pendingTransfers: pendingTransfers.length,
        monthlyRevenue: monthlyRevenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
      });
    } catch (error) {
      console.error("Dashboard stats error:", error);
      res.status(500).json({ error: "Erro ao buscar estatísticas" });
    }
  });

  app.get("/api/landlords", requireAuth, async (req, res) => {
    try {
      const landlords = await storage.getLandlords();
      res.json(landlords);
    } catch (error) {
      console.error("Get landlords error:", error);
      res.status(500).json({ error: "Erro ao buscar proprietários" });
    }
  });

  app.post("/api/landlords", requireAuth, async (req, res) => {
    try {
      const landlord = await storage.createLandlord(req.body);
      res.status(201).json(landlord);
    } catch (error) {
      console.error("Create landlord error:", error);
      res.status(500).json({ error: "Erro ao criar proprietário" });
    }
  });

  app.patch("/api/landlords/:id", requireAuth, async (req, res) => {
    try {
      const landlord = await storage.updateLandlord(req.params.id, req.body);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });
      res.json(landlord);
    } catch (error) {
      console.error("Update landlord error:", error);
      res.status(500).json({ error: "Erro ao atualizar proprietário" });
    }
  });

  app.delete("/api/landlords/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteLandlord(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete landlord error:", error);
      res.status(500).json({ error: "Erro ao excluir proprietário" });
    }
  });

  app.get("/api/tenants", requireAuth, async (req, res) => {
    try {
      const tenants = await storage.getTenants();
      res.json(tenants);
    } catch (error) {
      console.error("Get tenants error:", error);
      res.status(500).json({ error: "Erro ao buscar locatários" });
    }
  });

  app.post("/api/tenants", requireAuth, async (req, res) => {
    try {
      const tenant = await storage.createTenant(req.body);
      res.status(201).json(tenant);
    } catch (error) {
      console.error("Create tenant error:", error);
      res.status(500).json({ error: "Erro ao criar locatário" });
    }
  });

  app.patch("/api/tenants/:id", requireAuth, async (req, res) => {
    try {
      const tenant = await storage.updateTenant(req.params.id, req.body);
      if (!tenant) return res.status(404).json({ error: "Locatário não encontrado" });
      res.json(tenant);
    } catch (error) {
      console.error("Update tenant error:", error);
      res.status(500).json({ error: "Erro ao atualizar locatário" });
    }
  });

  app.delete("/api/tenants/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteTenant(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete tenant error:", error);
      res.status(500).json({ error: "Erro ao excluir locatário" });
    }
  });

  app.get("/api/guarantors", requireAuth, async (req, res) => {
    try {
      const guarantors = await storage.getGuarantors();
      res.json(guarantors);
    } catch (error) {
      console.error("Get guarantors error:", error);
      res.status(500).json({ error: "Erro ao buscar fiadores" });
    }
  });

  app.post("/api/guarantors", requireAuth, async (req, res) => {
    try {
      const guarantor = await storage.createGuarantor(req.body);
      res.status(201).json(guarantor);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido";
      console.error("Create guarantor error:", error);
      res.status(500).json({ error: `Erro ao criar fiador: ${message}` });
    }
  });

  app.patch("/api/guarantors/:id", requireAuth, async (req, res) => {
    try {
      const guarantor = await storage.updateGuarantor(req.params.id, req.body);
      if (!guarantor) return res.status(404).json({ error: "Fiador não encontrado" });
      res.json(guarantor);
    } catch (error) {
      console.error("Update guarantor error:", error);
      res.status(500).json({ error: "Erro ao atualizar fiador" });
    }
  });

  app.delete("/api/guarantors/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteGuarantor(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete guarantor error:", error);
      res.status(500).json({ error: "Erro ao excluir fiador" });
    }
  });

  app.get("/api/providers", requireAuth, async (req, res) => {
    try {
      const providers = await storage.getServiceProviders();
      res.json(providers);
    } catch (error) {
      console.error("Get providers error:", error);
      res.status(500).json({ error: "Erro ao buscar prestadores" });
    }
  });

  app.post("/api/providers", requireAuth, async (req, res) => {
    try {
      const provider = await storage.createServiceProvider(req.body);
      res.status(201).json(provider);
    } catch (error) {
      console.error("Create provider error:", error);
      res.status(500).json({ error: "Erro ao criar prestador" });
    }
  });

  app.patch("/api/providers/:id", requireAuth, async (req, res) => {
    try {
      const provider = await storage.updateServiceProvider(req.params.id, req.body);
      if (!provider) return res.status(404).json({ error: "Prestador não encontrado" });
      res.json(provider);
    } catch (error) {
      console.error("Update provider error:", error);
      res.status(500).json({ error: "Erro ao atualizar prestador" });
    }
  });

  app.delete("/api/providers/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteServiceProvider(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete provider error:", error);
      res.status(500).json({ error: "Erro ao excluir prestador" });
    }
  });

  app.get("/api/properties", requireAuth, async (req, res) => {
    try {
      const properties = await storage.getProperties();
      res.json(properties);
    } catch (error) {
      console.error("Get properties error:", error);
      res.status(500).json({ error: "Erro ao buscar imóveis" });
    }
  });

  app.post("/api/properties", requireAuth, async (req, res) => {
    try {
      const property = await storage.createProperty(req.body);
      res.status(201).json(property);
    } catch (error) {
      console.error("Create property error:", error);
      res.status(500).json({ error: "Erro ao criar imóvel" });
    }
  });

  app.patch("/api/properties/:id", requireAuth, async (req, res) => {
    try {
      const property = await storage.updateProperty(req.params.id, req.body);
      if (!property) return res.status(404).json({ error: "Imóvel não encontrado" });
      res.json(property);
    } catch (error) {
      console.error("Update property error:", error);
      res.status(500).json({ error: "Erro ao atualizar imóvel" });
    }
  });

  app.delete("/api/properties/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteProperty(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      if (error.code === '23503') {
        return res.status(400).json({ 
          error: "Não é possível excluir este imóvel pois existem registros vinculados a ele (contratos, etc)." 
        });
      }
      console.error("Delete property error:", error);
      console.error("Error code:", error.code); // Debug log
      res.status(500).json({ error: "Erro ao excluir imóvel" });
    }
  });

  app.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const contracts = await storage.getContracts();
      res.json(contracts);
    } catch (error) {
      console.error("Get contracts error:", error);
      res.status(500).json({ error: "Erro ao buscar contratos" });
    }
  });

  app.get("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const contract = await storage.getContract(req.params.id);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });
      res.json(contract);
    } catch (error) {
      console.error("Get contract error:", error);
      res.status(500).json({ error: "Erro ao buscar contrato" });
    }
  });

  app.post("/api/contracts", requireAuth, async (req, res) => {
    try {
      const contract = await storage.createContract(req.body);
      res.status(201).json(contract);
    } catch (error) {
      console.error("Create contract error:", error);
      res.status(500).json({ error: "Erro ao criar contrato" });
    }
  });

  app.patch("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const contract = await storage.updateContract(req.params.id, req.body);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });
      res.json(contract);
    } catch (error) {
      console.error("Update contract error:", error);
      res.status(500).json({ error: "Erro ao atualizar contrato" });
    }
  });

  app.delete("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteContract(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete contract error:", error);
      res.status(500).json({ error: "Erro ao excluir contrato" });
    }
  });

  app.delete("/api/contracts/:id/draft-receipts", requireAuth, async (req, res) => {
    try {
      await storage.deleteDraftReceiptsByContractId(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete draft receipts error:", error);
      res.status(500).json({ error: "Erro ao excluir recibos em rascunho" });
    }
  });

  app.get("/api/services", requireAuth, async (req, res) => {
    try {
      const services = await storage.getServices();
      res.json(services);
    } catch (error) {
      console.error("Get services error:", error);
      res.status(500).json({ error: "Erro ao buscar serviços" });
    }
  });

  app.post("/api/services", requireAuth, async (req, res) => {
    try {
      // Validar se o recibo já está fechado
      const { contractId, refYear, refMonth } = req.body;
      const receipt = await storage.getReceiptByContractAndRef(contractId, refYear, refMonth);
      
      if (receipt && receipt.status !== "draft") {
        return res.status(400).json({ error: "Não é possível adicionar serviços a um recibo fechado, pago ou repassado." });
      }

      const service = await storage.createService(req.body);
      res.status(201).json(service);
    } catch (error) {
      console.error("Create service error:", error);
      res.status(500).json({ error: "Erro ao criar serviço" });
    }
  });

  app.patch("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const existingService = await storage.getService(req.params.id);
      if (!existingService) return res.status(404).json({ error: "Serviço não encontrado" });

      // Validar se o recibo já está fechado
      const receipt = await storage.getReceiptByContractAndRef(
        existingService.contractId, 
        existingService.refYear, 
        existingService.refMonth
      );
      
      if (receipt && receipt.status !== "draft") {
        return res.status(400).json({ error: "Não é possível alterar serviços de um recibo fechado, pago ou repassado." });
      }

      const service = await storage.updateService(req.params.id, req.body);
      res.json(service);
    } catch (error) {
      console.error("Update service error:", error);
      res.status(500).json({ error: "Erro ao atualizar serviço" });
    }
  });

  app.delete("/api/services/:id", requireAuth, async (req, res) => {
    try {
      const existingService = await storage.getService(req.params.id);
      if (!existingService) return res.status(404).json({ error: "Serviço não encontrado" });

      // Validar se o recibo já está fechado
      const receipt = await storage.getReceiptByContractAndRef(
        existingService.contractId, 
        existingService.refYear, 
        existingService.refMonth
      );
      
      if (receipt && receipt.status !== "draft") {
        return res.status(400).json({ error: "Não é possível excluir serviços de um recibo fechado, pago ou repassado." });
      }

      await storage.deleteService(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete service error:", error);
      res.status(500).json({ error: "Erro ao excluir serviço" });
    }
  });

  app.get("/api/receipts", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const [receipts, transfers] = await Promise.all([
        storage.getReceiptsByRef(year, month),
        storage.getLandlordTransfersReport(year, month, "ref")
      ]);

      const transferReceiptIds = new Set(transfers.map(t => t.receiptId));

      // Buscar transações para determinar isPaid
      const receiptIds = receipts.map(r => r.id);
      const cashTransactions = await storage.getCashTransactionsByReceiptIds(receiptIds);
      const paidReceiptIds = new Set(
        cashTransactions
          .filter(t => t.type === "IN")
          .map(t => t.receiptId)
      );

      const enrichedReceipts = await Promise.all(receipts.map(async (receipt) => {
        // Encontra se existe repasse associado a este recibo
        const transfer = transfers.find(t => t.receiptId === receipt.id);
        const hasTransfer = !!transfer;

        const isPaid = receipt.status === "paid" || (receipt.id && paidReceiptIds.has(receipt.id));

        if (receipt.status === 'paid' || receipt.status === 'transferred') {
          return { 
            ...receipt, 
            outdated: false, 
            hasTransfer,
            transferStatus: transfer?.status,
            isPaid 
          };
        }

        const contractServices = await storage.getServicesByContractAndRef(
          receipt.contractId,
          receipt.refYear,
          receipt.refMonth
        );

        const servicesTenantTotal = contractServices
          .filter((s) => s.chargedTo === "TENANT")
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const servicesLandlordTotal = contractServices
          .filter((s) => s.chargedTo === "LANDLORD")
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const storedTenantTotal = Number(receipt.servicesTenantTotal || 0);
        const storedLandlordTotal = Number(receipt.servicesLandlordTotal || 0);

        const outdated =
          Math.abs(servicesTenantTotal - storedTenantTotal) > 0.01 ||
          Math.abs(servicesLandlordTotal - storedLandlordTotal) > 0.01;

        return { 
          ...receipt, 
          outdated, 
          hasTransfer,
          transferStatus: transfer?.status,
          isPaid 
        };
      }));

      res.json(enrichedReceipts);
    } catch (error) {
      console.error("Get receipts error:", error);
      res.status(500).json({ error: "Erro ao buscar recibos" });
    }
  });

  app.get("/api/receipts/:id", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      const transfers = await storage.getLandlordTransfersByReceipt(receipt.id);
      const transfer = transfers.length > 0 ? transfers[0] : null;

      const cashTransactions = await storage.getCashTransactionsByReceiptIds([receipt.id]);
      const isPaid = receipt.status === "paid" || cashTransactions.some(t => t.type === "IN");

      res.json({
        ...receipt,
        hasTransfer: !!transfer,
        transferStatus: transfer?.status,
        isPaid
      });
    } catch (error) {
      console.error("Get receipt error:", error);
      res.status(500).json({ error: "Erro ao buscar recibo" });
    }
  });

  app.post("/api/receipts/:id/slip", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      const tenant = await storage.getTenant(contract.tenantId);
      if (!tenant) return res.status(404).json({ error: "Locatário não encontrado" });

      // Calculate Due Date
      let dataVencimento: string;

      if (receipt.dueDate) {
        dataVencimento = String(receipt.dueDate);
      } else {
        dataVencimento = calculateReceiptDueDate(receipt.refYear, receipt.refMonth, contract.dueDay);
      }
      
      // Calculate Fine Date (Next day)
      const fineDate = new Date(dataVencimento);
      fineDate.setDate(fineDate.getDate() + 1);
      const dataMulta = fineDate.toISOString().split('T')[0];

      // Seu Numero - Unique ID (10 digits from timestamp)
      const seuNumero = Date.now().toString().slice(-10);

      // Clean Tenant Data
      const cleanDoc = tenant.doc.replace(/\D/g, '');
      const cleanZip = tenant.zipCode?.replace(/\D/g, '') || "";

      const payload = {
        numeroCliente: 2457024,
        codigoModalidade: 1,
        numeroContaCorrente: 775886,
        codigoEspecieDocumento: "DM",
        dataEmissao: new Date().toISOString().split('T')[0],
        seuNumero: seuNumero,
        identificacaoEmissaoBoleto: 1,
        identificacaoDistribuicaoBoleto: 1,
        valor: Number(receipt.tenantTotalDue),
        dataVencimento: dataVencimento,
        tipoDesconto: 0,
        tipoMulta: 2,
        dataMulta: dataMulta,
        valorMulta: 10, 
        tipoJurosMora: 2,
        dataJurosMora: dataMulta,
        valorJurosMora: 0.3, 
        numeroParcela: 1,
        aceite: true,
        pagador: {
          numeroCpfCnpj: cleanDoc,
          nome: tenant.name,
          endereco: tenant.address || "Endereço não informado",
          bairro: tenant.neighborhood || "Centro",
          cidade: tenant.city,
          cep: cleanZip,
          uf: tenant.state,
          email: tenant.email || "email@naoinformado.com"
        },
        beneficiarioFinal: {
          numeroCpfCnpj: "57431088000113",
          nome: "Imobiliária Simões"
        },
        mensagensInstrucao: [
          `A partir de ${dataMulta.split('-').reverse().join('/')} Juros 0,03%/dia.`,
          `A partir de ${dataMulta.split('-').reverse().join('/')} Multa de 10%`,
          "Não conceder desconto."
        ],
        gerarPdf: true,
        codigoCadastrarPIX: 0,
        numeroContratoCobranca: 0
      };

      const result = await sicoobProvider.emitirBoleto(payload);
      console.log("Sicoob Response Keys:", Object.keys(result));


      // Handle PDF
      let slipPdfUrl = "";
      if (result.pdfBoleto) {
        // Base64
        const buffer = Buffer.from(result.pdfBoleto, 'base64');
        const fileName = `boleto-${receipt.id}.pdf`;
        const publicDir = path.join(process.cwd(), 'client', 'public', 'boletos');
        
        // Ensure directory exists
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(publicDir, fileName), buffer);
        slipPdfUrl = `/boletos/${fileName}`;
      }

      // Update Receipt
      const digitableLine = result.resultado?.linhaDigitavel || result.linhaDigitavel;
      let barcode = result.resultado?.codigoBarra || result.codigoBarra;
      
      if (!barcode && digitableLine) {
        barcode = digitableToBarcode(digitableLine);
      }

      await storage.updateReceipt(receipt.id, {
        isSlipIssued: true,
        slipPdfUrl: slipPdfUrl,
        slipOurNumber: seuNumero,
        slipDigitableLine: digitableLine,
        slipBarcode: barcode,
      });

      res.json({ success: true, pdfUrl: slipPdfUrl, ...result });

    } catch (error: any) {
      console.error("Emitir boleto error:", error);
      res.status(500).json({ error: error.message || "Erro ao emitir boleto" });
    }
  });

  app.get("/api/receipts/:id/slip", requireAuth, async (req, res) => {
      // Just to return slip info if needed separately
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      res.json({ 
          isSlipIssued: receipt.isSlipIssued,
          slipPdfUrl: receipt.slipPdfUrl,
          slipOurNumber: receipt.slipOurNumber,
          slipDigitableLine: receipt.slipDigitableLine,
          slipBarcode: receipt.slipBarcode
      });
  });

  app.get("/api/receipts/:id/boleto-pdf", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (!receipt.slipDigitableLine) {
        return res.status(400).json({ error: "Boleto não possui linha digitável registrada" });
      }

      const result = await sicoobProvider.consultarSegundaVia(receipt.slipDigitableLine);
      
      // O PDF vem em base64 no campo resultado.pdfBoleto ou pdfBoleto (dependendo da resposta exata, verificar logica do emitir)
      // No emitir: result.pdfBoleto
      // No endpoint de segunda via: geralmente é o mesmo padrão
      const pdfBase64 = result.resultado?.pdfBoleto || result.pdfBoleto;

      if (!pdfBase64) {
        return res.status(500).json({ error: "PDF não retornado pela API do Sicoob" });
      }

      const buffer = Buffer.from(pdfBase64, 'base64');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=boleto-${receipt.id}.pdf`);
      res.send(buffer);

    } catch (error: any) {
      console.error("Get boleto PDF error:", error);
      res.status(500).json({ error: error.message || "Erro ao buscar PDF do boleto" });
    }
  });

  // Rota pública para visualizar o boleto (sem autenticação, usada para compartilhamento externo)
  app.get("/api/public/receipts/:id/boleto", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (!receipt.slipDigitableLine) {
        return res.status(400).json({ error: "Boleto não possui linha digitável registrada" });
      }

      // Consulta a segunda via no Sicoob
      const result = await sicoobProvider.consultarSegundaVia(receipt.slipDigitableLine);
      
      const pdfBase64 = result.resultado?.pdfBoleto || result.pdfBoleto;

      if (!pdfBase64) {
        return res.status(500).json({ error: "PDF não retornado pela API do Sicoob" });
      }

      const buffer = Buffer.from(pdfBase64, 'base64');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename=boleto-${receipt.id}.pdf`);
      res.send(buffer);

    } catch (error: any) {
      console.error("Get public boleto PDF error:", error);
      res.status(500).json({ error: error.message || "Erro ao buscar PDF do boleto" });
    }
  });

  app.post("/api/receipts/generate", requireAuth, async (req, res) => {
    try {
      const { year, month } = req.body;
      const activeContracts = await storage.getActiveContracts();
      const created: any[] = [];

      for (const contract of activeContracts) {
        const existingReceipt = await storage.getReceiptByContractAndRef(contract.id, year, month);
        if (existingReceipt) continue;

        // Auto-create Insurance Service if applicable
        if (contract.guaranteeType === 'insurance' && Number(contract.insuranceValue) > 0) {
          const currentServices = await storage.getServicesByContractAndRef(contract.id, year, month);
          const hasInsurance = currentServices.some(s => s.description === "Seguro Fiança");
          
          if (!hasInsurance) {
            await storage.createService({
              contractId: contract.id,
              refYear: year,
              refMonth: month,
              description: "Seguro Fiança",
              amount: String(contract.insuranceValue),
              chargedTo: "TENANT",
              passThrough: false
            });
          }
        }

        const contractServices = await storage.getServicesByContractAndRef(contract.id, year, month);
        const servicesTenantTotal = contractServices
          .filter((s) => s.chargedTo === "TENANT")
          .reduce((sum, s) => sum + Number(s.amount), 0);
        const servicesLandlordTotal = contractServices
          .filter((s) => s.chargedTo === "LANDLORD")
          .reduce((sum, s) => sum + Number(s.amount), 0);
        const servicesTenantPassThroughTotal = contractServices
          .filter((s) => s.chargedTo === "TENANT" && s.passThrough)
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const rentAmount = Number(contract.rentAmount);
        const adminFeePercent = Number(contract.adminFeePercent);
        const adminFeeAmount = (rentAmount * adminFeePercent) / 100;
        const tenantTotalDue = rentAmount + servicesTenantTotal;
        const landlordTotalDue = rentAmount - adminFeeAmount - servicesLandlordTotal + servicesTenantPassThroughTotal;
        const dueDate = calculateReceiptDueDate(year, month, contract.dueDay);

        const receipt = await storage.createReceipt({
          contractId: contract.id,
          refYear: year,
          refMonth: month,
          rentAmount: String(rentAmount),
          adminFeePercent: String(adminFeePercent),
          adminFeeAmount: String(adminFeeAmount),
          servicesTenantTotal: String(servicesTenantTotal),
          servicesLandlordTotal: String(servicesLandlordTotal),
          tenantTotalDue: String(tenantTotalDue),
          landlordTotalDue: String(landlordTotalDue),
          dueDate: dueDate,
          status: "draft",
        });
        created.push(receipt);
      }

      res.json({ created: created.length, receipts: created });
    } catch (error) {
      console.error("Generate receipts error:", error);
      res.status(500).json({ error: "Erro ao gerar recibos" });
    }
  });

  app.post("/api/receipts/:id/regenerate", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      if (receipt.status === "transferred" || receipt.status === "paid") {
        return res.status(400).json({ error: "Não é possível regerar um recibo pago ou repassado. Faça o estorno primeiro." });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      // Auto-create/Update Insurance Service if applicable
      if (contract.guaranteeType === 'insurance' && Number(contract.insuranceValue) > 0) {
        const currentServices = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
        const insuranceService = currentServices.find(s => s.description === "Seguro Fiança");
        
        if (insuranceService) {
           // Update amount if different
           if (Number(insuranceService.amount) !== Number(contract.insuranceValue)) {
             await storage.updateService(insuranceService.id, { amount: String(contract.insuranceValue) });
           }
        } else {
           // Create
           await storage.createService({
             contractId: contract.id,
             refYear: receipt.refYear,
             refMonth: receipt.refMonth,
             description: "Seguro Fiança",
             amount: String(contract.insuranceValue),
             chargedTo: "TENANT",
             passThrough: false
           });
        }
      }

      const contractServices = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
      const servicesTenantTotal = contractServices
        .filter((s) => s.chargedTo === "TENANT")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesLandlordTotal = contractServices
        .filter((s) => s.chargedTo === "LANDLORD")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesTenantPassThroughTotal = contractServices
        .filter((s) => s.chargedTo === "TENANT" && s.passThrough)
        .reduce((sum, s) => sum + Number(s.amount), 0);

      const rentAmount = Number(contract.rentAmount);
      const adminFeePercent = Number(contract.adminFeePercent);
      const adminFeeAmount = (rentAmount * adminFeePercent) / 100;
      const tenantTotalDue = rentAmount + servicesTenantTotal;
      const landlordTotalDue = rentAmount - adminFeeAmount - servicesLandlordTotal + servicesTenantPassThroughTotal;
      
      // Update due date only if not manually set (or always? Let's recalculate based on contract rules)
      const dueDate = calculateReceiptDueDate(receipt.refYear, receipt.refMonth, contract.dueDay);

      const updated = await storage.updateReceipt(receipt.id, {
        rentAmount: String(rentAmount),
        adminFeePercent: String(adminFeePercent),
        adminFeeAmount: String(adminFeeAmount),
        servicesTenantTotal: String(servicesTenantTotal),
        servicesLandlordTotal: String(servicesLandlordTotal),
        tenantTotalDue: String(tenantTotalDue),
        landlordTotalDue: String(landlordTotalDue),
        dueDate: dueDate,
        // Mantém o status atual (draft ou closed)
      });

      res.json(updated);
    } catch (error) {
      console.error("Regenerate receipt error:", error);
      res.status(500).json({ error: `Erro ao regerar recibo: ${(error as Error).message}` });
    }
  });

  // Rota para buscar serviços de um contrato específico em um mês/ano (usado nos detalhes do recibo)
  app.get("/api/contracts/:id/services/:year/:month", requireAuth, async (req, res) => {
    try {
      const services = await storage.getServicesByContractAndRef(
        req.params.id, 
        parseInt(req.params.year), 
        parseInt(req.params.month)
      );
      res.json(services);
    } catch (error) {
      console.error("Get contract services error:", error);
      res.status(500).json({ error: "Erro ao buscar serviços do contrato" });
    }
  });

  app.get("/api/reports/landlord-transfers", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const type = (req.query.type as "ref" | "paid") || "ref";
      
      const transfers = await storage.getLandlordTransfersReport(year, month, type);
      res.json(transfers);
    } catch (error) {
      console.error("Get landlord transfers report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de repasses" });
    }
  });

  app.get("/api/reports/revenue", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      
      const revenue = await storage.getRevenueReport(year, month);
      res.json(revenue);
    } catch (error) {
      console.error("Get revenue report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de receita" });
    }
  });

  app.post("/api/receipts/:id/close", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "draft") return res.status(400).json({ error: "Recibo não está em rascunho" });

      const updated = await storage.updateReceipt(req.params.id, { status: "closed" });
      res.json(updated);
    } catch (error) {
      console.error("Close receipt error:", error);
      res.status(500).json({ error: "Erro ao fechar recibo" });
    }
  });

  app.post("/api/receipts/:id/reopen", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Allow reopening ONLY 'closed' receipts. Paid or Transferred receipts must be reversed first.
      if (receipt.status !== "closed") {
        return res.status(400).json({ error: "Recibo deve estar APENAS Fechado para ser reaberto. Se estiver Pago ou Repassado, realize o estorno primeiro." });
      }

      // Check if any transfer exists (even if pending)
      const transfers = await storage.getLandlordTransfersByReceipt(receipt.id);
      if (transfers.length > 0) {
        return res.status(400).json({ error: "Não é possível reabrir um recibo com repasse gerado. Exclua o repasse primeiro." });
      }

      if (receipt.isInvoiceIssued) {
        return res.status(400).json({ error: "Não é possível reabrir recibo com nota fiscal emitida." });
      }
      
      if (receipt.isInvoiceGenerated && !receipt.isInvoiceCancelled) {
        return res.status(400).json({ error: "Exclua a nota fiscal gerada antes de reabrir o recibo." });
      }

      const updated = await storage.updateReceipt(req.params.id, { status: "draft" });
      res.json(updated);
    } catch (error) {
      console.error("Reopen receipt error:", error);
      res.status(500).json({ error: "Erro ao reabrir recibo" });
    }
  });

  app.post("/api/receipts/:id/reopen", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Allow reopening 'closed' or 'paid' receipts
      if (receipt.status !== "closed" && receipt.status !== "paid") {
        return res.status(400).json({ error: "Recibo deve estar fechado ou pago para ser reaberto." });
      }

      // If paid, check if transferred
      if (receipt.status === "paid") {
        const transfers = await storage.getLandlordTransfersByReceipt(receipt.id);
        const activeTransfer = transfers.find(t => t.status === "pending" || t.status === "processing" || t.status === "paid");
        
        if (activeTransfer) {
          return res.status(400).json({ error: "Não é possível reabrir um recibo com repasse ativo. Exclua o repasse primeiro." });
        }
      }

      if (receipt.isInvoiceIssued) {
        return res.status(400).json({ error: "Não é possível reabrir recibo com nota fiscal emitida." });
      }
      
      if (receipt.isInvoiceGenerated && !receipt.isInvoiceCancelled) {
        return res.status(400).json({ error: "Exclua a nota fiscal gerada antes de reabrir o recibo." });
      }

      // If status was paid, reverse payment (remove Cash IN)
      if (receipt.status === "paid") {
        await storage.deleteCashTransactionByReceiptAndType(receipt.id, "IN");
      }

      const updated = await storage.updateReceipt(req.params.id, { status: "draft" });
      res.json(updated);
    } catch (error) {
      console.error("Reopen receipt error:", error);
      res.status(500).json({ error: "Erro ao reabrir recibo" });
    }
  });

  app.post("/api/receipts/:id/emit-slip", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (receipt.isSlipIssued) {
        return res.status(400).json({ error: "Boleto já emitido para este recibo" });
      }

      // Permitir emitir boleto mesmo se pago/repassado (solicitação do usuário)
      // if (receipt.status === "paid" || receipt.status === "transferred") {
      //   return res.status(400).json({ error: "Recibo já pago ou repassado" });
      // }

      const updated = await storage.updateReceipt(receipt.id, {
        isSlipIssued: true,
      });

      res.json(updated);
    } catch (error) {
      console.error("Emit slip error:", error);
      res.status(500).json({ error: "Erro ao emitir boleto" });
    }
  });

  app.post("/api/receipts/:id/cancel-slip", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (!receipt.isSlipIssued) {
        return res.status(400).json({ error: "Boleto não foi emitido para este recibo" });
      }

      // Permitir cancelar boleto mesmo se pago/repassado (solicitação do usuário)
      // if (receipt.status === "paid" || receipt.status === "transferred") {
      //   return res.status(400).json({ error: "Não é possível cancelar boleto de recibo pago ou repassado" });
      // }

      const updated = await storage.updateReceipt(receipt.id, {
        isSlipIssued: false,
      });

      res.json(updated);
    } catch (error) {
      console.error("Cancel slip error:", error);
      res.status(500).json({ error: "Erro ao cancelar boleto" });
    }
  });

  app.post("/api/receipts/:id/mark-paid", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Permitir closed ou transferred
      if (receipt.status !== "closed" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo não está fechado ou repassado" });
      }

      // Se status é closed, muda para paid. Se é transferred, mantém transferred.
      const newStatus = receipt.status === "closed" ? "paid" : receipt.status;
      const updated = await storage.updateReceipt(req.params.id, { status: newStatus });

      await storage.createCashTransaction({
        type: "IN",
        date: new Date().toISOString().split("T")[0],
        category: "Aluguel",
        description: `Pagamento recibo ${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}`,
        amount: receipt.tenantTotalDue,
        receiptId: receipt.id,
      });

      res.json(updated);
    } catch (error) {
      console.error("Mark paid error:", error);
      res.status(500).json({ error: "Erro ao marcar como pago" });
    }
  });

  app.post("/api/receipts/:id/reverse-payment", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      
      // Permitir paid ou transferred (se tiver pagamento)
      if (receipt.status !== "paid" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo não está pago" });
      }

      // Se for paid, volta para closed. Se for transferred, mantém transferred (mas remove a transação IN).
      const newStatus = receipt.status === "paid" ? "closed" : receipt.status;
      
      const updated = await storage.updateReceipt(req.params.id, { status: newStatus });

      // Remover transação de entrada do caixa
      await storage.deleteCashTransactionByReceiptAndType(receipt.id, "IN");

      res.json(updated);
    } catch (error) {
      console.error("Reverse payment error:", error);
      res.status(500).json({ error: "Erro ao estornar pagamento" });
    }
  });

  app.post("/api/receipts/:id/create-transfer", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "paid" && receipt.status !== "closed") return res.status(400).json({ error: "Recibo deve estar fechado ou pago para gerar repasse" });

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      const transfer = await storage.createLandlordTransfer({
        landlordId: contract.landlordId,
        receiptId: receipt.id,
        amount: receipt.landlordTotalDue,
        status: "pending",
      });

      res.json(transfer);
    } catch (error) {
      console.error("Create transfer error:", error);
      res.status(500).json({ error: "Erro ao criar repasse" });
    }
  });

  app.post("/api/receipts/:id/create-invoice", requireAuth, async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "paid" && receipt.status !== "transferred") {
        return res.status(400).json({ error: "Recibo deve estar pago ou repassado para emitir NF" });
      }

      if (receipt.isInvoiceIssued) {
        return res.status(400).json({ error: "Nota fiscal já emitida para este recibo" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      const invoice = await storage.createInvoice({
        landlordId: contract.landlordId,
        receiptId: receipt.id,
        amount: receipt.adminFeeAmount,
        status: "draft",
      });

      await storage.updateReceipt(receipt.id, { 
        isInvoiceGenerated: true,
        isInvoiceIssued: false,
        isInvoiceCancelled: false 
      });

      res.json(invoice);
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Erro ao criar nota fiscal" });
    }
  });

  app.get("/api/cash", requireAuth, async (req, res) => {
    try {
      const transactions = await storage.getCashTransactions();
      res.json(transactions);
    } catch (error) {
      console.error("Get cash error:", error);
      res.status(500).json({ error: "Erro ao buscar transações" });
    }
  });

  app.post("/api/cash", requireAuth, async (req, res) => {
    try {
      const transaction = await storage.createCashTransaction(req.body);
      res.status(201).json(transaction);
    } catch (error) {
      console.error("Create cash error:", error);
      res.status(500).json({ error: "Erro ao criar transação" });
    }
  });

  app.patch("/api/cash/:id", requireAuth, async (req, res) => {
    try {
      const transaction = await storage.updateCashTransaction(req.params.id, req.body);
      if (!transaction) return res.status(404).json({ error: "Transação não encontrada" });
      res.json(transaction);
    } catch (error) {
      console.error("Update cash error:", error);
      res.status(500).json({ error: "Erro ao atualizar transação" });
    }
  });

  app.delete("/api/cash/:id", requireAuth, async (req, res) => {
    try {
      const transaction = await storage.getCashTransaction(req.params.id);
      if (!transaction) return res.status(404).json({ error: "Transação não encontrada" });

      if (transaction.receiptId) {
        return res.status(400).json({ 
          error: "Não é possível excluir manualmente uma transação vinculada a um recibo. Ela será excluída automaticamente se o pagamento do recibo for estornado." 
        });
      }

      await storage.deleteCashTransaction(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete cash error:", error);
      res.status(500).json({ error: "Erro ao excluir transação" });
    }
  });

  app.get("/api/transfers", requireAuth, async (req, res) => {
    try {
      const transfers = await storage.getLandlordTransfers();
      res.json(transfers);
    } catch (error) {
      console.error("Get transfers error:", error);
      res.status(500).json({ error: "Erro ao buscar repasses" });
    }
  });

  // --- Rotas NFS-e ---

  app.get("/api/nfse/config", requireAuth, async (req, res) => {
    try {
      const config = await storage.getNfseConfig();
      res.json(config || {});
    } catch (error) {
      console.error("Get NFS-e config error:", error);
      res.status(500).json({ error: "Erro ao buscar configuração NFS-e" });
    }
  });

  app.post("/api/nfse/config", requireAuth, async (req, res) => {
    try {
      const config = await storage.upsertNfseConfig(req.body);
      res.json(config);
    } catch (error) {
      console.error("Upsert NFS-e config error:", error);
      res.status(500).json({ error: "Erro ao salvar configuração NFS-e" });
    }
  });

  app.get("/api/nfse/emissoes", requireAuth, async (req, res) => {
    try {
      const emissoes = await storage.getNfseEmissoes();
      res.json(emissoes);
    } catch (error) {
      console.error("Get NFS-e emissoes error:", error);
      res.status(500).json({ error: "Erro ao buscar emissões NFS-e" });
    }
  });

  app.get("/api/nfse/emissoes/:id", requireAuth, async (req, res) => {
    try {
      const emissao = await storage.getNfseEmissao(req.params.id);
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      res.json(emissao);
    } catch (error) {
      console.error("Get NFS-e emissao error:", error);
      res.status(500).json({ error: "Erro ao buscar emissão NFS-e" });
    }
  });

  app.post("/api/nfse/lotes", requireAuth, async (req, res) => {
    try {
      const { itens } = req.body; // Array of items
      if (!Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ error: "Lista de itens inválida ou vazia" });
      }

      const config = await storage.getNfseConfig();
      if (!config) return res.status(400).json({ error: "NFS-e não configurada" });

      const crypto = await import('crypto');
      const loteItensToCreate: any[] = [];
      let valorTotalLote = 0;

      // 1. Validate and Prepare items
      for (const item of itens) {
         // Validação mais rigorosa
         if (!item.origemId || !item.origemTipo || !item.valor || !item.tomadorCpfCnpj || !item.tomadorNome) {
             console.error("Item inválido no lote (dados incompletos):", item);
             continue;
         }

         const valorNum = Number(item.valor);
         if (isNaN(valorNum)) {
             console.error("Item com valor não numérico:", item);
             continue;
         }

         const idempotencyKey = crypto.createHash('sha256')
            .update(`${config.id}-${item.origemId}-${item.valor}-${new Date().getMonth()}-${item.origemTipo}-LOTE`)
            .digest('hex');

         // Check for duplicates
         const existing = await storage.getNfseEmissaoByIdempotency(idempotencyKey);
         if (existing && (existing.status === 'EMITIDA' || existing.status === 'ENVIANDO')) {
            console.warn(`Skipping duplicate emission for ${item.origemId}`);
            continue; 
         }

         valorTotalLote += valorNum;
         const valorIssNum = valorNum * (Number(config.aliquotaIss) / 100);
         
         loteItensToCreate.push({
            ...item,
            idempotencyKey,
            valorServico: valorNum.toFixed(2),
            valorIss: valorIssNum.toFixed(2),
            baseCalculo: valorNum.toFixed(2)
         });
      }

      if (loteItensToCreate.length === 0) {
        return res.status(400).json({ error: "Nenhum item válido para emitir (possíveis duplicatas ou dados inválidos)" });
      }

      // 2. Create Lote
      console.log("Creating lote with status: CRIADO");
      const lote = await storage.createNfseLote({
        criadoPorUsuarioId: req.session.userId || null,
        qtdItens: loteItensToCreate.length,
        valorTotal: valorTotalLote.toFixed(2),
        status: "CRIADO"
      });

      // 3. Create Emissions linked to Lote
      const createdEmissions = [];
      const errors = [];
      
      for (const item of loteItensToCreate) {
        try {
            // Check if emission already exists for this idempotency key
            const existing = await storage.getNfseEmissaoByIdempotency(item.idempotencyKey);
            
            if (existing) {
                if (existing.status === 'EMITIDA' || existing.status === 'ENVIANDO') {
                    console.log(`Emissão ${existing.id} já processada. Ignorando.`);
                    createdEmissions.push(existing);
                    continue;
                }
                
                // Reuse existing emission, update loteId and status
                console.log(`Reusing existing emission ${existing.id} for new lote`);
                const updated = await storage.updateNfseEmissao(existing.id, {
                    loteId: lote.id,
                    status: "PENDENTE",
                    updatedAt: new Date()
                });
                if (updated) createdEmissions.push(updated);
            } else {
                // Create new
                const emissao = await storage.createNfseEmissao({
                  loteId: lote.id,
                  status: "PENDENTE",
                  idempotencyKey: item.idempotencyKey,
                  valorServico: item.valorServico,
                  valorIss: item.valorIss,
                  aliquotaIss: config.aliquotaIss,
                  baseCalculo: item.baseCalculo,
                  descricaoServico: item.discriminacao || config.descricaoServicoPadrao,
                  tomadorCpfCnpj: item.tomadorCpfCnpj,
                  tomadorNome: item.tomadorNome,
                  origemId: item.origemId,
                  origemTipo: item.origemTipo
                });
                createdEmissions.push(emissao);
            }
        } catch (err) {
            console.error("Erro ao criar emissão individual:", err, item);
            errors.push({ item, error: err instanceof Error ? err.message : String(err) });
        }
      }

      res.status(201).json({ lote, emissoes: createdEmissions, errors });
    } catch (error) {
      console.error("Create Batch NFS-e error:", error);
      if (error instanceof Error) {
          console.error("Stack trace:", error.stack);
      }
      res.status(500).json({ error: "Erro ao criar lote de NFS-e", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/nfse/emitir", requireAuth, async (req, res) => {
    try {
      // Espera receber dados para criar a emissão. 
      // Pode vir de um recibo (comissao) ou avulso.
      // Exemplo payload: { origemId: '...', origemTipo: 'COMISSAO', valor: 100, ... }
      
      const { origemId, origemTipo, valor, tomadorNome, tomadorCpfCnpj, discriminacao } = req.body;

      if (!origemId || !origemTipo || !valor) {
        return res.status(400).json({ error: "Dados incompletos para emissão" });
      }

      // Idempotência
      const config = await storage.getNfseConfig();
      if (!config) return res.status(400).json({ error: "NFS-e não configurada" });

      const crypto = await import('crypto');
      const idempotencyKey = crypto.createHash('sha256')
        .update(`${config.id}-${origemId}-${valor}-${new Date().getMonth()}-${origemTipo}`)
        .digest('hex');

      const existing = await storage.getNfseEmissaoByIdempotency(idempotencyKey);
      if (existing) {
         if (existing.status === 'EMITIDA' || existing.status === 'ENVIANDO') {
           return res.status(409).json({ error: "Nota já emitida ou em processamento", emissao: existing });
         }
         // Se falhou ou pendente, pode tentar de novo (retorna a existente para reprocessar)
         return res.json(existing);
      }

      // Criar Lote para esta emissão (requisito: um lote por clique/emissão ou agrupado)
      console.log("Creating single lote with status: CRIADO");
      const lote = await storage.createNfseLote({
        criadoPorUsuarioId: req.session.userId || null,
        qtdItens: 1,
        valorTotal: Number(valor).toFixed(2),
        status: "CRIADO"
      });

      // Criar nova emissão
      const emissao = await storage.createNfseEmissao({
        loteId: lote.id,
        status: "PENDENTE",
        idempotencyKey,
        valorServico: Number(valor).toFixed(2),
        valorIss: (Number(valor) * (Number(config.aliquotaIss) / 100)).toFixed(2),
        aliquotaIss: config.aliquotaIss,
        baseCalculo: Number(valor).toFixed(2),
        descricaoServico: discriminacao || config.descricaoServicoPadrao,
        tomadorCpfCnpj: tomadorCpfCnpj, 
        tomadorNome: tomadorNome,
        origemId,
        origemTipo
      });

      res.status(201).json(emissao);
    } catch (error) {
      console.error("Emitir NFS-e error:", error);
      res.status(500).json({ error: "Erro ao criar emissão NFS-e", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/nfse/lotes/:id", requireAuth, async (req, res) => {
    try {
      const loteId = req.params.id as string;
      const lote = await storage.getNfseLote(loteId);
      if (!lote) return res.status(404).json({ error: "Lote não encontrado" });
      
      const emissoes = await storage.getNfseEmissoesByLote(lote.id);
      res.json({ lote, emissoes });
    } catch (error) {
      console.error("Get Lote NFS-e error:", error);
      res.status(500).json({ error: "Erro ao buscar lote NFS-e" });
    }
  });

  app.get("/api/nfse/emissoes/:id", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      res.json(emissao);
    } catch (error) {
      console.error("Get Emissão NFS-e error:", error);
      res.status(500).json({ error: "Erro ao buscar emissão NFS-e" });
    }
  });



  app.post("/api/nfse/lotes/:id/processar", requireAuth, async (req, res) => {
    try {
      const loteId = req.params.id as string;
      const lote = await storage.getNfseLote(loteId);
      if (!lote) return res.status(404).json({ error: "Lote não encontrado" });
      
      const emissoes = await storage.getNfseEmissoesByLote(lote.id);
      const results = [];

      for (const emissao of emissoes) {
        if (emissao.status === "PENDENTE" || emissao.status === "FALHOU") {
          const result = await nfseProvider.emitirNfse(emissao.id);
          results.push({ id: emissao.id, result });
        }
      }

      res.json({ message: "Processamento iniciado", results });
    } catch (error) {
      console.error("Processar Lote NFS-e error:", error);
      res.status(500).json({ error: "Erro ao processar lote NFS-e" });
    }
  });

  app.post("/api/nfse/emissoes/:id/processar", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const result = await nfseProvider.emitirNfse(emissaoId);
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Processar NFS-e error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/nfse/emissoes/:id/cancelar", requireAuth, async (req, res) => {
    try {
      const { motivo } = req.body;
      if (!motivo) return res.status(400).json({ error: "Motivo é obrigatório" });

      const emissaoId = req.params.id as string;
      const result = await nfseProvider.cancelarNfse(emissaoId, motivo);
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error("Cancelar NFS-e error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/nfse/danfse/:chave", requireAuth, async (req, res) => {
    try {
      await nfseProvider.initialize();
      const url = nfseProvider.getDanfseUrl(req.params.chave);
      res.redirect(url);
    } catch (error: any) {
      console.error("Erro ao redirecionar DANFSe:", error);
      res.status(500).send("Erro ao gerar link do DANFSe");
    }
  });

  app.get("/api/nfse/emissoes/:id/xml", requireAuth, async (req, res) => {
    try {
      const xml = await nfseProvider.baixarXml(req.params.id);
      if (!xml) return res.status(404).json({ error: "XML não encontrado" });
      
      res.header("Content-Type", "application/xml");
      res.header("Content-Disposition", `attachment; filename=nfse-${req.params.id}.xml`);
      res.send(xml);
    } catch (error: any) {
      console.error("Download XML error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/transfers/:id/execute", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      
      // Permitir re-executar se estiver pendente ou com falha
      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ error: `Repasse não está pendente ou com falha (status atual: ${transfer.status})` });
      }

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = await storage.getReceipt(transfer.receiptId);

      const result = await pixProvider.createTransfer(
        landlord.pixKey || "",
        landlord.name,
        Number(transfer.amount),
        `Repasse aluguel ${receipt?.refMonth}/${receipt?.refYear}`
      );

      if (result.success) {
        await storage.updateLandlordTransfer(transfer.id, {
          status: "paid",
          paidAt: new Date(),
          providerTransferId: result.transferId,
        });

        if (receipt) {
          await storage.updateReceipt(receipt.id, { status: "transferred" });
        }

        await storage.createCashTransaction({
          type: "OUT",
          date: new Date().toISOString().split("T")[0],
          category: "Repasse ao Proprietário",
          description: `Repasse PIX para ${landlord.name}`,
          amount: transfer.amount,
          receiptId: transfer.receiptId,
        });

        res.json({ success: true, transferId: result.transferId });
      } else {
        await storage.updateLandlordTransfer(transfer.id, {
          status: "failed",
          errorMessage: result.error,
        });
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Execute transfer error:", error);
      res.status(500).json({ error: "Erro ao executar repasse" });
    }
  });

  app.post("/api/transfers/:id/manual", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      
      // Permitir registrar manualmente se estiver pendente ou com falha
      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ error: `Repasse não está pendente ou com falha (status atual: ${transfer.status})` });
      }

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = await storage.getReceipt(transfer.receiptId);

      // Atualiza status do repasse
      await storage.updateLandlordTransfer(transfer.id, {
        status: "paid",
        paidAt: new Date(),
        providerTransferId: "MANUAL-" + Date.now(), // ID fictício para controle
      });

      // Atualiza status do recibo
      if (receipt) {
        await storage.updateReceipt(receipt.id, { status: "transferred" });
      }

      // Cria lançamento no caixa
      await storage.createCashTransaction({
        type: "OUT",
        date: new Date().toISOString().split("T")[0],
        category: "Repasse ao Proprietário",
        description: `Repasse Manual para ${landlord.name}`,
        amount: transfer.amount,
        receiptId: transfer.receiptId,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Manual transfer error:", error);
      res.status(500).json({ error: "Erro ao registrar repasse manual" });
    }
  });

  app.post("/api/transfers/:id/reverse", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      if (transfer.status !== "paid") return res.status(400).json({ error: "Apenas repasses pagos podem ser estornados" });

      const landlord = await storage.getLandlord(transfer.landlordId);
      const receipt = await storage.getReceipt(transfer.receiptId);

      // 1. Reverte status do repasse para pendente (para permitir novo pagamento ou exclusão)
      await storage.updateLandlordTransfer(transfer.id, {
        status: "pending",
      });

      // 2. Reverte status do recibo para pago ou fechado (se existir)
      if (receipt) {
        // Verifica se existe pagamento do inquilino (transação IN)
        const cashTransactions = await storage.getCashTransactionsByReceiptIds([receipt.id]);
        const hasTenantPayment = cashTransactions.some(t => t.type === "IN");
        
        const newStatus = hasTenantPayment ? "paid" : "closed";
        await storage.updateReceipt(receipt.id, { status: newStatus });
        
        // 3. Remove o lançamento do caixa (OUT) vinculado ao recibo
        await storage.deleteCashTransactionByReceiptAndType(receipt.id, "OUT");
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Reverse transfer error:", error);
      res.status(500).json({ error: "Erro ao estornar repasse" });
    }
  });

  app.delete("/api/transfers/:id", requireAuth, async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });

      if (transfer.status !== "pending" && transfer.status !== "failed") {
        return res.status(400).json({ 
          error: "Apenas repasses pendentes ou com falha podem ser excluídos." 
        });
      }

      // Salva o ID do recibo antes de excluir
      const receiptId = transfer.receiptId;

      await storage.deleteLandlordTransfer(req.params.id);

      // Garante que o recibo volte para o status correto se estiver 'transferred'
      if (receiptId) {
        const receipt = await storage.getReceipt(receiptId);
        if (receipt && receipt.status === "transferred") {
           const cashTransactions = await storage.getCashTransactionsByReceiptIds([receiptId]);
           const hasTenantPayment = cashTransactions.some(t => t.type === "IN");
           const newStatus = hasTenantPayment ? "paid" : "closed";
           await storage.updateReceipt(receiptId, { status: newStatus });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete transfer error:", error);
      res.status(500).json({ error: "Erro ao excluir repasse" });
    }
  });

  app.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ error: "Erro ao buscar notas fiscais" });
    }
  });

  app.post("/api/invoices/:id/issue", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });
      if (invoice.status !== "draft") return res.status(400).json({ error: "Nota fiscal não está em rascunho" });

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const receipt = await storage.getReceipt(invoice.receiptId);

      const result = await nfProvider.emitInvoice(
        landlord.name,
        landlord.doc,
        Number(invoice.amount),
        `Aluguel ${receipt?.refMonth}/${receipt?.refYear}`
      );

      if (result.success) {
        await storage.updateInvoice(invoice.id, {
          status: "issued",
          providerInvoiceId: result.invoiceId,
          number: result.invoiceNumber,
        });
        await storage.updateReceipt(invoice.receiptId, { isInvoiceIssued: true });
        res.json({ success: true, invoiceNumber: result.invoiceNumber });
      } else {
        await storage.updateInvoice(invoice.id, {
          status: "error",
          errorMessage: result.error,
        });
        res.status(400).json({ error: result.error });
      }
    } catch (error) {
      console.error("Issue invoice error:", error);
      res.status(500).json({ error: "Erro ao emitir nota fiscal" });
    }
  });

  app.post("/api/invoices/:id/cancel", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });
      if (invoice.status !== "issued") return res.status(400).json({ error: "Apenas notas fiscais emitidas podem ser canceladas" });

      const result = await nfProvider.cancelInvoice(invoice.id, "Cancelamento solicitado pelo usuário");

      if (result.success) {
        await storage.updateInvoice(invoice.id, {
          status: "cancelled",
        });

        // Update receipt status to allow re-generation
        // Also set to draft if possible? No, let the user use "Reopen" if needed.
        // But we MUST ensure flags allow "Reopen" to work.
        await storage.updateReceipt(invoice.receiptId, {
          isInvoiceIssued: false,
          isInvoiceGenerated: false,
          isInvoiceCancelled: true
        });

        // Try to revert receipt to draft if it was just closed/paid?
        // User asked for a way to go back to draft.
        // If we cancel the invoice, we likely want to edit the receipt.
        // Let's check if we can safely revert to draft.
        const receipt = await storage.getReceipt(invoice.receiptId);
        if (receipt) {
             const transfers = await storage.getLandlordTransfersByReceipt(invoice.receiptId);
             const hasActiveTransfer = transfers.some(t => ['pending', 'processing', 'paid'].includes(t.status));
             
             if (!hasActiveTransfer) {
                 // Check if we should revert payment?
                 // If the invoice is cancelled, the payment might still be valid (tenant paid).
                 // But the user wants to "voltar o Recibo para rascunho".
                 // "Rascunho" means unpaid.
                 // So we probably shouldn't auto-revert to draft if it was paid.
                 // We will rely on the new "Reopen" route which handles this.
             }
        }

        res.json({ success: true });
      } else {
        res.status(400).json({ error: result.error || "Erro ao cancelar nota fiscal" });
      }
    } catch (error) {
      console.error("Cancel invoice error:", error);
      res.status(500).json({ error: "Erro ao cancelar nota fiscal" });
    }
  });

  app.get("/api/invoices/:id/xml", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });
      
      if (invoice.status !== "issued") {
        return res.status(400).json({ error: "XML disponível apenas para notas emitidas" });
      }

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const xmlContent = await nfProvider.generateXml(invoice.id, {
        number: invoice.number,
        amount: invoice.amount,
        customerName: landlord.name,
        customerDoc: landlord.doc
      });

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename=nf-${invoice.number || invoice.id}.xml`);
      res.send(xmlContent);
    } catch (error) {
      console.error("Get invoice XML error:", error);
      res.status(500).json({ error: "Erro ao gerar XML da nota fiscal" });
    }
  });

  app.delete("/api/invoices/:id", requireAuth, async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Nota fiscal não encontrada" });

      if (invoice.status === "issued") {
        return res.status(400).json({ error: "Não é possível excluir uma nota fiscal emitida. Cancele-a primeiro." });
      }

      // Delete the invoice
      await storage.deleteInvoice(req.params.id);

      // Revert receipt status
      await storage.updateReceipt(invoice.receiptId, { 
        isInvoiceGenerated: false, 
        isInvoiceIssued: false,
        isInvoiceCancelled: false 
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Delete invoice error:", error);
      res.status(500).json({ error: "Erro ao excluir nota fiscal" });
    }
  });

  app.get("/api/nfse/emissoes/:id/pdf", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao || !emissao.pdfUrl) return res.status(404).json({ error: "PDF não disponível" });
      
      res.redirect(emissao.pdfUrl);
    } catch (error) {
      console.error("Download PDF NFS-e error:", error);
      res.status(500).json({ error: "Erro ao baixar PDF" });
    }
  });

  return httpServer;
}
