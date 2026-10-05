/**
 * Gerador do DANFSe v2.0 (NFS-e Padrão Nacional) conforme NT 008 v1.02 (14/07/2026).
 * Substitui a API do ADN /danfse (suspensa em 03/08/2026). Gera em Node/Worker com
 * pdf-lib (sem dependência do Fly). Coordenadas em cm da NT (ver docs/danfse-v2-mapa-campos.md).
 *
 * Fonte: Helvetica (≈Arial) — substituto padrão de PDF. A4 retrato, 1 página.
 */

import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import qrcode from 'qrcode-generator'
import { NFSE_LOGO_PNG_B64 } from './danfse-logo.js'
import { IBGE_MUNICIPIOS } from './danfse-ibge.js'

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const CM = 28.3465 // pt por cm
const PW = 21.0 // A4 largura cm
const PH = 29.7 // A4 altura cm
const GRAY_LINE = rgb(0.4, 0.4, 0.4)
const SHADE = rgb(0.93, 0.93, 0.93)
const BLACK = rgb(0, 0, 0)
const RED = rgb(0.85, 0, 0)
const WM_GRAY = rgb(0.65, 0.65, 0.65)

// ---------- XML helpers (navegação por caminho, sem DOM) ----------
function inner(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i').exec(xml)
  return m?.[1] ?? null
}
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
/** Conteúdo (texto limpo) do primeiro nó no caminho a/b/c. Decodifica entidades e remove tags (ex.: <br> no XML). */
function px(xml: string | null, path: string): string | null {
  if (!xml) return null
  let cur: string | null = xml
  for (const seg of path.split('/')) {
    if (!cur) return null
    cur = inner(cur, seg)
  }
  if (cur == null) return null
  const clean = decodeEntities(cur).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return clean || null
}
/** Subárvore (xml) do primeiro nó no caminho — para escopar blocos (prest/toma/…). */
function pnode(xml: string | null, path: string): string | null {
  if (!xml) return null
  let cur: string | null = xml
  for (const seg of path.split('/')) {
    if (!cur) return null
    cur = inner(cur, seg)
  }
  return cur
}

