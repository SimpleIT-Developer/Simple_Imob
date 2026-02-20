export type BankInfo = {
  code: string;
  shortName: string;
  ispb: string;
};

export const banksIspb: BankInfo[] = [
  { code: "001", shortName: "BANCO DO BRASIL S.A.", ispb: "00000000" },
  { code: "033", shortName: "BANCO SANTANDER (BRASIL) S.A.", ispb: "90400888" },
  { code: "104", shortName: "CAIXA ECONÔMICA FEDERAL", ispb: "00360305" },
  { code: "237", shortName: "BANCO BRADESCO S.A.", ispb: "60746948" },
  { code: "341", shortName: "ITAÚ UNIBANCO S.A.", ispb: "60701190" },
  { code: "356", shortName: "BANCO REAL S.A.", ispb: "60934221" },
  { code: "399", shortName: "HSBC BANK BRASIL S.A.", ispb: "60746948" },
  { code: "422", shortName: "BANCO SAFRA S.A.", ispb: "58160789" },
  { code: "453", shortName: "BANCO RURAL S.A.", ispb: "7656500" },
  { code: "655", shortName: "BANCO VOTORANTIM S.A.", ispb: "59588111" },
  { code: "748", shortName: "BANCO COOPERATIVO SICREDI S.A.", ispb: "01181521" },
  { code: "756", shortName: "BANCO COOPERATIVO DO BRASIL S.A. - BANCOOB", ispb: "02038232" },
];

export function getBankByCode(code: string): BankInfo | undefined {
  return banksIspb.find((b) => b.code === code);
}

export function getBankByShortName(shortName: string): BankInfo | undefined {
  return banksIspb.find((b) => b.shortName === shortName);
}
