
import 'dotenv/config';
import fs from 'fs';
import { createRequire } from 'module';
import { db } from '../server/db';
import { tenants } from '../shared/schema';
import { eq } from 'drizzle-orm';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const pdfPath = 'd:\\Imob_Simple\\Cadastros\\Locatários\\relatorio loca.prn.pdf';

async function importTenants() {
  try {
    if (!fs.existsSync(pdfPath)) {
      console.error(`Arquivo não encontrado: ${pdfPath}`);
      return;
    }

    console.log('Lendo arquivo PDF...');
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text;

    console.log('Extraindo dados...');
    // Split blocks by "Codigo:"
    // Filter out empty blocks or header blocks
    const blocks = text.split(/Codigo:\s+/).filter(b => b.trim().length > 0 && !b.includes('LISTAGEM GERAL'));

    console.log(`Encontrados ${blocks.length} blocos potenciais.`);

    let successCount = 0;
    let errorCount = 0;

    for (const block of blocks) {
      // Normalize whitespace: replace newlines and multiple spaces with single space
      const cleanBlock = block.replace(/\s+/g, ' ').trim();
      
      // Extract Code (at the beginning of the block)
      const codeMatch = cleanBlock.match(/^(\d+)/);
      const code = codeMatch ? codeMatch[1] : null;

      if (!code) {
        // console.log('Bloco ignorado (sem código):', cleanBlock.substring(0, 50) + '...');
        continue;
      }

      // Helper function for extraction
      const extract = (label: string, nextLabel?: string) => {
        let regex;
        if (nextLabel) {
           // Use [\s\S] to match across newlines
           regex = new RegExp(`${label}\\s*([\\s\\S]*?)\\s*${nextLabel}`);
        } else {
           regex = new RegExp(`${label}\\s*([\\s\S]*)`);
        }
        const match = cleanBlock.match(regex);
        return match ? match[1].trim() : null;
      };

      // Extract fields based on the pattern
      // Name might not have "Nome:" label, so we try to extract between Code and "Endereco:"
      let name = extract('Nome:', 'Endereco:');
      if (!name) {
        // Fallback: extract everything between the code and "Endereco:"
        // cleanBlock starts with "Code ... Name ... Endereco:"
        const nameRegex = new RegExp(`^\\d+\\s+([\\s\\S]*?)\\s*Endereco:`);
        const match = cleanBlock.match(nameRegex);
        if (match) {
          name = match[1].trim();
        }
      }

      const address = extract('Endereco:', 'Bairro:');
      const neighborhood = extract('Bairro:', 'Cidade:');
      const city = extract('Cidade:', 'Uf:');
      const state = extract('Uf:', 'CEP:');
      // CEP might be followed by "Tel:" or "Telefone:" or "CIC"
      // Use a more flexible lookahead if possible, or try multiple
      let zipCode = extract('CEP:', 'Tel:');
      if (!zipCode) zipCode = extract('CEP:', 'Telefone:');
      
      let phone = extract('Tel:', 'CIC\\.\\.\\.:');
      if (!phone) phone = extract('Telefone:', 'CIC\\.\\.\\.:');
      
      // If phone is still empty, maybe the label is missing or different layout?
      // In the PDF dump: "CEP: 18270-280   Tel:\n   CIC...: 027..."
      // The regex [\s\S]*? should catch the newline. 
      // If it's just spaces and newline, trim() makes it empty.

      const doc = extract('CIC\\.\\.\\.:', 'RG:');
      const rg = extract('RG:', 'Est\\.Civil:');
      const maritalStatus = extract('Est\\.Civil:', 'Profissao:');
      const profession = extract('Profissao:', 'Dt\\.Nas:');
      const birthDate = extract('Dt\\.Nas:', 'Classe:');
      const tenantClass = extract('Classe:'); // Last field

      // Clean up birthDate
      // Only keep if it has digits (valid date parts)
      const cleanBirthDate = (birthDate && /\d/.test(birthDate)) ? birthDate.trim() : null;

      if (!name || !doc) {
        console.warn(`Dados incompletos para código ${code}. Nome: ${name}, Doc: ${doc}`);
        errorCount++;
        continue;
      }

      console.log(`Processando: ${code} - ${name}`);

      // Check if exists by CPF (doc)
      const existing = await db.select().from(tenants).where(eq(tenants.doc, doc));
      
      const tenantData = {
        name,
        address,
        neighborhood,
        city,
        state,
        zipCode,
        phone,
        doc,
        rg,
        maritalStatus,
        profession,
        birthDate: cleanBirthDate,
        class: tenantClass,
      };

      if (existing.length > 0) {
        console.log(`Atualizando código para locatário existente: ${name} (${doc}) -> ${code}`);
        await db.update(tenants)
             .set({ code: code })
             .where(eq(tenants.id, existing[0].id));
        successCount++;
      } else {
        // Check if exists by Code to avoid unique constraint error
        const existingCode = await db.select().from(tenants).where(eq(tenants.code, code));
        if (existingCode.length > 0) {
             console.warn(`Código ${code} já existe. Pulando inserção de ${name}.`);
             errorCount++;
             continue;
        }

        await db.insert(tenants).values({
          code,
          ...tenantData,
          // pixKey fields are optional/null
        });
        successCount++;
      }
    }

    console.log('Importação concluída!');
    console.log(`Sucessos: ${successCount}`);
    console.log(`Erros/Ignorados: ${errorCount}`);

  } catch (error) {
    console.error('Erro na importação:', error);
  } finally {
    process.exit(0);
  }
}

importTenants();
