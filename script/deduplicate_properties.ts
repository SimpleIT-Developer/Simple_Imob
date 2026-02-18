
import 'dotenv/config';
import { db } from '../server/db';
import { properties, contracts } from '../shared/schema';
import { eq, inArray } from 'drizzle-orm';

async function deduplicateProperties() {
  console.log('Iniciando verificação de duplicidade de imóveis por endereço...');

  const allProperties = await db.select().from(properties);
  console.log(`Total de imóveis encontrados: ${allProperties.length}`);

  // Agrupar por endereço normalizado
  const groupedByAddress: Record<string, typeof allProperties> = {};

  // Função de normalização agressiva
  const normalizeAddress = (addr: string) => {
    return addr
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .replace(/[.,\-\/]/g, "") // Remove pontuação
      .replace(/\bn\b|\bnº\b|\bnumero\b/g, "") // Remove indicadores de número
      .replace(/\brua\b|\bavenida\b|\bav\b|\btravessa\b|\balameda\b|\bpraça\b/g, "") // Remove logradouros comuns
      .replace(/\s+/g, ""); // Remove espaços
  };

  for (const prop of allProperties) {
    // Ignorar se endereço estiver vazio
    if (!prop.address) continue;
    
    const key = normalizeAddress(prop.address);
    if (!groupedByAddress[key]) {
      groupedByAddress[key] = [];
    }
    groupedByAddress[key].push(prop);
  }

  let duplicatesFound = 0;
  let fixedCount = 0;

  for (const address in groupedByAddress) {
    const group = groupedByAddress[address];
    if (group.length > 1) {
      duplicatesFound++;
      console.log(`\nDuplicidade encontrada para: "${group[0].address}" (${group.length} registros)`);

      // Decidir quem fica (Winner)
      // Prioridade: Código manual (não começa com AUTO-) > Mais antigo (createdAt)
      group.sort((a, b) => {
        const aIsAuto = a.code.startsWith('AUTO-');
        const bIsAuto = b.code.startsWith('AUTO-');

        if (aIsAuto && !bIsAuto) return 1; // b vem primeiro
        if (!aIsAuto && bIsAuto) return -1; // a vem primeiro
        
        // Se ambos forem iguais (ambos auto ou ambos manual), o mais antigo ganha (menor data)
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      const winner = group[0];
      const losers = group.slice(1);

      console.log(`-> Mantendo: [${winner.code}] (ID: ${winner.id})`);
      
      for (const loser of losers) {
        console.log(`   -> Removendo: [${loser.code}] (ID: ${loser.id})`);
        
        // Atualizar contratos que apontam para o loser
        const relatedContracts = await db.select().from(contracts).where(eq(contracts.propertyId, loser.id));
        if (relatedContracts.length > 0) {
          console.log(`      -> Migrando ${relatedContracts.length} contratos para o imóvel principal...`);
          await db.update(contracts)
            .set({ propertyId: winner.id })
            .where(eq(contracts.propertyId, loser.id));
        }

        // Deletar o loser
        await db.delete(properties).where(eq(properties.id, loser.id));
        fixedCount++;
      }
    }
  }

  console.log('\n-----------------------------------');
  console.log(`Verificação concluída.`);
  console.log(`Grupos de duplicatas encontrados: ${duplicatesFound}`);
  console.log(`Imóveis redundantes removidos: ${fixedCount}`);
  
  process.exit(0);
}

deduplicateProperties().catch(err => {
  console.error(err);
  process.exit(1);
});
