
import 'dotenv/config';
import fs from 'fs';
import { createRequire } from 'module';
import { db } from '../server/db';
import { landlords } from '../shared/schema';
import { eq } from 'drizzle-orm';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const pdfPath = 'd:\\Imob_Simple\\Cadastros\\Proprietários\\relatorio pro.prn.pdf';

async function importLandlords() {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text;

    // Regex strategy:
    // O texto vem com formatação de linhas.
    // Vamos tentar processar bloco a bloco. Cada bloco começa com "Codigo:"
    
    const blocks = text.split(/Codigo:\s+/).filter(b => b.trim().length > 0 && !b.includes('LISTAGEM GERAL'));

    console.log(`Encontrados ${blocks.length} blocos potenciais.`);

    let count = 0;

    for (const block of blocks) {
      // Normalizar espaços para facilitar regex
      const cleanBlock = block.replace(/\s+/g, ' ').trim();
      
      // Tentar extrair campos
      // Codigo: já foi removido pelo split, mas o valor deve estar no inicio
      // Ex: "0189 Nome: TEREZINHA... Endereco: ..."
      
      const codeMatch = cleanBlock.match(/^(\d+)/);
      const code = codeMatch ? codeMatch[1] : null;

      if (!code) continue;

      const extract = (label: string, nextLabel?: string) => {
        if (nextLabel) {
           const regex = new RegExp(`${label}:\\s*(.*?)\\s*${nextLabel}:`);
           const match = cleanBlock.match(regex);
           return match ? match[1].trim() : null;
        } else {
           // Último campo da linha ou bloco
           const regex = new RegExp(`${label}:\\s*(.*)`);
           const match = cleanBlock.match(regex);
           return match ? match[1].trim() : null;
        }
      };

      const name = extract('Nome', 'Endereco');
      const address = extract('Endereco', 'Tel');
      const phone = extract('Tel', 'Bairro');
      const neighborhood = extract('Bairro', 'Cidade');
      const city = extract('Cidade', 'UF');
      const state = extract('UF', 'CEP');
      const zipCode = extract('CEP', 'CIC');
      const doc = extract('CIC', 'RG'); // CIC = CPF
      const rg = extract('RG', 'Est\\.Civil'); // Regex precisa escapar ponto
      
      // Est.Civil pode estar como Est.Civil:
      const maritalStatus = extract('Est\\.Civil', 'Naturalidade');
      const nationality = extract('Naturalidade', 'Profissao');
      const profession = extract('Profissao', 'Dt\\.Nascimento');
      const birthDate = extract('Dt\\.Nascimento', 'Quantidade de Imoveis');
      
      const propertyCountStr = extract('Quantidade de Imoveis', 'Banco');
      const propertyCount = propertyCountStr ? parseInt(propertyCountStr) : 0;
      
      const bank = extract('Banco', 'Agencia');
      const branch = extract('Agencia', 'Conta');
      const account = extract('Conta'); // Último campo relevante, mas pode ter lixo depois se não for o último

      // Limpeza final de account (pode pegar texto da próxima página se o split falhar)
      const cleanAccount = account ? account.split('PAG.:')[0].trim() : null;

      console.log(`Processando: ${code} - ${name}`);

      if (name && doc) {
         // Verificar se já existe pelo CPF (doc)
         const existing = await db.select().from(landlords).where(eq(landlords.doc, doc));
         
         if (existing.length > 0) {
            console.log(`Atualizando código para landlord existente: ${name} (${doc}) -> ${code}`);
            await db.update(landlords)
              .set({ code: code })
              .where(eq(landlords.id, existing[0].id));
         } else {
            // Verificar se já existe pelo Código (para evitar erro de constraint unique no code)
            const existingByCode = await db.select().from(landlords).where(eq(landlords.code, code));
            if (existingByCode.length > 0) {
               console.log(`Código ${code} já existe para outro landlord. Pulando inserção de ${name}.`);
               continue;
            }

            console.log(`Inserindo novo landlord: ${name}`);
            await db.insert(landlords).values({
               code,
               name,
               address,
               phone,
               neighborhood,
               city,
               state,
               zipCode,
               doc,
               rg,
               maritalStatus,
               nationality,
               profession,
               birthDate: birthDate === '/ /' ? null : birthDate, // Tratar data vazia
               propertyCount,
               bank,
               branch,
               account: cleanAccount,
               // Defaults
               pixKeyType: null,
               pixKey: null,
               email: null
            });
            count++;
         }
      }
    }
    
    console.log(`Importação concluída. ${count} novos proprietários inseridos.`);
    process.exit(0);

  } catch (error) {
    console.error("Erro na importação:", error);
    process.exit(1);
  }
}

importLandlords();
