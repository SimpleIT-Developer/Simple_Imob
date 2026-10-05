// XML de NFS-e Nacional SINTÉTICO (dados fictícios) para testes do DANFSe.
export const CHAVE_FICTICIA = "35503082200000000000000000000000000000000000000001";

export const NFSE_XML_FICTICIO = `<?xml version="1.0" encoding="UTF-8"?>
<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">
  <infNFSe Id="NFS${CHAVE_FICTICIA}">
    <xLocEmi>Sorocaba</xLocEmi>
    <xLocPrestacao>Sorocaba</xLocPrestacao>
    <nNFSe>123</nNFSe>
    <cLocIncid>3552205</cLocIncid>
    <xLocIncid>Sorocaba</xLocIncid>
    <xTribNac>Administração de imóveis</xTribNac>
    <verAplic>teste</verAplic>
    <ambGer>2</ambGer>
    <tpEmis>1</tpEmis>
    <cStat>100</cStat>
    <dhProc>2026-09-10T10:20:30-03:00</dhProc>
    <nDFSe>999</nDFSe>
    <emit>
      <CNPJ>11222333000181</CNPJ>
      <IM>12345</IM>
      <xNome>IMOBILIARIA FICTICIA LTDA</xNome>
      <enderNac><xLgr>Rua Teste</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>3552205</cMun><UF>SP</UF><CEP>18000000</CEP></enderNac>
      <fone>15999999999</fone>
      <email>teste@exemplo.com</email>
    </emit>
    <valores><vBC>720.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>14.40</vISSQN><vLiq>720.00</vLiq></valores>
    <DPS versao="1.01">
      <infDPS Id="DPS355220521122233300018100001000000000000123">
        <tpAmb>2</tpAmb>
        <dhEmi>2026-09-10T10:00:00-03:00</dhEmi>
        <verAplic>teste</verAplic>
        <serie>1</serie>
        <nDPS>123</nDPS>
        <dCompet>2026-09-01</dCompet>
        <tpEmit>1</tpEmit>
        <cLocEmi>3552205</cLocEmi>
        <prest>
          <CNPJ>11222333000181</CNPJ>
          <IM>12345</IM>
          <fone>15999999999</fone>
          <email>teste@exemplo.com</email>
          <regTrib><opSimpNac>1</opSimpNac><regEspTrib>0</regEspTrib></regTrib>
        </prest>
        <toma>
          <CPF>12345678909</CPF>
          <xNome>LOCATARIO FICTICIO</xNome>
          <end><endNac><cMun>3552205</cMun><CEP>18000000</CEP></endNac><xLgr>Av Exemplo</xLgr><nro>200</nro><xBairro>Jardim</xBairro></end>
        </toma>
        <serv>
          <locPrest><cLocPrestacao>3552205</cLocPrestacao></locPrest>
          <cServ><cTribNac>100401</cTribNac><xDescServ>Taxa de administração de aluguel - contrato ficticio</xDescServ></cServ>
        </serv>
        <valores>
          <vServPrest><vServ>720.00</vServ></vServPrest>
          <trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><indTotTrib>0</indTotTrib></totTrib></trib>
        </valores>
      </infDPS>
    </DPS>
  </infNFSe>
</NFSe>`;