// ---------- formatadores ----------
const onlyDigits = (s: string) => s.replace(/\D+/g, '')
function fmtDoc(v: string | null): string {
  if (!v) return '-'
  const d = onlyDigits(v)
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return v
}
function fmtCep(v: string | null): string {
  if (!v) return ''
  const d = onlyDigits(v)
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, '$1-$2') : v
}
function fmtDate(v: string | null): string {
  if (!v) return '-'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v
}
function fmtDateTime(v: string | null): string {
  if (!v) return '-'
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(v)
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : fmtDate(v)
}
function fmtCompet(v: string | null): string {
  if (!v) return '-'
  const m = /^(\d{4})-(\d{2})/.exec(v)
  return m ? `${m[2]}/${m[1]}` : v
}
function fmtMoney(v: string | null): string {
  if (v == null || v === '') return '-'
  const n = Number(v)
  if (isNaN(n)) return v
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPerc(v: string | null): string {
  if (v == null || v === '') return '-'
  const n = Number(v)
  return isNaN(n) ? v : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
}

// ---------- descrições de enums (as principais da NT) ----------
const D_TPEMIT: Record<string, string> = { '1': 'Prestador', '2': 'Tomador', '3': 'Intermediário' }
const D_TPAMB: Record<string, string> = { '1': 'Produção', '2': 'Homologação' }
const D_AMBGER: Record<string, string> = { '1': 'Prefeitura', '2': 'Sistema Nacional NFS-e' }
const D_OPSN: Record<string, string> = { '1': 'Não Optante', '2': 'Optante - MEI', '3': 'Optante - ME/EPP' }
const D_REGAPSN: Record<string, string> = { '1': 'Regime de apuração dos tributos federais e municipal pelo SN', '2': 'Regime de apuração dos tributos federais pelo SN e ISSQN por fora', '3': 'Regime de apuração dos tributos federais e municipal por fora do SN' }
const D_TRIBISSQN: Record<string, string> = { '1': 'Operação Tributável', '2': 'Exportação de Serviço', '3': 'Não Incidência', '4': 'Imunidade' }
const D_TPRETISSQN: Record<string, string> = { '1': 'Não Retido', '2': 'Retido pelo Tomador', '3': 'Retido pelo Intermediário' }
const D_REGESPTRIB: Record<string, string> = { '0': 'Nenhum', '1': 'Ato Cooperado', '2': 'Estimativa', '3': 'Microempresa Municipal', '4': 'Notário/Registrador', '5': 'Profissional Autônomo', '6': 'Sociedade de Profissionais', '9': 'Outros' }
const D_FINNFSE: Record<string, string> = { '1': 'NFS-e regular', '2': 'NFS-e de Ajuste', '3': 'NFS-e de Decisão Judicial ou Administrativa' }
const D_CSTAT: Record<string, string> = { '100': 'NFS-e emitida', '101': 'NFS-e cancelada', '102': 'NFS-e substituída' }
const D_TPRETPISCOFINS: Record<string, string> = { '1': 'PIS/COFINS Retido', '2': 'PIS/COFINS Não Retido' }
const descr = (map: Record<string, string>, code: string | null, prefix = ''): string => (code ? map[code] ?? `${prefix}${code}` : '-')

// ---------- render ----------
export interface DanfseOptions {
  cancelada?: boolean
  substituida?: boolean
}

export async function generateDanfseV2(xml: string, opts: DanfseOptions = {}): Promise<Uint8Array> {
  const nfse = pnode(xml, 'NFSe/infNFSe') ?? pnode(xml, 'infNFSe') ?? xml
  const infDPS = pnode(nfse, 'DPS/infDPS')
  const emit = pnode(nfse, 'emit') // identificação do prestador (nome/endereço) fica aqui
  const prest = pnode(infDPS, 'prest') // no DPS: só CNPJ/IM/regTrib
  const toma = pnode(infDPS, 'toma')
  const ibscbs = pnode(infDPS, 'IBSCBS')
  const dest = pnode(ibscbs, 'dest')
  const interm = pnode(infDPS, 'interm')
  const serv = pnode(infDPS, 'serv')
  const valores = pnode(infDPS, 'valores')
  const tribMun = pnode(valores, 'trib/tribMun')
  const tribFed = pnode(valores, 'trib/tribFed')
  const infNfseValores = pnode(nfse, 'valores')
  const infIbscbs = pnode(nfse, 'IBSCBS')

  const tpAmb = px(infDPS, 'tpAmb')
  const homolog = tpAmb === '2'
  // Chave = atributo Id de <infNFSe Id="NFS..."> (sem o prefixo "NFS").
  const idAttr = /<(?:[\w.-]+:)?infNFSe[^>]*\bId="([^"]*)"/i.exec(xml)?.[1] ?? ''
  const chave = onlyDigits(idAttr.replace(/^NFS/i, ''))
  const munEmitNome = px(nfse, 'xLocEmi') // nome do município do emitente/prestador

  const doc = await PDFDocument.create()
  const page = doc.addPage([PW * CM, PH * CM])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold)

  // origem topo → pdf-lib (origem embaixo). yTop(sup) = y da BORDA SUPERIOR daquele campo.
  const yTop = (supCm: number) => PH * CM - supCm * CM
  const clamp = (s: string, f: PDFFont, size: number, maxCm: number) => {
    const maxW = maxCm * CM - 4
    if (f.widthOfTextAtSize(s, size) <= maxW) return s
    let t = s
    while (t.length > 1 && f.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1)
    return t + '...'
  }
  const box = (esq: number, sup: number, w: number, h: number, shade = false) =>
    page.drawRectangle({ x: esq * CM, y: yTop(sup) - h * CM, width: w * CM, height: h * CM, borderColor: GRAY_LINE, borderWidth: 0.5, ...(shade ? { color: SHADE } : {}) })
  const txt = (s: string, esq: number, supPt: number, size: number, f: PDFFont, color = BLACK) =>
    page.drawText(s, { x: esq * CM + 2, y: yTop(0) - supPt, size, font: f, color })
  // célula = box + label (topo) + valor (abaixo)
  const cell = (label: string, value: string, esq: number, sup: number, w: number, h: number, o: { labelSize?: number; shade?: boolean } = {}) => {
    box(esq, sup, w, h, o.shade)
    const ls = o.labelSize ?? 6
    txt(label, esq, sup * CM + ls + 1.5, ls, fontB)
    txt(clamp(value || '-', font, 7, w), esq, sup * CM + ls + 9, 7, font)
  }
  // título de bloco (faixa cinza, 7pt negrito CAIXA ALTA)
  const blockTitle = (label: string, sup: number, esq = 0.3, w = 20.4, h = 0.32) => {
    box(esq, sup, w, h, true)
    txt(label.toUpperCase(), esq, sup * CM + 8, 7, fontB)
  }

  // ===== CABEÇALHO =====
  box(0.3, 0.3, 20.4, 1.16, true)
  // logomarca oficial da NFS-e (embutida). Encaixa no quadro 4,00 x 0,85cm preservando proporção.
  try {
    const logo = await doc.embedPng(b64ToBytes(NFSE_LOGO_PNG_B64))
    const maxW = 4.0 * CM
    const maxH = 0.85 * CM
    const scale = Math.min(maxW / logo.width, maxH / logo.height)
    const w = logo.width * scale
    const h = logo.height * scale
    page.drawImage(logo, { x: 0.49 * CM, y: yTop(0.44) - h - (maxH - h) / 2, width: w, height: h })
  } catch {
    txt('NFS-e', 0.55, 0.3 * CM + 24, 14, fontB, rgb(0.2, 0.35, 0.75))
  }
  // centro: título
  page.drawText('DANFSe v2.0', { x: 5.41 * CM + (10.19 * CM) / 2 - fontB.widthOfTextAtSize('DANFSe v2.0', 11) / 2, y: yTop(0.3) - 16, size: 11, font: fontB })
  page.drawText('Documento Auxiliar da NFS-e', { x: 5.41 * CM + (10.19 * CM) / 2 - font.widthOfTextAtSize('Documento Auxiliar da NFS-e', 8) / 2, y: yTop(0.3) - 28, size: 8, font: fontB })
  if (homolog)
    page.drawText('NFS-e SEM VALIDADE JURÍDICA', { x: 5.41 * CM + (10.19 * CM) / 2 - fontB.widthOfTextAtSize('NFS-e SEM VALIDADE JURÍDICA', 9) / 2, y: yTop(0.3) - 40, size: 9, font: fontB, color: RED })
  // direita: município / ambiente
  const ufEmit = px(emit, 'enderNac/UF') ?? ''
  txt(clamp(`Município: ${munEmitNome ?? '-'}${ufEmit ? ' / ' + ufEmit : ''}`, font, 8, 5.09), 15.62, 0.3 * CM + 12, 8, font)
  txt(`Ambiente Gerador: ${descr(D_AMBGER, px(nfse, 'ambGer'))}`, 15.62, 0.97 * CM + 6, 6, font)
  txt(`Tipo de Ambiente: ${descr(D_TPAMB, tpAmb)}`, 15.62, 1.22 * CM + 6, 6, font)

  // QR Code
  drawQr(page, `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${chave}`, 17.48, 1.67, 1.52)
  box(15.8, 3.36, 4.72, 0.68)
  const qrTxt = 'A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e'
  wrap(page, qrTxt, 15.8, 3.36, 4.72, 6, font, yTop)

  // ===== DADOS DA NFS-e ===== (sem faixa de título — a chave é a 1ª linha, como no Anexo I)
  cell('CHAVE DE ACESSO DA NFS-E', chave.replace(/(.{4})/g, '$1 ').trim(), 0.3, 1.48, 15.3, 0.77, { labelSize: 7 })
  cell('NÚMERO DA NFS-E', px(nfse, 'nNFSe') ?? '-', 0.3, 2.27, 5.09, 0.67, { labelSize: 7 })
  cell('COMPETÊNCIA', fmtCompet(px(infDPS, 'dCompet')), 5.41, 2.27, 5.09, 0.67, { labelSize: 7 })
  cell('EMISSÃO NFS-E', fmtDateTime(px(nfse, 'dhProc')), 10.51, 2.27, 5.09, 0.67, { labelSize: 7 })
  cell('NÚMERO DA DPS', px(infDPS, 'nDPS') ?? '-', 0.3, 2.96, 5.09, 0.67, { labelSize: 7 })
  cell('SÉRIE DA DPS', px(infDPS, 'serie') ?? '-', 5.41, 2.96, 5.09, 0.67, { labelSize: 7 })
  cell('EMISSÃO DA DPS', fmtDateTime(px(infDPS, 'dhEmi')), 10.51, 2.96, 5.09, 0.67, { labelSize: 7 })
  cell('EMITENTE DA NFS-E', descr(D_TPEMIT, px(infDPS, 'tpEmit')), 0.3, 3.65, 5.09, 0.67, { labelSize: 7, shade: true })
  cell('SITUAÇÃO DA NFS-E', descr(D_CSTAT, px(nfse, 'cStat')), 5.41, 3.65, 5.09, 0.67, { labelSize: 7 })
  cell('FINALIDADE', descr(D_FINNFSE, px(ibscbs, 'finNFSe')), 10.51, 3.65, 5.09, 0.67, { labelSize: 7 })

  // ===== PRESTADOR / FORNECEDOR =====
  partyBlock('Prestador / Fornecedor', emit, 4.34, { im: true, munName: munEmitNome, regTribNode: pnode(prest, 'regTrib') })

  // ===== TOMADOR / ADQUIRENTE =====
  if (hasParty(toma)) partyBlock('Tomador / Adquirente', toma, 6.92, { im: true })
  else emptyBlock('Tomador / Adquirente', 'TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', 6.92)

  // ===== DESTINATÁRIO =====
  if (hasParty(dest)) partyBlock('Destinatário da Operação', dest, 8.86, {})
  else emptyBlock('Destinatário da Operação', 'DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', 8.86)

  // ===== INTERMEDIÁRIO =====
  if (hasParty(interm)) partyBlock('Intermediário da Operação', interm, 10.8, { im: true })
  else emptyBlock('Intermediário da Operação', 'INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e', 10.8)

  // ===== SERVIÇO PRESTADO =====
  blockTitle('Serviço Prestado', 12.74)
  const cServ = pnode(serv, 'cServ')
  cell('Cód. Trib. Nacional / Municipal', `${px(cServ, 'cTribNac') ?? px(nfse, 'cTribNac') ?? '-'} / ${px(cServ, 'cTribMun') ?? px(nfse, 'cTribMun') ?? '-'}`, 5.41, 12.74, 5.09, 0.63)
  cell('Código da NBS', px(cServ, 'cNBS') ?? '-', 10.51, 12.74, 5.09, 0.63)
  cell('Local Prestação / UF / País', `${px(nfse, 'xLocPrestacao') ?? '-'}`, 15.62, 12.74, 5.09, 0.63)
  // Descrição do Cód. de Tributação (linha fina, sem label) — encosta na linha do serviço.
  box(0.3, 13.39, 20.4, 0.4)
  txt(clamp(px(cServ, 'xTribMun') || px(cServ, 'xTribNac') || '-', font, 7, 20.4), 0.3, 13.39 * CM + 11, 7, font)
  // Descrição do Serviço — label no topo do quadro, texto 1 linha abaixo (sem sobrepor).
  box(0.3, 13.79, 20.4, 0.64)
  txt('Descrição do Serviço', 0.3, 13.79 * CM + 7, 6, fontB)
  txt(clamp(px(cServ, 'xDescServ') || '-', font, 7, 20.4), 0.3, 13.79 * CM + 16, 7, font)

  // ===== TRIBUTAÇÃO MUNICIPAL (ISSQN) =====
  blockTitle('Tributação Municipal (ISSQN)', 14.43)
  cell('BC ISSQN', fmtMoney(px(infNfseValores, 'vBC')), 0.3, 15.08, 5.09, 0.63)
  cell('Alíquota Aplicada', fmtPerc(px(infNfseValores, 'pAliqAplic')), 5.41, 15.08, 5.09, 0.63)
  cell('Retenção do ISSQN', descr(D_TPRETISSQN, px(tribMun, 'tpRetISSQN')), 10.51, 15.08, 5.09, 0.63)
  cell('ISSQN Apurado', fmtMoney(px(infNfseValores, 'vISSQN')), 15.62, 15.08, 5.09, 0.63)
  cell('Tipo de Tributação do ISSQN', descr(D_TRIBISSQN, px(tribMun, 'tribISSQN')), 0.3, 15.73, 10.19, 0.63)
  cell('Regime Especial de Tributação', descr(D_REGESPTRIB, px(prest, 'regTrib/regEspTrib')), 10.51, 15.73, 10.19, 0.63)

  // ===== TRIBUTAÇÃO FEDERAL =====
  blockTitle('Tributação Federal (exceto CBS)', 16.4)
  cell('IRRF', fmtMoney(px(tribFed, 'vRetIRRF')), 0.3, 17.02, 5.09, 0.63)
  cell('Contrib. Previdenciária Retida', fmtMoney(px(tribFed, 'vRetCP')), 5.41, 17.02, 5.09, 0.63)
  cell('Contribuições Sociais Retidas', fmtMoney(px(tribFed, 'vRetCSLL')), 10.51, 17.02, 5.09, 0.63)
  cell('Desc. Contrib. Sociais', descr(D_TPRETPISCOFINS, px(tribFed, 'piscofins/tpRetPisCofins')), 15.62, 17.02, 5.09, 0.63)

  // ===== TRIBUTAÇÃO IBS / CBS =====
  blockTitle('Tributação IBS / CBS', 17.67)
  const ibVal = pnode(ibscbs, 'valores')
  cell('CST / cClassTrib', `${px(ibVal, 'trib/gIBSCBS/CST') ?? '-'} / ${px(ibVal, 'trib/gIBSCBS/cClassTrib') ?? '-'}`, 0.3, 18.32, 5.09, 0.63)
  cell('BC após Exclusões/Reduções', fmtMoney(px(ibVal, 'vBC')), 5.41, 18.32, 5.09, 0.63)
  cell('Alíquota CBS', fmtPerc(px(ibVal, 'fed/pCBS')), 10.51, 18.32, 5.09, 0.63)
  cell('Valor Apurado CBS', fmtMoney(px(infIbscbs, 'totCIBS/gCBS/vCBS')), 15.62, 18.32, 5.09, 0.63)
  cell('Valor Apurado IBS UF', fmtMoney(px(infIbscbs, 'totCIBS/gIBS/gIBSUFTot/vIBSUF')), 0.3, 18.96, 5.09, 0.63)
  cell('Valor Apurado IBS Mun', fmtMoney(px(infIbscbs, 'totCIBS/gIBS/gIBSMunTot/vIBSMun')), 5.41, 18.96, 5.09, 0.63)
  cell('Valor Total Apurado IBS', fmtMoney(px(infIbscbs, 'totCIBS/gIBS/vIBSTot')), 10.51, 18.96, 5.09, 0.63)
  cell('Total IBS/CBS', fmtMoney(px(infIbscbs, 'totCIBS/vTotNF')), 15.62, 18.96, 5.09, 0.63)

  // ===== VALOR TOTAL DA NFS-e =====
  blockTitle('Valor Total da NFS-e', 19.61)
  cell('Valor da Operação / Serviço', fmtMoney(px(valores, 'vServPrest/vServ')), 0.3, 20.26, 5.09, 0.67)
  cell('Desconto Incondicionado', fmtMoney(px(valores, 'vDescCondIncond/vDescIncond')), 5.41, 20.26, 5.09, 0.67)
  cell('Desconto Condicionado', fmtMoney(px(valores, 'vDescCondIncond/vDescCond')), 10.51, 20.26, 5.09, 0.67)
  cell('Total das Retenções', fmtMoney(px(infNfseValores, 'vTotalRet')), 15.62, 20.26, 5.09, 0.67)
  cell('Valor Líquido da NFS-e', fmtMoney(px(infNfseValores, 'vLiq')), 0.3, 20.95, 10.19, 0.67)
  cell('VALOR LÍQUIDO DA NFS-e + IBS/CBS', fmtMoney(px(infIbscbs, 'totCIBS/vTotNF') ?? px(infNfseValores, 'vLiq')), 10.51, 20.95, 10.19, 0.67, { labelSize: 7, shade: true })

  // ===== INFORMAÇÕES COMPLEMENTARES =====
  blockTitle('Informações Complementares', 21.62)
  box(0.3, 21.94, 20.4, 5.9)
  const infoParts: string[] = []
  const add = (label: string, v: string | null) => { if (v) infoParts.push(`${label} ${v}`) }
  add('Inf. Cont.:', px(serv, 'infoCompl/xInfComp'))
  add('NFS-e Subst.:', px(infDPS, 'subst/chSubstda'))
  add('Cod. Obra:', px(serv, 'obra/cObra'))
  add('Cod. Evt.:', px(serv, 'atvEvento/idAtvEvt'))
  const totFed = px(valores, 'trib/totTrib/vTotTrib/vTotTribFed')
  const totEst = px(valores, 'trib/totTrib/vTotTrib/vTotTribEst')
  const totMun = px(valores, 'trib/totTrib/vTotTrib/vTotTribMun')
  infoParts.push(`Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: R$ ${fmtMoney(totFed)} ; Estaduais: R$ ${fmtMoney(totEst)} ; Municipais: R$ ${fmtMoney(totMun)}`)
  wrap(page, infoParts.join(' | '), 0.3, 22.0, 20.4, 7, font, yTop, 8)

  // ===== CANHOTO ===== (rodapé, Anexo I Nota 11) — Data de Cientificação · Assinatura · Nº/Chave
  const cnh = 28.1
  box(0.3, cnh, 5.09, 1.2)
  txt('DATA DE CIENTIFICAÇÃO', 0.3, cnh * CM + 8, 6, fontB)
  box(5.41, cnh, 5.1, 1.2)
  txt('IDENTIFICAÇÃO E ASSINATURA', 5.41, cnh * CM + 8, 6, fontB)
  box(10.51, cnh, 10.19, 1.2)
  txt('Nº DA NFS-E / CHAVE DE ACESSO', 10.51, cnh * CM + 8, 6, fontB)
  txt(px(nfse, 'nNFSe') ?? '-', 10.51, cnh * CM + 20, 7, font)
  txt(clamp(chave.replace(/(.{4})/g, '$1 ').trim(), font, 6, 10.19), 10.51, cnh * CM + 30, 6, font)

  // ===== MARCA D'ÁGUA ===== (opts do documento OU cStat do XML: 101=cancelada, 102=substituída)
  const cStat = px(nfse, 'cStat')
  const wm = opts.cancelada || cStat === '101' ? 'CANCELADA' : opts.substituida || cStat === '102' ? 'SUBSTITUÍDA' : null
  if (wm) {
    page.drawText(wm, { x: 2 * CM, y: (PH / 2) * CM, size: 60, font: fontB, color: WM_GRAY, rotate: degrees(35), opacity: 0.5 })
  }

  return doc.save()

  // ---- helpers de bloco (fecham sobre `page`, `font`, etc.) ----
  function hasParty(node: string | null): boolean {
    return !!node && !!(px(node, 'CNPJ') || px(node, 'CPF') || px(node, 'NIF') || px(node, 'xNome'))
  }
  function emptyBlock(title: string, msg: string, sup: number) {
    blockTitle(title, sup)
    box(0.3, sup + 0.32, 20.4, 0.32)
    txt(msg, 0.3, (sup + 0.32) * CM + 8, 6, fontB)
  }
  function partyBlock(title: string, node: string | null, sup: number, o: { im?: boolean; munName?: string | null; regTribNode?: string | null }) {
    blockTitle(title, sup)
    const endNac = pnode(node, 'enderNac') ?? pnode(node, 'end/endNac') // emit usa enderNac; toma/dest/interm usam end/endNac
    const endExt = pnode(node, 'enderExt') ?? pnode(node, 'end/endExt')
    const docv = px(node, 'CNPJ') ?? px(node, 'CPF') ?? px(node, 'NIF')
    const r1 = sup + 0.32
    // Nome do município: tag de nome (xLoc*) quando houver; senão resolve o código IBGE (cMun).
    const cMun = px(endNac, 'cMun')
    const munNome = o.munName ?? px(endExt, 'xCidade') ?? (cMun ? IBGE_MUNICIPIOS[cMun] ?? cMun : '-')
    cell('CNPJ / CPF / NIF', fmtDoc(docv), 0.3, r1, 5.09, 0.63)
    cell('Ind. Municipal', o.im ? px(node, 'IM') ?? '-' : '-', 5.41, r1, 5.09, 0.63)
    cell('Telefone', px(node, 'fone') ?? '-', 10.51, r1, 5.09, 0.63)
    cell('Município / UF', `${munNome}${px(endNac, 'UF') ? ' / ' + px(endNac, 'UF') : ''}`, 15.62, r1, 5.09, 0.63)
    const r2 = r1 + 0.63
    const cep = px(endNac, 'CEP') ?? px(endExt, 'cEndPost')
    cell('Nome / Nome Empresarial', px(node, 'xNome') ?? '-', 0.3, r2, 8.5, 0.63)
    // Endereço SEM o CEP (que agora tem coluna própria "Cód. IBGE / CEP").
    const endStr = [px(endNac, 'xLgr'), px(endNac, 'nro'), px(endNac, 'xCpl'), px(endNac, 'xBairro')].filter(Boolean).join(', ')
    cell('Endereço / E-mail', `${endStr || '-'}${px(node, 'email') ? ' · ' + px(node, 'email') : ''}`, 8.8, r2, 7.61, 0.63)
    cell('Cód. IBGE / CEP', `${cMun ?? '-'} / ${cep ? fmtCep(cep) : '-'}`, 16.41, r2, 4.29, 0.63)
    if (o.regTribNode) {
      const r3 = r2 + 0.63
      cell('Simples Nacional (Competência)', descr(D_OPSN, px(o.regTribNode, 'opSimpNac')), 0.3, r3, 10.19, 0.63)
      cell('Regime de Apuração pelo SN', descr(D_REGAPSN, px(o.regTribNode, 'regApTribSN')), 10.51, r3, 10.19, 0.63)
    }
  }
}

// QR desenhado como retângulos pretos (sem imagem — Worker-safe).
function drawQr(page: PDFPage, url: string, esqCm: number, supCm: number, sizeCm: number) {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  const cell = (sizeCm * CM) / n
  const x0 = esqCm * CM
  const y0 = PH * CM - supCm * CM - sizeCm * CM
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) page.drawRectangle({ x: x0 + c * cell, y: y0 + (n - 1 - r) * cell, width: cell + 0.3, height: cell + 0.3, color: BLACK })
}

// Quebra de texto em N linhas dentro de uma largura (métrica exata via font).
function wrap(page: PDFPage, text: string, esqCm: number, supCm: number, wCm: number, size: number, font: PDFFont, yTop: (c: number) => number, maxLines = 3) {
  const maxW = wCm * CM - 4
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w
    if (font.widthOfTextAtSize(t, size) > maxW && cur) {
      lines.push(cur)
      cur = w
      if (lines.length >= maxLines) break
    } else cur = t
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  lines.slice(0, maxLines).forEach((ln, i) => page.drawText(ln, { x: esqCm * CM + 2, y: yTop(supCm) - size - 2 - i * (size + 2), size, font }))
}
