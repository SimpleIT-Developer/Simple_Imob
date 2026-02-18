
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const pdfPath = 'd:\\Imob_Simple\\Cadastros\\Proprietários\\relatorio pro.prn.pdf';

async function extractText() {
  console.log('Type of pdf:', typeof pdf);
  console.log('pdf content:', pdf);
  
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    // Tenta chamar como função ou acessar default
    const parser = typeof pdf === 'function' ? pdf : pdf.default;
    
    if (typeof parser !== 'function') {
      throw new Error('PDF Parser not found');
    }

    const data = await parser(dataBuffer);
    
    console.log("--- TEXTO EXTRAÍDO ---");
    console.log(data.text);
    console.log("--- FIM DO TEXTO ---");
    
  } catch (error) {
    console.error("Erro ao ler PDF:", error);
  }
}

extractText();
