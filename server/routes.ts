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
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import axios from "axios";

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

const requirePermission = (permission: string) => async (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  
  try {
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }
    
    if (user.role === 'admin') {
      return next();
    }

    const userPermissions = (user.permissions as string[]) || [];
    if (!userPermissions.includes(permission)) {
      return res.status(403).json({ error: "Acesso negado: permissão insuficiente" });
    }
    
    next();
  } catch (error) {
    console.error("Permission check error:", error);
    res.status(500).json({ error: "Erro ao verificar permissões" });
  }
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

// Helper to normalize data (uppercase strings, lowercase emails)
function normalizeInputData(data: any) {
  if (!data || typeof data !== 'object') return data;
  
  const newData = { ...data };
  
  // Fields to always lowercase
  const lowerCaseFields = ['email', 'tomadorEmail', 'email_corporativo'];
  
  // Fields to preserve (do not change case)
  const preserveFields = [
    'id', 'password', 'passwordHash', 'pixKey', 'pixKeyType', 'status',
    'slipPdfUrl', 'slipOurNumber', 'slipDigitableLine', 'slipBarcode',
    'xmlUrl', 'pdfUrl', 'chaveAcesso', 'codigoVerificacao',
    'details', 'tomadorEnderecoJson', 'apiRequestRaw', 'apiResponseRaw',
    'certificatePassword', 'certificadoSenha'
  ];

  for (const key of Object.keys(newData)) {
    if (typeof newData[key] === 'string') {
      if (lowerCaseFields.includes(key)) {
        newData[key] = newData[key].toLowerCase();
      } else if (!preserveFields.includes(key) && !key.endsWith('Url') && !key.endsWith('Id') && !key.startsWith('url')) {
        newData[key] = newData[key].toUpperCase();
      }
    }
  }
  return newData;
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

      // Check for 2FA
      if (user.isTwoFactorEnabled) {
        req.session.temp2faUserId = user.id;
        return res.json({ requireTwoFactor: true });
      }

      req.session.userId = user.id;
      res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions } });
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

  // 2FA Routes
  app.post("/api/auth/2fa/setup", requireAuth, async (req, res) => {
    try {
      const secret = speakeasy.generateSecret({ name: "Imobiliaria Simples" });
      const url = await QRCode.toDataURL(secret.otpauth_url!);
      
      // Save secret temporarily (not enabled yet)
      await storage.updateUser(req.session.userId!, {
        twoFactorSecret: secret.base32
      });

      res.json({ secret: secret.base32, qrCode: url });
    } catch (error) {
      console.error("2FA Setup error:", error);
      res.status(500).json({ error: "Erro ao configurar 2FA" });
    }
  });

  app.post("/api/auth/2fa/verify", requireAuth, async (req, res) => {
    try {
      const { token } = req.body;
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.twoFactorSecret) {
        return res.status(400).json({ error: "Configuração de 2FA não iniciada" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token
      });

      if (verified) {
        await storage.updateUser(user.id, { isTwoFactorEnabled: true });
        res.json({ success: true });
      } else {
        res.status(400).json({ error: "Código inválido" });
      }
    } catch (error) {
      console.error("2FA Verify error:", error);
      res.status(500).json({ error: "Erro ao verificar 2FA" });
    }
  });

  app.post("/api/auth/2fa/disable", requireAuth, async (req, res) => {
    try {
      await storage.updateUser(req.session.userId!, {
        isTwoFactorEnabled: false,
        twoFactorSecret: null
      });
      res.json({ success: true });
    } catch (error) {
      console.error("2FA Disable error:", error);
      res.status(500).json({ error: "Erro ao desativar 2FA" });
    }
  });

  app.post("/api/auth/2fa/login", async (req, res) => {
    try {
      const { token } = req.body;
      const userId = req.session.temp2faUserId;

      if (!userId) {
        return res.status(401).json({ error: "Sessão de login expirada ou inválida" });
      }

      const user = await storage.getUser(userId);
      if (!user || !user.twoFactorSecret) {
        return res.status(400).json({ error: "Usuário inválido" });
      }

      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token
      });

      if (verified) {
        req.session.userId = userId;
        delete req.session.temp2faUserId;
        res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions } });
      } else {
        res.status(400).json({ error: "Código inválido" });
      }
    } catch (error) {
      console.error("2FA Login error:", error);
      res.status(500).json({ error: "Erro ao validar 2FA" });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions } });
  });

  // User Management Routes
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Erro ao buscar usuários" });
    }
  });

  app.post("/api/users", requireAuth, async (req, res) => {
    try {
      const data = req.body;
      const existingUser = await storage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ error: "Email já cadastrado" });
      }

      const passwordHash = await bcrypt.hash(data.password, 10);
      // Remove password from data before creating
      const { password, ...userData } = data;
      
      const user = await storage.createUser({
        ...userData,
        passwordHash,
        permissions: data.permissions || [],
        role: data.role || "user",
        isTwoFactorEnabled: false
      });
      res.status(201).json(user);
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Erro ao criar usuário" });
    }
  });

  app.patch("/api/users/:id", requireAuth, async (req, res) => {
    try {
      const { password, ...updateData } = req.body;
      
      if (password) {
        updateData.passwordHash = await bcrypt.hash(password, 10);
      }

      const user = await storage.updateUser(req.params.id, updateData);
      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
      res.json(user);
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Erro ao atualizar usuário" });
    }
  });

  app.delete("/api/users/:id", requireAuth, async (req, res) => {
    try {
      if (req.params.id === req.session.userId) {
        return res.status(400).json({ error: "Não é possível excluir o próprio usuário logado" });
      }
      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Erro ao excluir usuário" });
    }
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

  app.get("/api/landlords", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const landlords = await storage.getLandlords();
      res.json(landlords);
    } catch (error) {
      console.error("Get landlords error:", error);
      res.status(500).json({ error: "Erro ao buscar proprietários" });
    }
  });

  app.get("/api/landlords/next-code", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const code = await storage.getNextLandlordCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next landlord code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de proprietário" });
    }
  });

  app.post("/api/landlords", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const data = normalizeInputData({ ...req.body });
      if (!data.code) {
        const landlords = await storage.getLandlords();
        let maxCode = 0;
        for (const l of landlords) {
          if (l.code && !isNaN(parseInt(l.code))) {
            const c = parseInt(l.code);
            if (c > maxCode) maxCode = c;
          }
        }
        data.code = (maxCode + 1).toString();
      }

      if (!data.name) {
        return res.status(400).json({ error: "O campo Nome é obrigatório." });
      }
      if (!data.doc) {
        return res.status(400).json({ error: "O campo CPF é obrigatório." });
      }

      const landlord = await storage.createLandlord(data);
      res.status(201).json(landlord);
    } catch (error: any) {
      console.error("Create landlord error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um proprietário com este código." });
      }
      res.status(500).json({ error: "Erro ao criar proprietário." });
    }
  });

  app.patch("/api/landlords/:id", requirePermission("menu_landlords"), async (req, res) => {
    try {
      const landlord = await storage.updateLandlord(req.params.id, normalizeInputData(req.body));
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });
      res.json(landlord);
    } catch (error) {
      console.error("Update landlord error:", error);
      res.status(500).json({ error: "Erro ao atualizar proprietário" });
    }
  });

  app.delete("/api/landlords/:id", requirePermission("menu_landlords"), async (req, res) => {
    try {
      await storage.deleteLandlord(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete landlord error:", error);
      res.status(500).json({ error: "Erro ao excluir proprietário" });
    }
  });

  app.get("/api/tenants", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const tenants = await storage.getTenants();
      res.json(tenants);
    } catch (error) {
      console.error("Get tenants error:", error);
      res.status(500).json({ error: "Erro ao buscar locatários" });
    }
  });

  app.get("/api/tenants/next-code", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const code = await storage.getNextTenantCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next tenant code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de locatário" });
    }
  });

  app.post("/api/tenants", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const data = normalizeInputData({ ...req.body });
      if (!data.code) {
        const tenants = await storage.getTenants();
        let maxCode = 0;
        for (const t of tenants) {
          if (t.code && !isNaN(parseInt(t.code))) {
            const c = parseInt(t.code);
            if (c > maxCode) maxCode = c;
          }
        }
        data.code = (maxCode + 1).toString();
      }

      if (!data.name) {
        return res.status(400).json({ error: "O campo Nome é obrigatório." });
      }
      if (!data.doc) {
        return res.status(400).json({ error: "O campo CPF é obrigatório." });
      }

      const tenant = await storage.createTenant(data);
      res.status(201).json(tenant);
    } catch (error: any) {
      console.error("Create tenant error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um locatário com este código." });
      }
      res.status(500).json({ error: "Erro ao criar locatário." });
    }
  });

  app.patch("/api/tenants/:id", requirePermission("menu_tenants"), async (req, res) => {
    try {
      const tenant = await storage.updateTenant(req.params.id, normalizeInputData(req.body));
      if (!tenant) return res.status(404).json({ error: "Locatário não encontrado" });
      res.json(tenant);
    } catch (error) {
      console.error("Update tenant error:", error);
      res.status(500).json({ error: "Erro ao atualizar locatário" });
    }
  });

  app.delete("/api/tenants/:id", requirePermission("menu_tenants"), async (req, res) => {
    try {
      await storage.deleteTenant(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete tenant error:", error);
      res.status(500).json({ error: "Erro ao excluir locatário" });
    }
  });

  app.get("/api/guarantors", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const guarantors = await storage.getGuarantors();
      res.json(guarantors);
    } catch (error) {
      console.error("Get guarantors error:", error);
      res.status(500).json({ error: "Erro ao buscar fiadores" });
    }
  });

  app.get("/api/guarantors/next-code", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const code = await storage.getNextGuarantorCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next guarantor code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de fiador" });
    }
  });

  app.post("/api/guarantors", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const data = normalizeInputData(req.body);

      if (!data.name) {
        return res.status(400).json({ error: "O campo Nome é obrigatório." });
      }
      if (!data.doc) {
        return res.status(400).json({ error: "O campo CPF é obrigatório." });
      }

      const guarantor = await storage.createGuarantor(data);
      res.status(201).json(guarantor);
    } catch (error: any) {
      console.error("Create guarantor error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um fiador com este código." });
      }
      res.status(500).json({ error: "Erro ao criar fiador." });
    }
  });

  app.patch("/api/guarantors/:id", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      const guarantor = await storage.updateGuarantor(req.params.id, normalizeInputData(req.body));
      if (!guarantor) return res.status(404).json({ error: "Fiador não encontrado" });
      res.json(guarantor);
    } catch (error) {
      console.error("Update guarantor error:", error);
      res.status(500).json({ error: "Erro ao atualizar fiador" });
    }
  });

  app.delete("/api/guarantors/:id", requirePermission("menu_guarantors"), async (req, res) => {
    try {
      await storage.deleteGuarantor(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete guarantor error:", error);
      res.status(500).json({ error: "Erro ao excluir fiador" });
    }
  });

  app.get("/api/providers", requirePermission("menu_providers"), async (req, res) => {
    try {
      const providers = await storage.getServiceProviders();
      res.json(providers);
    } catch (error) {
      console.error("Get providers error:", error);
      res.status(500).json({ error: "Erro ao buscar prestadores" });
    }
  });

  app.post("/api/providers", requirePermission("menu_providers"), async (req, res) => {
    try {
      const provider = await storage.createServiceProvider(normalizeInputData(req.body));
      res.status(201).json(provider);
    } catch (error) {
      console.error("Create provider error:", error);
      res.status(500).json({ error: "Erro ao criar prestador" });
    }
  });

  app.patch("/api/providers/:id", requirePermission("menu_providers"), async (req, res) => {
    try {
      const provider = await storage.updateServiceProvider(req.params.id, normalizeInputData(req.body));
      if (!provider) return res.status(404).json({ error: "Prestador não encontrado" });
      res.json(provider);
    } catch (error) {
      console.error("Update provider error:", error);
      res.status(500).json({ error: "Erro ao atualizar prestador" });
    }
  });

  app.delete("/api/providers/:id", requirePermission("menu_providers"), async (req, res) => {
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

  app.get("/api/properties/next-code", requireAuth, async (req, res) => {
    try {
      const code = await storage.getNextPropertyCode();
      res.json({ code });
    } catch (error) {
      console.error("Get next property code error:", error);
      res.status(500).json({ error: "Erro ao gerar próximo código de imóvel" });
    }
  });

  app.post("/api/properties", requireAuth, async (req, res) => {
    try {
      const data = normalizeInputData(req.body);

      if (!data.code) {
        return res.status(400).json({ error: "O campo Código é obrigatório." });
      }
      if (!data.title) {
        return res.status(400).json({ error: "O campo Título é obrigatório." });
      }
      if (!data.address) {
        return res.status(400).json({ error: "O campo Endereço é obrigatório." });
      }
      if (!data.city) {
        return res.status(400).json({ error: "O campo Cidade é obrigatório." });
      }
      if (!data.state) {
        return res.status(400).json({ error: "O campo Estado é obrigatório." });
      }
      if (data.rentDefault === undefined || data.rentDefault === null || data.rentDefault === "") {
        return res.status(400).json({ error: "O campo Aluguel Padrão é obrigatório." });
      }

      const property = await storage.createProperty(data);
      res.status(201).json(property);
    } catch (error: any) {
      console.error("Create property error:", error);
      if (error?.code === "23505") {
        return res.status(400).json({ error: "Já existe um imóvel com este código." });
      }
      res.status(500).json({ error: "Erro ao criar imóvel." });
    }
  });

  app.patch("/api/properties/:id", requireAuth, async (req, res) => {
    try {
      const property = await storage.updateProperty(req.params.id, normalizeInputData(req.body));
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

  app.delete("/api/contracts/:id/draft-receipts", requirePermission("delete_receipt"), async (req, res) => {
    try {
      await storage.deleteDraftReceiptsByContractId(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete draft receipts error:", error);
      res.status(500).json({ error: "Erro ao excluir recibos em rascunho" });
    }
  });

  app.delete("/api/receipts/drafts", requirePermission("delete_receipt"), async (req, res) => {
    try {
      const { year, month } = req.body;
      if (!year || !month) {
        return res.status(400).json({ error: "Ano e mês são obrigatórios" });
      }
      await storage.deleteDraftReceiptsByRef(year, month);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete draft receipts by ref error:", error);
      res.status(500).json({ error: "Erro ao excluir recibos em rascunho do mês" });
    }
  });

  // Recurring Items Routes
  app.get("/api/contracts/:id/recurring-items", requireAuth, async (req, res) => {
    try {
      const items = await storage.getContractRecurringItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Get recurring items error:", error);
      res.status(500).json({ error: "Erro ao buscar itens recorrentes" });
    }
  });

  app.post("/api/contracts/:id/recurring-items", requireAuth, async (req, res) => {
    try {
      const item = await storage.createContractRecurringItem({
        ...req.body,
        contractId: req.params.id
      });
      res.status(201).json(item);
    } catch (error) {
      console.error("Create recurring item error:", error);
      res.status(500).json({ error: "Erro ao criar item recorrente" });
    }
  });

  app.delete("/api/recurring-items/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteContractRecurringItem(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete recurring item error:", error);
      res.status(500).json({ error: "Erro ao excluir item recorrente" });
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

  app.delete("/api/services/bulk", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "IDs inválidos ou vazios" });
      }

      // Validar cada serviço antes de excluir
      // TODO: Otimizar para buscar todos de uma vez se necessário
      for (const id of ids) {
        const service = await storage.getService(id);
        if (service) {
          const receipt = await storage.getReceiptByContractAndRef(
            service.contractId,
            service.refYear,
            service.refMonth
          );
          if (receipt && receipt.status !== "draft") {
            return res.status(400).json({ 
              error: `Não é possível excluir o serviço (Valor: ${service.amount}, Desc: ${service.description}) pois o recibo está fechado.` 
            });
          }
        }
      }

      await storage.deleteServicesBulk(ids);
      res.json({ success: true });
    } catch (error) {
      console.error("Bulk delete services error:", error);
      res.status(500).json({ error: "Erro ao excluir serviços em lote" });
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
      const [receipts, transfers, invoices] = await Promise.all([
        storage.getReceiptsByRef(year, month),
        storage.getLandlordTransfersReport(year, month, "ref"),
        storage.getInvoices(),
      ]);

      const transferReceiptIds = new Set(transfers.map(t => t.receiptId));

      const invoicesByReceiptId = new Map<string, any>();
      for (const invoice of invoices) {
        if (!invoice.receiptId) continue;
        const existing = invoicesByReceiptId.get(invoice.receiptId);
        if (!existing || existing.status !== "issued") {
          invoicesByReceiptId.set(invoice.receiptId, invoice);
        }
      }

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

        const invoice = invoicesByReceiptId.get(receipt.id);
        const hasInvoiceGenerated = !!invoice && invoice.status !== "cancelled";
        const hasInvoiceIssued = !!invoice && invoice.status === "issued";

        const mergedInvoiceFlags = {
          isInvoiceGenerated:
            receipt.isInvoiceGenerated || (hasInvoiceGenerated && !receipt.isInvoiceCancelled),
          isInvoiceIssued: receipt.isInvoiceIssued || hasInvoiceIssued,
        };

        const isPaid = receipt.status === "paid" || (receipt.id && paidReceiptIds.has(receipt.id));

        if (receipt.status === 'paid' || receipt.status === 'transferred') {
          return { 
            ...receipt, 
            ...mergedInvoiceFlags,
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
          .filter((s: any) => s.chargedTo === "TENANT")
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const servicesLandlordTotal = contractServices
          .filter(
            (s: any) =>
              s.chargedTo === "LANDLORD" &&
              (s as any).discountFrom !== "LANDLORD" &&
              (s as any).discountFrom !== "TENANT"
          )
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const storedTenantTotal = Number(receipt.servicesTenantTotal || 0);
        const storedLandlordTotal = Number(receipt.servicesLandlordTotal || 0);

        const outdated =
          Math.abs(servicesTenantTotal - storedTenantTotal) > 0.01 ||
          Math.abs(servicesLandlordTotal - storedLandlordTotal) > 0.01;

        return { 
          ...receipt,
          ...mergedInvoiceFlags,
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
        codigoCadastrarPIX: 1,
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

  // Rota pública para visualização de dados do recibo para impressão (compartilhamento externo)
  app.get("/api/public/receipts/:id/print", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) {
        return res.status(404).json({ error: "Recibo não encontrado" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) {
        return res.status(404).json({ error: "Contrato não encontrado" });
      }

      const [property, tenant, landlord, services] = await Promise.all([
        storage.getProperty(contract.propertyId),
        storage.getTenant(contract.tenantId),
        storage.getLandlord(contract.landlordId),
        storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth),
      ]);

      if (!property || !tenant || !landlord) {
        return res.status(404).json({ error: "Dados do contrato incompletos" });
      }

      res.json({
        receipt,
        contract,
        property,
        tenant,
        landlord,
        services,
      });
    } catch (error: any) {
      console.error("Get public receipt print data error:", error);
      res
        .status(500)
        .json({ error: error.message || "Erro ao buscar dados públicos do recibo para impressão" });
    }
  });

  app.post("/api/receipts/generate", requireAuth, async (req, res) => {
    try {
      const { year, month } = req.body;
      const activeContracts = await storage.getActiveContracts();
      const created: any[] = [];

      for (const contract of activeContracts) {
        if (contract.firstDueDate) {
          const firstDue = new Date(contract.firstDueDate as unknown as string);
          const firstY = firstDue.getFullYear();
          const firstM = firstDue.getMonth() + 1; // 1-12
          const target = year * 100 + month;
          const min = firstY * 100 + firstM;
          if (target < min) {
            continue;
          }
        }

        const existingReceipt = await storage.getReceiptByContractAndRef(contract.id, year, month);
        if (existingReceipt) continue;

        let currentServices = await storage.getServicesByContractAndRef(contract.id, year, month);

        // Auto-create Recurring Items
        const recurringItems = await storage.getContractRecurringItems(contract.id);
        for (const item of recurringItems) {
           const exists = currentServices.some(s => s.description === item.description);
           if (!exists) {
             await storage.createService({
                contractId: contract.id,
                refYear: year,
                refMonth: month,
                description: item.description,
                amount: String(item.amount),
                chargedTo: item.chargedTo,
                passThrough: item.passThrough
             });
           }
        }

        // Auto-create Insurance Service if applicable
        if (contract.guaranteeType === 'insurance' && Number(contract.insuranceValue) > 0) {
          // Re-fetch services to check for insurance (though unlikely to collide with recurring items unless named same)
          currentServices = await storage.getServicesByContractAndRef(contract.id, year, month);
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
        const tenantDiscountFromRent = contractServices
          .filter((s: any) => (s as any).discountFrom === "TENANT")
          .reduce((sum, s) => sum + Number(s.amount), 0);
        const landlordDiscountFromRent = contractServices
          .filter((s: any) => (s as any).discountFrom === "LANDLORD" || (s as any).discountFrom === "TENANT")
          .reduce((sum, s) => sum + Number(s.amount), 0);
        const servicesTenantTotal = contractServices
          .filter((s: any) => s.chargedTo === "TENANT")
          .reduce((sum, s) => sum + Number(s.amount), 0);
        const servicesLandlordTotal = contractServices
          .filter(
            (s: any) =>
              s.chargedTo === "LANDLORD" &&
              (s as any).discountFrom !== "LANDLORD" &&
              (s as any).discountFrom !== "TENANT"
          )
          .reduce((sum, s) => sum + Number(s.amount), 0);
        const servicesPassThroughTotal = contractServices
          .filter((s: any) => s.passThrough)
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const rentAmount = Number(contract.rentAmount);
        const adjustedRentTenant = Math.max(0, rentAmount - tenantDiscountFromRent);
        const adjustedRentLandlord = Math.max(0, rentAmount - landlordDiscountFromRent);
        const adminFeePercent = Number(contract.adminFeePercent);
        const adminFeeAmount = (adjustedRentLandlord * adminFeePercent) / 100;
        const tenantTotalDue = rentAmount + servicesTenantTotal - tenantDiscountFromRent;
        const landlordTotalDue =
          adjustedRentLandlord - adminFeeAmount - servicesLandlordTotal + servicesPassThroughTotal;
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

      // Auto-create Recurring Items if missing
      const recurringItems = await storage.getContractRecurringItems(contract.id);
      const preServices = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
      for (const item of recurringItems) {
         const exists = preServices.some(s => s.description === item.description);
         if (!exists) {
           await storage.createService({
              contractId: contract.id,
              refYear: receipt.refYear,
              refMonth: receipt.refMonth,
              description: item.description,
              amount: String(item.amount),
              chargedTo: item.chargedTo,
              passThrough: item.passThrough
           });
         }
      }

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

      const contractServices = await storage.getServicesByContractAndRef(
        contract.id,
        receipt.refYear,
        receipt.refMonth
      );
      const tenantDiscountFromRent = contractServices
        .filter((s: any) => (s as any).discountFrom === "TENANT")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const landlordDiscountFromRent = contractServices
        .filter(
          (s: any) =>
            (s as any).discountFrom === "LANDLORD" || (s as any).discountFrom === "TENANT"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesTenantTotal = contractServices
        .filter((s: any) => s.chargedTo === "TENANT")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesLandlordTotal = contractServices
        .filter(
          (s: any) =>
            s.chargedTo === "LANDLORD" &&
            (s as any).discountFrom !== "LANDLORD" &&
            (s as any).discountFrom !== "TENANT"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesPassThroughTotal = contractServices
        .filter((s: any) => s.passThrough)
        .reduce((sum, s) => sum + Number(s.amount), 0);

      const rentAmount = Number(contract.rentAmount);
      const adjustedRentTenant = Math.max(0, rentAmount - tenantDiscountFromRent);
      const adjustedRentLandlord = Math.max(0, rentAmount - landlordDiscountFromRent);
      const adminFeePercent = Number(contract.adminFeePercent);
      const adminFeeAmount = (adjustedRentLandlord * adminFeePercent) / 100;
      const tenantTotalDue =
        rentAmount + servicesTenantTotal - tenantDiscountFromRent;
      const landlordTotalDue =
        adjustedRentLandlord - adminFeeAmount - servicesLandlordTotal + servicesPassThroughTotal;
      
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
      const start = req.query.start as string | undefined;
      const end = req.query.end as string | undefined;
      const landlordId = req.query.landlordId as string | undefined;

      let transfers;
      if (type === "paid" && start && end) {
        transfers = await storage.getLandlordTransfersByPaymentPeriod(start, end, landlordId);
      } else {
        transfers = await storage.getLandlordTransfersReport(year, month, type);
      }
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

  app.get("/api/reports/insurance", requireAuth, async (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
      const statusMode = (req.query.status as string) || "paid_transferred";
      const statuses = statusMode === "all" ? ["paid", "transferred", "closed"] : ["paid", "transferred"];
      const insurance = await storage.getInsuranceReport(year, month, statuses as any);
      res.json(insurance);
    } catch (error) {
      console.error("Get insurance report error:", error);
      res.status(500).json({ error: "Erro ao buscar relatório de seguro fiança" });
    }
  });

  app.patch("/api/receipts/:id/admin-fee", requireAuth, async (req, res) => {
    try {
      const { adminFeeAmount } = req.body;
      if (adminFeeAmount === undefined || adminFeeAmount === null) {
        return res.status(400).json({ error: "Valor da taxa é obrigatório" });
      }

      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "draft") return res.status(400).json({ error: "Recibo não está em rascunho" });

      const rentAmount = Number(receipt.rentAmount);
      const newAdminFeeAmount = Number(adminFeeAmount);

      // Recompute totals considerando descontos e todos os repasses
      const contractServices = await storage.getServicesByContractAndRef(receipt.contractId, receipt.refYear, receipt.refMonth);
      const discountToLandlord = contractServices
        .filter((s: any) => (s as any).discountFrom === "LANDLORD")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesLandlordTotal = contractServices
        .filter((s: any) => s.chargedTo === "LANDLORD" && (s as any).discountFrom !== "LANDLORD")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesPassThroughTotal = contractServices
        .filter((s: any) => s.passThrough)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const adjustedRent = Math.max(0, rentAmount - discountToLandlord);

      // Recalculate landlord total due
      // Fórmula: (Aluguel Ajustado) - Taxa Adm - Serviços(Proprietário) + Repasses
      const landlordTotalDue = adjustedRent - newAdminFeeAmount - servicesLandlordTotal + servicesPassThroughTotal;

      // Update percent if possible
      let adminFeePercent = Number(receipt.adminFeePercent);
      if (adjustedRent > 0) {
        adminFeePercent = (newAdminFeeAmount / adjustedRent) * 100;
      }

      const updated = await storage.updateReceipt(req.params.id, { 
        adminFeeAmount: String(newAdminFeeAmount),
        adminFeePercent: String(adminFeePercent.toFixed(2)),
        landlordTotalDue: String(landlordTotalDue.toFixed(2))
      });

      res.json(updated);
    } catch (error) {
      console.error("Update admin fee error:", error);
      res.status(500).json({ error: "Erro ao atualizar taxa de administração" });
    }
  });

  app.patch("/api/receipts/:id/due-date", requireAuth, async (req, res) => {
    try {
      const { dueDate } = req.body as { dueDate?: string };
      if (!dueDate) {
        return res.status(400).json({ error: "Data de vencimento é obrigatória" });
      }

      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });

      if (receipt.isSlipIssued) {
        return res.status(400).json({ error: "Recibo já possui boleto emitido; vencimento não pode ser alterado" });
      }

      if (receipt.status !== "draft" && receipt.status !== "closed") {
        return res.status(400).json({ error: "Vencimento só pode ser alterado para recibos em rascunho ou fechados" });
      }

      const parsed = new Date(dueDate);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Data de vencimento inválida" });
      }

      const normalized = parsed.toISOString().split("T")[0];

      const updated = await storage.updateReceipt(req.params.id, {
        dueDate: normalized,
      });

      res.json(updated);
    } catch (error) {
      console.error("Update receipt due date error:", error);
      res.status(500).json({ error: "Erro ao atualizar vencimento do recibo" });
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

  app.post("/api/receipts/:id/mark-paid", requirePermission("mark_receipt_paid"), async (req, res) => {
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

  app.post("/api/receipts/:id/reverse-payment", requirePermission("reverse_payment"), async (req, res) => {
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

  app.post("/api/receipts/:id/create-transfer", requirePermission("generate_transfer"), async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Recibo não encontrado" });
      if (receipt.status !== "paid" && receipt.status !== "closed") return res.status(400).json({ error: "Recibo deve estar fechado ou pago para gerar repasse" });

      // Verifica se já existe repasse para este recibo
      const existingTransfers = await storage.getLandlordTransfersByReceipt(receipt.id);
      if (existingTransfers.length > 0) {
        return res.status(400).json({ error: "Já existe um repasse gerado para este recibo" });
      }

      const contract = await storage.getContract(receipt.contractId);
      if (!contract) return res.status(404).json({ error: "Contrato não encontrado" });

      const services = await storage.getServicesByContractAndRef(
        contract.id,
        receipt.refYear,
        receipt.refMonth
      );
      const landlordDiscountFromRentForTransfer = services
        .filter(
          (s: any) =>
            (s as any).discountFrom === "LANDLORD" ||
            (s as any).discountFrom === "TENANT"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesLandlordTotalForTransfer = services
        .filter(
          (s: any) =>
            s.chargedTo === "LANDLORD" &&
            (s as any).discountFrom !== "LANDLORD" &&
            (s as any).discountFrom !== "TENANT"
        )
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const servicesPassThroughTotalForTransfer = services
        .filter((s: any) => (s as any).passThrough)
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const rentAmountForTransfer = Number(receipt.rentAmount);
      const adjustedRentForTransfer = Math.max(
        0,
        rentAmountForTransfer - landlordDiscountFromRentForTransfer
      );
      const adminFeePercentForTransfer = Number(receipt.adminFeePercent);
      const adminFeeAmountForTransfer = Math.max(
        0,
        adjustedRentForTransfer * (adminFeePercentForTransfer / 100)
      );
      const landlordTotalForTransfer =
        adjustedRentForTransfer -
        adminFeeAmountForTransfer -
        servicesLandlordTotalForTransfer +
        servicesPassThroughTotalForTransfer;

      const transfer = await storage.createLandlordTransfer({
        landlordId: contract.landlordId,
        receiptId: receipt.id,
        amount: String(landlordTotalForTransfer.toFixed(2)),
        status: "pending",
      });
      
      // Atualiza status do recibo para transferred se estiver paid
      if (receipt.status === "paid") {
          await storage.updateReceipt(receipt.id, { status: "transferred" });
      }

      res.json(transfer);
    } catch (error) {
      console.error("Create transfer error:", error);
      res.status(500).json({ error: "Erro ao criar repasse" });
    }
  });

  app.post("/api/transfers/batch-generate", requirePermission("generate_transfer"), async (req, res) => {
    try {
      const { receiptIds } = req.body;
      if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: "Lista de recibos inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of receiptIds) {
        try {
          const receipt = await storage.getReceipt(id);
          if (!receipt) throw new Error(`Recibo ${id} não encontrado`);
          
          if (receipt.status !== "paid" && receipt.status !== "closed") {
             throw new Error(`Recibo deve estar fechado ou pago (Status atual: ${receipt.status})`);
          }

          const existingTransfers = await storage.getLandlordTransfersByReceipt(receipt.id);
          if (existingTransfers.length > 0) {
            throw new Error(`Já existe repasse para este recibo`);
          }
          
          const contract = await storage.getContract(receipt.contractId);
          if (!contract) throw new Error(`Contrato não encontrado`);

          const services = await storage.getServicesByContractAndRef(
            contract.id,
            receipt.refYear,
            receipt.refMonth
          );
          const landlordDiscountFromRentForTransfer = services
            .filter(
              (s: any) =>
                (s as any).discountFrom === "LANDLORD" ||
                (s as any).discountFrom === "TENANT"
            )
            .reduce((sum, s) => sum + Number(s.amount), 0);
          const servicesLandlordTotalForTransfer = services
            .filter(
              (s: any) =>
                s.chargedTo === "LANDLORD" &&
                (s as any).discountFrom !== "LANDLORD" &&
                (s as any).discountFrom !== "TENANT"
            )
            .reduce((sum, s) => sum + Number(s.amount), 0);
          const servicesPassThroughTotalForTransfer = services
            .filter((s: any) => (s as any).passThrough)
            .reduce((sum, s) => sum + Number(s.amount), 0);
          const rentAmountForTransfer = Number(receipt.rentAmount);
          const adjustedRentForTransfer = Math.max(
            0,
            rentAmountForTransfer - landlordDiscountFromRentForTransfer
          );
          const adminFeePercentForTransfer = Number(receipt.adminFeePercent);
          const adminFeeAmountForTransfer = Math.max(
            0,
            adjustedRentForTransfer * (adminFeePercentForTransfer / 100)
          );
          const landlordTotalForTransfer =
            adjustedRentForTransfer -
            adminFeeAmountForTransfer -
            servicesLandlordTotalForTransfer +
            servicesPassThroughTotalForTransfer;
          
          await storage.createLandlordTransfer({
            landlordId: contract.landlordId,
            receiptId: receipt.id,
            amount: String(landlordTotalForTransfer.toFixed(2)),
            status: "pending",
          });

          if (receipt.status === "paid") {
             await storage.updateReceipt(receipt.id, { status: "transferred" });
          }

          results.success++;
          results.details.push({ id, status: "success" });
        } catch (err: any) {
          results.errors++;
          results.details.push({ id, status: "error", message: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Batch generate transfers error:", error);
      res.status(500).json({ error: "Erro ao gerar repasses em lote" });
    }
  });

  app.post("/api/receipts/batch-mark-paid", requirePermission("mark_receipt_paid"), async (req, res) => {
    try {
      const { receiptIds } = req.body;
      if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: "Lista de recibos inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of receiptIds) {
        try {
          const receipt = await storage.getReceipt(id);
          if (!receipt) throw new Error(`Recibo ${id} não encontrado`);
          
          if (receipt.status !== "closed" && receipt.status !== "transferred") {
            throw new Error(`Recibo deve estar fechado ou repassado (Status atual: ${receipt.status})`);
          }

          // Check if already paid (Cash IN exists or status is paid)
          // Actually logic in mark-paid single endpoint:
          // if (receipt.status !== "closed" && receipt.status !== "transferred") return error
          // Logic:
          // const newStatus = receipt.status === "closed" ? "paid" : receipt.status;
          // update receipt status
          // create cash transaction

          // We should check if transaction already exists to avoid double payment if user selects accidentally
          // But 'closed' status usually implies not paid. 'transferred' might be paid or not.
          // If status is 'transferred', we need to check if it's already paid (isPaid flag or similar? No, isPaid is derived property in frontend usually)
          // Wait, look at receipt type in schema. There is no 'isPaid' column. It's determined by status 'paid' OR 'transferred' + existence of cash transaction?
          // Let's look at `mark-paid` implementation again.
          // It creates a CashTransaction.
          
          // To be safe, let's check if a cash transaction of type IN already exists for this receipt.
          const existingTransactions = await storage.getCashTransactionsByReceipt(receipt.id);
          const hasPayment = existingTransactions.some(t => t.type === "IN");
          
          if (hasPayment) {
             throw new Error("Recibo já possui pagamento registrado");
          }

          const newStatus = receipt.status === "closed" ? "paid" : receipt.status;
          await storage.updateReceipt(receipt.id, { status: newStatus });

          await storage.createCashTransaction({
            type: "IN",
            date: new Date().toISOString().split("T")[0],
            category: "Aluguel",
            description: `Pagamento recibo ${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}`,
            amount: receipt.tenantTotalDue,
            receiptId: receipt.id,
          });

          results.success++;
          results.details.push({ id, status: "success" });
        } catch (err: any) {
          results.errors++;
          results.details.push({ id, status: "error", message: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Batch mark paid error:", error);
      res.status(500).json({ error: "Erro ao marcar recibos como pago em lote" });
    }
  });

  app.post("/api/receipts/batch-emit-slip", requireAuth, async (req, res) => {
    try {
      const { receiptIds } = req.body;
      if (!Array.isArray(receiptIds) || receiptIds.length === 0) {
        return res.status(400).json({ error: "Lista de recibos inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of receiptIds) {
        try {
          const receipt = await storage.getReceipt(id);
          if (!receipt) throw new Error(`Recibo ${id} não encontrado`);
          
          if (receipt.status === "draft") {
             throw new Error("Não é possível emitir boleto para recibo em rascunho");
          }

          if (receipt.isSlipIssued) {
             throw new Error("Boleto já emitido para este recibo");
          }

          const contract = await storage.getContract(receipt.contractId);
          if (!contract) throw new Error("Contrato não encontrado");

          const tenant = await storage.getTenant(contract.tenantId);
          if (!tenant) throw new Error("Locatário não encontrado");

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

          // Seu Numero - Unique ID (10 digits from timestamp + random suffix to ensure uniqueness in batch)
          const seuNumero = Date.now().toString().slice(-6) + Math.floor(Math.random() * 10000).toString().padStart(4, '0');

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
            codigoCadastrarPIX: 1,
            numeroContratoCobranca: 0
          };

          const result = await sicoobProvider.emitirBoleto(payload);

          // Handle PDF
          let slipPdfUrl = "";
          if (result.pdfBoleto) {
            const buffer = Buffer.from(result.pdfBoleto, 'base64');
            const fileName = `boleto-${receipt.id}.pdf`;
            const publicDir = path.join(process.cwd(), 'client', 'public', 'boletos');
            
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

          results.success++;
          results.details.push({ id, status: "success" });
        } catch (err: any) {
          console.error(`Error emitting slip for receipt ${id}:`, err);
          results.errors++;
          results.details.push({ id, status: "error", message: err.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Batch emit slip error:", error);
      res.status(500).json({ error: "Erro ao emitir boletos em lote" });
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

      const services = await storage.getServicesByContractAndRef(contract.id, receipt.refYear, receipt.refMonth);
      const discountToLandlordForInvoice = services
        .filter((s: any) => (s as any).discountFrom === "LANDLORD")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      const adjustedRentForInvoice = Math.max(0, Number(receipt.rentAmount) - discountToLandlordForInvoice);
      const adminFeePercentForInvoice = Number(receipt.adminFeePercent);
      const adminFeeAmountForInvoice = Math.max(0, adjustedRentForInvoice * (adminFeePercentForInvoice / 100));

      const invoice = await storage.createInvoice({
        landlordId: contract.landlordId,
        receiptId: receipt.id,
        amount: String(adminFeeAmountForInvoice.toFixed(2)),
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
      const transfers = await storage.getEnrichedLandlordTransfers();
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
      const current = await storage.getNfseEmissao(emissaoId);
      if (!current) return res.status(404).json({ error: "Emissão não encontrada" });
      if (current.status === "ENVIANDO" || current.status === "EMITIDA") {
        return res.status(409).json({ error: "Emissão já em processamento ou emitida", emissao: current });
      }
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

  app.post("/api/nfse/emissoes/:id/manual-emit", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const { chaveAcesso } = req.body as { chaveAcesso?: string };
      if (!chaveAcesso) {
        return res.status(400).json({ error: "Chave de acesso é obrigatória" });
      }

      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) {
        return res.status(404).json({ error: "Emissão não encontrada" });
      }

      if (emissao.status === "CANCELADA") {
        return res.status(400).json({ error: "Não é possível marcar uma NFS-e cancelada como emitida" });
      }

      await storage.updateNfseEmissao(emissao.id, {
        status: "EMITIDA",
        chaveAcesso,
        updatedAt: new Date(),
      });

      if (emissao.origemTipo === "INVOICE" || emissao.origemTipo === "COMISSAO") {
        const invoice = await storage.updateInvoice(emissao.origemId, { status: "issued" });
        if (invoice?.receiptId) {
          await storage.updateReceipt(invoice.receiptId, {
            isInvoiceGenerated: true,
            isInvoiceIssued: true,
            isInvoiceCancelled: false,
          });
        }
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error("Manual emit NFS-e error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/invoices/:id/manual-nfse", requireAuth, async (req, res) => {
    try {
      const invoiceId = req.params.id as string;
      const { chaveAcesso } = req.body as { chaveAcesso?: string };

      if (!chaveAcesso) {
        return res.status(400).json({ error: "Chave de acesso é obrigatória" });
      }

      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: "Nota fiscal não encontrada" });
      }

      const landlord = await storage.getLandlord(invoice.landlordId);
      if (!landlord) {
        return res.status(404).json({ error: "Proprietário não encontrado" });
      }

      const receipt = await storage.getReceipt(invoice.receiptId);
      const config = await storage.getNfseConfig();
      if (!config) {
        return res.status(400).json({ error: "Configuração NFS-e não encontrada" });
      }

      const valor = Number(invoice.amount);
      const valorServico = valor.toFixed(2);
      const baseCalculo = valor.toFixed(2);
      const aliquotaIss = Number(config.aliquotaIss || 0);
      const valorIss = (valor * (aliquotaIss / 100)).toFixed(2);

      const discriminacao = `Serviços de administração imobiliária ref. ${
        receipt ? `${String(receipt.refMonth).padStart(2, "0")}/${receipt.refYear}` : ""
      }`;

      const emissao = await storage.createNfseEmissao({
        origemId: invoice.id,
        origemTipo: "INVOICE",
        tomadorNome: landlord.name,
        tomadorCpfCnpj: landlord.doc,
        valorServico,
        baseCalculo,
        aliquotaIss: config.aliquotaIss,
        valorIss,
        descricaoServico: discriminacao,
        status: "EMITIDA",
        idempotencyKey: `INVOICE-MANUAL-${invoice.id}-${Date.now()}`,
        chaveAcesso,
      });

      const updatedInvoice = await storage.updateInvoice(invoice.id, { status: "issued" });
      if (updatedInvoice?.receiptId) {
        await storage.updateReceipt(updatedInvoice.receiptId, {
          isInvoiceGenerated: true,
          isInvoiceIssued: true,
          isInvoiceCancelled: false,
        });
      }

      res.json({ success: true, emissao });
    } catch (error: any) {
      console.error("Manual NFS-e from invoice error:", error);
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

  app.get("/api/public/nfse/danfse/:chave", async (req, res) => {
    try {
      const chave = req.params.chave as string;
      await nfseProvider.initialize();
      const url = nfseProvider.getDanfseUrl(chave);
      res.redirect(url);
    } catch (error: any) {
      console.error("Erro ao redirecionar DANFSe público:", error);
      res.status(500).send("Erro ao gerar link público do DANFSe");
    }
  });

  app.get("/api/nfse/emissoes/:id/danfse-url", requireAuth, async (req, res) => {
    try {
      const emissaoId = req.params.id as string;
      const emissao = await storage.getNfseEmissao(emissaoId);
      if (!emissao) return res.status(404).json({ error: "Emissão não encontrada" });
      if (!emissao.chaveAcesso) return res.status(400).json({ error: "Chave de acesso indisponível para esta emissão" });
      await nfseProvider.initialize();
      const url = nfseProvider.getDanfseUrl(emissao.chaveAcesso);
      res.json({ url });
    } catch (error: any) {
      console.error("Erro ao obter URL do DANFSe:", error);
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

  app.post("/api/transfers/bulk-manual", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Lista de IDs inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of ids) {
        try {
          const transfer = await storage.getLandlordTransfer(id);
          if (!transfer) throw new Error(`Repasse ${id} não encontrado`);
          
          if (transfer.status !== "pending" && transfer.status !== "failed") {
            throw new Error(`Repasse ${id} não está pendente ou com falha (status: ${transfer.status})`);
          }

          const landlord = await storage.getLandlord(transfer.landlordId);
          if (!landlord) throw new Error(`Proprietário não encontrado para repasse ${id}`);

          const receipt = await storage.getReceipt(transfer.receiptId);

          // Atualiza status do repasse
          await storage.updateLandlordTransfer(transfer.id, {
            status: "paid",
            paidAt: new Date(),
            providerTransferId: "MANUAL-BULK-" + Date.now(),
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
            description: `Repasse Manual (Lote) para ${landlord.name}`,
            amount: transfer.amount,
            receiptId: transfer.receiptId,
          });

          results.success++;
        } catch (error: any) {
          results.errors++;
          results.details.push({ id, error: error.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Bulk manual transfer error:", error);
      res.status(500).json({ error: "Erro ao processar pagamentos em lote" });
    }
  });

  app.delete("/api/transfers/bulk-delete", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Lista de IDs inválida" });
      }

      const results = {
        success: 0,
        errors: 0,
        details: [] as any[]
      };

      for (const id of ids) {
        try {
          const transfer = await storage.getLandlordTransfer(id);
          if (!transfer) throw new Error(`Repasse ${id} não encontrado`);

          if (transfer.status !== "pending" && transfer.status !== "failed") {
             throw new Error(`Repasse ${id} não pode ser excluído (status: ${transfer.status})`);
          }

          const receiptId = transfer.receiptId;
          await storage.deleteLandlordTransfer(id);

          // Garante que o recibo volte para o status correto
          if (receiptId) {
            const receipt = await storage.getReceipt(receiptId);
            if (receipt && receipt.status === "transferred") {
               const cashTransactions = await storage.getCashTransactionsByReceiptIds([receiptId]);
               const hasTenantPayment = cashTransactions.some(t => t.type === "IN");
               const newStatus = hasTenantPayment ? "paid" : "closed";
               await storage.updateReceipt(receiptId, { status: newStatus });
            }
          }

          results.success++;
        } catch (error: any) {
           results.errors++;
           results.details.push({ id, error: error.message });
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Bulk delete transfer error:", error);
      res.status(500).json({ error: "Erro ao excluir repasses em lote" });
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

  app.post("/api/transfers/:id/pix-execute", requirePermission("execute_pix"), async (req, res) => {
    try {
      const transfer = await storage.getLandlordTransfer(req.params.id);
      if (!transfer) return res.status(404).json({ error: "Repasse não encontrado" });
      
      if (transfer.status === "paid") {
        return res.status(400).json({ error: "Repasse já foi pago." });
      }

      const landlord = await storage.getLandlord(transfer.landlordId);
      if (!landlord) return res.status(404).json({ error: "Proprietário não encontrado" });

      const description = `Pagamento Repasse ${landlord.name}`.substring(0, 140); 

      let providerTransferId = "";

      if (landlord.pixKeyType === "agencia_conta") {
        if (!landlord.bankIspb || !landlord.doc || !landlord.name || !landlord.account || !landlord.branch || !(landlord as any).accountType) {
          return res.status(400).json({ error: "Dados bancários incompletos para PIX por Agência/Conta (ISPB, CPF/CNPJ, agência, conta, tipo de conta)." });
        }

        const result = await sicoobProvider.confirmPixPaymentByAccount(
          Number(transfer.amount),
          description,
          {
            ispb: landlord.bankIspb,
            cpfCnpj: landlord.doc,
            nome: landlord.name,
            conta: String(landlord.account),
            agencia: String(landlord.branch),
            tipo: String((landlord as any).accountType),
          }
        );

        providerTransferId = result?.endToEndId || result?.endtoendId || "";
      } else {
        if (!landlord.pixKey) {
          return res.status(400).json({ error: "Proprietário não possui chave PIX cadastrada." });
        }

        const endToEndId = await sicoobProvider.initiatePixPayment(landlord.pixKey);
        await sicoobProvider.confirmPixPayment(endToEndId, Number(transfer.amount), description);
        providerTransferId = endToEndId;
      }

      // Update Database
      await storage.updateLandlordTransfer(transfer.id, {
        status: "paid",
        paidAt: new Date(),
        providerTransferId: providerTransferId,
      });

      // Update receipt if linked
      if (transfer.receiptId) {
        await storage.updateReceipt(transfer.receiptId, { status: "transferred" });
      }

      // Create Cash Transaction
      await storage.createCashTransaction({
        type: "OUT",
        date: new Date().toISOString().split("T")[0],
        category: "Repasse ao Proprietário",
        description: `Repasse PIX para ${landlord.name}`,
        amount: transfer.amount,
        receiptId: transfer.receiptId,
      });

      res.json({
        success: true,
        providerTransferId,
        message: `Pagamento Iniciado para ${landlord.name}. Pagamento confirmado com sucesso.`,
      });

    } catch (error: any) {
      console.error("PIX Execute error:", error);
      res.status(500).json({ error: error.message || "Erro ao executar PIX" });
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

  app.delete("/api/invoices/bulk", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "Lista de IDs inválida" });
      }

      const results = { success: 0, errors: 0, details: [] as any[] };

      for (const id of ids) {
        try {
          const invoice = await storage.getInvoice(id);
          if (!invoice) throw new Error(`Nota fiscal ${id} não encontrada`);
          
          if (invoice.status === "issued") {
             throw new Error(`Nota fiscal ${id} já emitida. Cancele-a primeiro.`);
          }
          
          await storage.deleteInvoice(id);
          
          if (invoice.receiptId) {
             await storage.updateReceipt(invoice.receiptId, { 
                isInvoiceGenerated: false 
             });
          }

          results.success++;
        } catch (error: any) {
          results.errors++;
          results.details.push({ id, error: error.message });
        }
      }
      
      res.json(results);
    } catch (error) {
      console.error("Bulk delete invoices error:", error);
      res.status(500).json({ error: "Erro ao excluir notas em lote" });
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
