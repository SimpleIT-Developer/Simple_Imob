
import 'dotenv/config';
import fs from 'fs';
import { createRequire } from 'module';
import { db } from '../server/db';
import { guarantors } from '../shared/schema';
import { eq } from 'drizzle-orm';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const pdfPath = 'd:\\Imob_Simple\\Cadastros\\Fiador\\CADASTRO FIADOR.prn.pdf';

async function importGuarantors() {
  try {
    if (!fs.existsSync(pdfPath)) {
      console.error(`Arquivo não encontrado: ${pdfPath}`);
      process.exit(1);
    }

    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    const text = data.text;

    // Regex strategy:
    // Split por "COD...:"
    const blocks = text.split(/COD\.\.\.:\s+/).filter(b => b.trim().length > 0 && !b.includes('EMPRESA:'));

    console.log(`Encontrados ${blocks.length} blocos potenciais.`);

    let count = 0;
    let skipped = 0;

    for (const block of blocks) {
      // Normalizar espaços
      const cleanBlock = block.replace(/\s+/g, ' ').trim();
      
      // O código está no início do bloco (0024 NOME: ...)
      const codeMatch = cleanBlock.match(/^(\d+)/);
      const code = codeMatch ? codeMatch[1] : null;

      if (!code) continue;

      const extract = (label: string, nextLabel?: string) => {
        let regexStr = '';
        if (nextLabel) {
           regexStr = `${label}:\\s*(.*?)\\s*${nextLabel}:`;
        } else {
           regexStr = `${label}:\\s*(.*)`;
        }
        
        const regex = new RegExp(regexStr);
        const match = cleanBlock.match(regex);
        return match ? match[1].trim() : null;
      };

      // Mapeamento baseado na imagem
      const name = extract('NOME', 'ENDERECO');
      const address = extract('ENDERECO', 'BAIRRO'); // Pode ter quebra de linha no meio, mas cleanBlock resolve
      // A ordem no cleanBlock será linear
      
      // Ajuste: BAIRRO vem depois de ENDERECO? Sim.
      // Ordem visual: 
      // Linha 1: COD... NOME ENDERECO
      // Linha 2: BAIRRO CIDADE UF CEP TEL CIC
      // Linha 3: R.G... EST.CIVIL PROFISSAO NASCIMENTO CLASSE
      // Linha 4: ESPOSA CIC.ESPOSA RG.ESPOSA

      // O cleanBlock lineariza tudo. Então a ordem dos labels é importante para o "nextLabel".
      // Vamos assumir a ordem de aparição no texto linearizado.
      
      // Mas espere, o PDF parse pode misturar colunas se não for "smart".
      // O pdf-parse geralmente extrai linha a linha da esquerda pra direita.
      // Se for assim:
      // COD...: 0024 NOME: ERICA ... ENDERECO: RUA ...
      // BAIRRO: COLINA ... CIDADE: TATUI UF: SP ...
      
      // Então a ordem relativa deve ser preservada.
      
      const neighborhood = extract('BAIRRO', 'CIDADE');
      const city = extract('CIDADE', 'UF');
      const state = extract('UF', 'CEP');
      const zipCode = extract('CEP', 'TEL');
      const phone = extract('TEL', 'CIC');
      const doc = extract('CIC', 'R\\.G\\.\\.\\.'); // CIC termina onde começa R.G...
      
      // R.G...: ... EST.CIVIL: ...
      const rg = extract('R\\.G\\.\\.\\.', 'EST\\.CIVIL');
      const maritalStatus = extract('EST\\.CIVIL', 'PROFISSAO');
      const profession = extract('PROFISSAO', 'NASCIMENTO');
      const birthDate = extract('NASCIMENTO', 'CLASSE');
      const classVal = extract('CLASSE', 'ESPOSA');
      
      const spouseName = extract('ESPOSA', 'CIC\\.ESPOSA');
      const spouseDoc = extract('CIC\\.ESPOSA', 'RG\\.ESPOSA');
      
      // RG.ESPOSA é o último? Pode haver lixo depois ou ser o fim do bloco.
      // O próximo bloco começa com COD...: (já removido pelo split)
      // Mas pode ter cabeçalho de página ou rodapé.
      // Vamos tentar pegar até o fim ou até algum padrão conhecido.
      // Como splitamos por COD...:, o fim deste bloco é o início do próximo.
      // O pdf-parse pode ter trazido cabeçalhos "EMPRESA: LF SIMOES..." que filtramos no split inicial?
      // O filter remove blocos que contêm 'EMPRESA:', mas e se o 'EMPRESA:' estiver no meio do bloco (fim da pagina)?
      // Vamos pegar RG.ESPOSA até o fim e limpar depois.
      let spouseRg = extract('RG\\.ESPOSA');
      if (spouseRg) {
          // Limpar qualquer lixo comum de rodapé/cabeçalho se houver
          // Ex: "123456 EMPRESA: LF SIMOES"
          spouseRg = spouseRg.split('EMPRESA:')[0].trim();
          // Remover numeração de página se houver
          spouseRg = spouseRg.split('PAG.:')[0].trim();
      }

      console.log(`Processando: ${code} - ${name}`);

      if (name && doc) {
         // Verificar se já existe pelo CPF (doc)
         const existing = await db.select().from(guarantors).where(eq(guarantors.doc, doc));
         
         if (existing.length > 0) {
            console.log(`Atualizando código para fiador existente: ${name} (${doc}) -> ${code}`);
            await db.update(guarantors)
                 .set({ code: code })
                 .where(eq(guarantors.id, existing[0].id));
            count++;
         } else {
            // Verificar duplicidade de código
            const existingCode = await db.select().from(guarantors).where(eq(guarantors.code, code));
            if (existingCode.length > 0) {
               console.log(`Código ${code} já existe para outro fiador. Pulando.`);
               skipped++;
               continue;
            }

            await db.insert(guarantors).values({
               code,
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
               birthDate: birthDate === '/ /' ? null : birthDate,
               class: classVal,
               spouseName,
               spouseDoc,
               spouseRg,
               // Campos opcionais não presentes no PDF
               email: null
            });
            count++;
         }
      }
    }
    
    console.log(`Importação concluída.`);
    console.log(`Inseridos: ${count}`);
    console.log(`Ignorados (já existentes): ${skipped}`);
    process.exit(0);

  } catch (error) {
    console.error("Erro na importação:", error);
    process.exit(1);
  }
}

importGuarantors();
