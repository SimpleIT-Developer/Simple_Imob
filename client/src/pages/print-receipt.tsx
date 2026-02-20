import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "wouter";
import { Loader2, Printer, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import type { Receipt, Contract, Property, Tenant, Landlord, Service } from "@shared/schema";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

type PublicPrintData = {
  receipt: Receipt;
  contract: Contract;
  property: Property;
  tenant: Tenant;
  landlord: Landlord;
  services: Service[];
};

export default function PrintReceiptPage({ publicMode = false }: { publicMode?: boolean } = {}) {
  const { id } = useParams();
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const type = searchParams.get("type") as "tenant" | "landlord" | null;
  const { toast } = useToast();

  const {
    data: receiptPrivate,
    isLoading: isLoadingReceipt,
    isError: isReceiptError,
  } = useQuery<Receipt>({
    queryKey: [`/api/receipts/${id}`],
    enabled: !publicMode && !!id,
  });

  const { data: contractPrivate, isLoading: isLoadingContract } = useQuery<Contract>({
    queryKey: [`/api/contracts/${receiptPrivate?.contractId}`],
    enabled: !publicMode && !!receiptPrivate,
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    enabled: !publicMode && !!contractPrivate,
  });
  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ["/api/tenants"],
    enabled: !publicMode && !!contractPrivate,
  });
  const { data: landlords } = useQuery<Landlord[]>({
    queryKey: ["/api/landlords"],
    enabled: !publicMode && !!contractPrivate,
  });

  const {
    data: servicesPrivate,
    isLoading: isLoadingServices,
  } = useQuery<Service[]>({
    queryKey: ["contract-services", receiptPrivate?.contractId, receiptPrivate?.refYear, receiptPrivate?.refMonth],
    queryFn: async () => {
      if (!receiptPrivate) return [];
      const res = await fetch(
        `/api/contracts/${receiptPrivate.contractId}/services/${receiptPrivate.refYear}/${receiptPrivate.refMonth}`,
      );
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json();
    },
    enabled: !publicMode && !!receiptPrivate,
  });

  const {
    data: publicData,
    isLoading: isLoadingPublic,
    isError: isPublicError,
  } = useQuery<PublicPrintData>({
    queryKey: [`/api/public/receipts/${id}/print`],
    enabled: publicMode && !!id,
  });

  useEffect(() => {
    const baseReceipt = publicMode ? publicData?.receipt : receiptPrivate;
    const baseContract = publicMode ? publicData?.contract : contractPrivate;

    if (baseReceipt && baseContract) {
      document.title = `Recibo - ${
        type === "tenant" ? "Locatário" : "Proprietário"
      } - ${String(baseReceipt.refMonth).padStart(2, "0")}/${baseReceipt.refYear}`;
    }
  }, [publicMode, publicData, receiptPrivate, contractPrivate, type]);

  if (publicMode) {
    if (isLoadingPublic || !publicData) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2">Carregando recibo...</span>
        </div>
      );
    }

    if (isPublicError) {
      return <div className="p-8 text-center text-red-500">Recibo não encontrado.</div>;
    }
  } else if (isLoadingReceipt) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Carregando recibo...</span>
      </div>
    );
  }

  if (!publicMode && (isReceiptError || !receiptPrivate)) {
    return <div className="p-8 text-center text-red-500">Recibo não encontrado.</div>;
  }

  if (!publicMode && isLoadingContract) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Carregando contrato...</span>
      </div>
    );
  }

  if (!publicMode && !contractPrivate) {
    return <div className="p-8 text-center text-red-500">Contrato não encontrado.</div>;
  }

  if (
    !publicMode &&
    (!properties || !tenants || !landlords || isLoadingServices || !servicesPrivate)
  ) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Carregando dados complementares...</span>
      </div>
    );
  }

  let receipt: Receipt;
  let contract: Contract;
  let property: Property;
  let tenant: Tenant;
  let landlord: Landlord;
  let services: Service[];

  if (publicMode) {
    if (!publicData) {
      return <div className="p-8 text-center text-red-500">Recibo não encontrado.</div>;
    }

    receipt = publicData.receipt;
    contract = publicData.contract;
    property = publicData.property;
    tenant = publicData.tenant;
    landlord = publicData.landlord;
    services = publicData.services || [];
  } else {
    const propertyFound = properties!.find(p => p.id === contractPrivate!.propertyId);
    const tenantFound = tenants!.find(t => t.id === contractPrivate!.tenantId);
    const landlordFound = landlords!.find(l => l.id === contractPrivate!.landlordId);

    if (!propertyFound || !tenantFound || !landlordFound) {
      return <div className="p-8 text-center text-red-500">Dados do contrato incompletos.</div>;
    }

    receipt = receiptPrivate!;
    contract = contractPrivate!;
    property = propertyFound;
    tenant = tenantFound;
    landlord = landlordFound;
    services = servicesPrivate || [];
  }

  const handleShareWhatsApp = () => {
    if (!id || !type) return;

    const publicLink = `${window.location.origin}/public/receipts/${id}/print?type=${type}`;
    const refMonthName = new Date(
      receipt.refYear,
      receipt.refMonth - 1,
    ).toLocaleString("pt-BR", { month: "long" });
    const referencia = `${refMonthName}/${receipt.refYear}`;

    const landlordFirstName = landlord.name.split(" ")[0] || landlord.name;
    const tenantFirstName = tenant.name.split(" ")[0] || tenant.name;

    const message =
      type === "tenant"
        ? `Olá ${tenantFirstName}, segue o seu recibo de aluguel referente a ${referencia} do imóvel ${property.address}.\nProprietário: ${landlord.name}.\n\nAcesse o recibo pelo link: ${publicLink}`
        : `Olá ${landlordFirstName}, segue o extrato de repasse referente a ${referencia} do imóvel ${property.address}.\n\nAcesse o extrato pelo link: ${publicLink}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");

    toast({
      title: "Link gerado para envio",
      description:
        "O envio direto de arquivo pode falhar em alguns dispositivos. Enviando link para impressão.",
    });
  };

  // Filter items based on type
  const items: Array<{ description: string; value: number; type: "credit" | "debit" }> = [];

  if (type === "tenant") {
    // Tenant View
    // 1. Rent (Debit) com descontos configurados para "Descontar de: Locatário/Proprietário"
    const tenantDiscountTotal = (services || [])
      .filter(s => (s as any).discountFrom === "TENANT")
      .reduce((sum, s) => sum + Number(s.amount), 0);

    const originalRent = Number(receipt.rentAmount);
    const adjustedRentTenant = Math.max(0, originalRent - tenantDiscountTotal);

    items.push({
      description: "Aluguel",
      value: adjustedRentTenant,
      type: "debit",
    });

    // 2. Services charged to Tenant (Debit or Credit) — sempre aparecem no recibo,
    // mesmo quando fazem parte do desconto de aluguel
    services
      ?.filter(s => s.chargedTo === "TENANT")
      .forEach(s => {
        const amount = Number(s.amount);
        const isCredit = amount < 0;

        items.push({
          description: s.description,
          value: Math.abs(amount),
          type: isCredit ? "credit" : "debit",
        });
      });

    // Total Due is calculated based on visible items
  } else {
    // Landlord View
    // 1. Rent (Credit) com descontos configurados para "Descontar de: Proprietário"
    const landlordDiscountTotal = (services || [])
      .filter(s => (s as any).discountFrom === "LANDLORD" || (s as any).discountFrom === "TENANT")
      .reduce((sum, s) => sum + Number(s.amount), 0);

    const originalRent = Number(receipt.rentAmount);
    const adjustedRent = Math.max(0, originalRent - landlordDiscountTotal);

    items.push({
      description: "Aluguel",
      value: adjustedRent,
      type: "credit"
    });

    // 2. Admin Fee (Debit)
    const adminFeePercent = Number(receipt.adminFeePercent);
    const adminFee = Math.max(0, adjustedRent * (adminFeePercent / 100));
    if (adminFee > 0) {
      items.push({
        description: `Taxa de Administração (${adminFeePercent}%)`,
        value: adminFee,
        type: "debit"
      });
    }

    // 3. Services charged to Landlord (Debit) — exceto os marcados para descontar do Proprietário/Locatário
    services
      ?.filter(
        s =>
          s.chargedTo === "LANDLORD" &&
          (s as any).discountFrom !== "LANDLORD" &&
          (s as any).discountFrom !== "TENANT",
      )
      .forEach(s => {
      items.push({
        description: s.description,
        value: Number(s.amount),
        type: "debit"
      });
    });

    // 4. Services with "Repassar valor" marcado (Credit)
    services?.filter(s => (s as any).passThrough).forEach(s => {
      items.push({
        description: `REPASSE - ${s.description}`,
        value: Number(s.amount),
        type: "credit"
      });
    });
  }

  const totalValue =
    type === "tenant"
      ? items.reduce(
          (acc, curr) => (curr.type === "debit" ? acc + curr.value : acc - curr.value),
          0,
        )
      : items.reduce(
          (acc, curr) => (curr.type === "credit" ? acc + curr.value : acc - curr.value),
          0,
        );

  // Helper to format currency
  const fmt = (val: number) => val.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const TenantReceiptTemplate = () => (
    <div className="font-mono text-[10px] leading-tight max-w-[210mm] mx-auto p-4 border border-dashed border-black">
      {/* Header Agency */}
      <div className="text-center mb-2">
        <h1 className="font-bold text-sm">IMOBILIÁRIA SIMÕES LTDA</h1>
        <div className="flex justify-between text-[9px] px-2">
          <span>CRECI: 48359-J</span>
          <span>TEL.: (015) 3305-3115</span>
        </div>
        <div className="text-[9px]">ENDERECO: RUA 13 DE MAIO N. 400 BAIRRO: CENTRO CIDADE: TATUI CEP: 18270-280</div>
        
        <div className="border-t border-b border-dashed border-black py-1 mt-1 font-bold">
          ------ R E C I B O   D E   A L U G U E L ------
        </div>
      </div>

      {/* Info Block */}
      <div className="border-b border-dashed border-black pb-2 mb-2 px-1">
        <div className="grid grid-cols-[70px_1fr_auto] gap-x-2">
          <span>LOCATARIO:</span>
          <span className="uppercase truncate">{tenant.name}</span>
          <span>Tel.: {tenant.phone || "N/A"}</span>
        </div>
        <div className="grid grid-cols-[70px_1fr] gap-x-2">
          <span>PROPRIET.:</span>
          <span className="uppercase truncate">{landlord.name}</span>
        </div>
        <div className="grid grid-cols-[70px_1fr] gap-x-2">
          <span>IMOVEL:</span>
          <span className="uppercase truncate">{property.address}</span>
        </div>
        <div className="grid grid-cols-[70px_1fr_auto] gap-x-2">
          <span>CIDADE:</span>
          <span className="uppercase">{property.city} - {property.state}</span>
          <span>CEP: {property.address.match(/\d{5}-\d{3}/)?.[0] || "18270-280"}</span>
        </div>
      </div>

      {/* Reference Strip */}
      <div className="border-b border-dashed border-black pb-2 mb-2 px-1 grid grid-cols-5 gap-2 text-center uppercase">
        <div>
          <div className="border-b border-dashed border-black mb-1">TIPO DO IMOVEL</div>
          <div>RESIDENCIAL</div>
        </div>
        <div>
          <div className="border-b border-dashed border-black mb-1">VCTO.</div>
          <div>{contract?.dueDay}/{String(receipt.refMonth).padStart(2, '0')}/{receipt.refYear}</div>
        </div>
        <div>
          <div className="border-b border-dashed border-black mb-1">CONTROLE</div>
          <div>{String(receipt.refMonth).padStart(2, '0')}/12</div>
        </div>
        <div>
          <div className="border-b border-dashed border-black mb-1">MES REFERENCIA</div>
          <div>{new Date(receipt.refYear, receipt.refMonth - 1).toLocaleString('pt-BR', { month: 'long' })}</div>
        </div>
        <div>
          <div className="border-b border-dashed border-black mb-1">REC.N.O.</div>
          <div>{receipt.id.slice(0, 6).toUpperCase()}</div>
        </div>
      </div>

      {/* Main Body */}
      <div className="grid grid-cols-[1fr_200px] gap-4 h-[220px]">
        {/* Left: Items */}
        <div className="border-r border-dashed border-black pr-2">
          <div className="grid grid-cols-[40px_1fr_30px_80px] border-b border-dashed border-black mb-2 pb-1 font-bold">
            <span>COD.</span>
            <span>HISTORICO</span>
            <span className="text-center">R/D</span>
            <span className="text-right">VALOR</span>
          </div>
          <div className="space-y-1">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-[40px_1fr_30px_80px]">
                <span>{String(idx).padStart(2, '0')}</span>
                <span className="uppercase truncate">{item.description}</span>
                <span className="text-center">{item.type === 'credit' ? 'D' : 'R'}</span>
                <span className="text-right">{fmt(item.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Totals */}
        <div className="flex flex-col justify-center space-y-4">
          <div className="border border-dashed border-black p-2">
            <div className="text-center mb-1 text-[9px] border-b border-dashed border-black pb-1">[ VALOR ATE VENCIMENTO ]</div>
            <div className="flex justify-between items-end">
              <span>VALOR:</span>
              <span className="font-bold text-sm">******{fmt(totalValue)}</span>
            </div>
          </div>

          <div className="border border-dashed border-black p-2">
             <div className="text-center mb-1 text-[9px] border-b border-dashed border-black pb-1">[ VALOR APOS VENCIMENTO ]</div>
             <div className="flex justify-between items-end">
              <span>VALOR:</span>
              <span className="font-bold text-sm">******{fmt(totalValue)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-dashed border-black pt-2 mt-2 grid grid-cols-[1fr_200px] gap-4">
        <div className="flex flex-col justify-between h-20">
          <div>
            Recebemos o valor abaixo mencionado:
            <div className="mt-2 flex gap-2">
              <span className="font-bold text-sm">R$ {fmt(totalValue)}</span>
              <span className="ml-auto">DATA: ____/____/________</span>
            </div>
          </div>
          <div className="border-t border-dashed border-black pt-1 text-center uppercase">
            IMOBILIÁRIA SIMÕES LTDA
          </div>
        </div>

        <div className="border border-dashed border-black p-2 h-20 text-[9px]">
          <div className="text-center border-b border-dashed border-black mb-1 pb-1 font-bold">M E N S A G E N S</div>
          <p>POR MOTIVO DE SEGURANÇA A PARTIR DE MARÇO O PAGAMENTO SERÁ VIA PIX OU TRANSFERÊNCIA.</p>
        </div>
      </div>
    </div>
  );

  const LandlordReceiptTemplate = () => {
    const credits = items.filter(i => i.type === "credit");
    const debits = items.filter(i => i.type === "debit");
    
    const totalCredits = credits.reduce((acc, curr) => acc + curr.value, 0);
    const totalDebits = debits.reduce((acc, curr) => acc + curr.value, 0);
    const finalBalance = totalCredits - totalDebits;

    return (
      <div className="font-mono text-[10px] leading-tight max-w-[210mm] mx-auto p-4 border border-dashed border-black">
        {/* Header Agency */}
        <div className="text-center mb-2">
          <h1 className="font-bold text-sm">IMOBILIÁRIA SIMÕES LTDA</h1>
          <div className="flex justify-between text-[9px] px-2">
            <span>CRECI: 48359-J</span>
            <span>TEL.: (015) 3305-3115</span>
          </div>
          <div className="text-[9px]">ENDERECO: RUA 13 DE MAIO N. 400 BAIRRO: CENTRO CIDADE: TATUI CEP: 18270-280</div>
          
          <div className="border-t border-b border-dashed border-black py-1 mt-1 font-bold">
            ------ E X T R A T O   D E   C O N T A ------
          </div>
        </div>

        {/* Info Block */}
        <div className="border-b border-dashed border-black pb-2 mb-2 px-1">
          <div className="grid grid-cols-[70px_1fr_auto] gap-x-2">
            <span>PROPRIET.:</span>
            <span className="uppercase truncate">{landlord.name}</span>
            <span>Tel.: {landlord.phone || "N/A"}</span>
          </div>
          <div className="grid grid-cols-[70px_1fr] gap-x-2">
            <span>LOCATARIO:</span>
            <span className="uppercase truncate">{tenant.name}</span>
          </div>
          <div className="grid grid-cols-[70px_1fr] gap-x-2">
            <span>IMOVEL:</span>
            <span className="uppercase truncate">{property.address}</span>
          </div>
          <div className="grid grid-cols-[70px_1fr_auto] gap-x-2">
            <span>CIDADE:</span>
            <span className="uppercase">{property.city} - {property.state}</span>
            <span>CEP: {property.address.match(/\d{5}-\d{3}/)?.[0] || "18270-280"}</span>
          </div>
        </div>

        {/* Reference Strip */}
        <div className="border-b border-dashed border-black pb-2 mb-2 px-1 grid grid-cols-5 gap-2 text-center uppercase">
          <div>
            <div className="border-b border-dashed border-black mb-1">TIPO DO IMOVEL</div>
            <div>RESIDENCIAL</div>
          </div>
          <div>
            <div className="border-b border-dashed border-black mb-1">DATA</div>
            <div>{new Date().toLocaleDateString("pt-BR")}</div>
          </div>
          <div>
            <div className="border-b border-dashed border-black mb-1">CONTROLE</div>
            <div>{String(receipt.refMonth).padStart(2, '0')}/12</div>
          </div>
          <div>
            <div className="border-b border-dashed border-black mb-1">MES REFERENCIA</div>
            <div>{new Date(receipt.refYear, receipt.refMonth - 1).toLocaleString('pt-BR', { month: 'long' })}</div>
          </div>
          <div>
            <div className="border-b border-dashed border-black mb-1">REC.N.O.</div>
            <div>{receipt.id.slice(0, 6).toUpperCase()}</div>
          </div>
        </div>

        {/* Main Body */}
        <div className="grid grid-cols-[1fr_200px] gap-4 h-[220px]">
          {/* Left: Items */}
          <div className="border-r border-dashed border-black pr-2">
            <div className="grid grid-cols-[40px_1fr_30px_80px] border-b border-dashed border-black mb-2 pb-1 font-bold">
              <span>DIA</span>
              <span>HISTORICO</span>
              <span className="text-center">TIPO</span>
              <span className="text-right">VALOR</span>
            </div>
            <div className="space-y-1">
              <div className="grid grid-cols-[40px_1fr_30px_80px]">
                <span>01</span>
                <span className="uppercase truncate">SALDO ANTERIOR</span>
                <span className="text-center">C</span>
                <span className="text-right">0,00</span>
              </div>
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-[40px_1fr_30px_80px]">
                  <span>{new Date().getDate()}</span>
                  <span className="uppercase truncate">{item.description}</span>
                  <span className="text-center">{item.type === 'credit' ? 'C' : 'D'}</span>
                  <span className="text-right">{fmt(item.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Totals */}
          <div className="flex flex-col justify-center space-y-4">
            <div className="border border-dashed border-black p-2">
              <div className="text-center mb-1 text-[9px] border-b border-dashed border-black pb-1">[ RESUMO ]</div>
              <div className="space-y-2">
                <div className="flex justify-between items-end">
                  <span>CREDITOS:</span>
                  <span className="font-bold">{fmt(totalCredits)}</span>
                </div>
                <div className="flex justify-between items-end">
                  <span>DEBITOS:</span>
                  <span className="font-bold">-{fmt(totalDebits)}</span>
                </div>
              </div>
            </div>

            <div className="border border-dashed border-black p-2">
               <div className="text-center mb-1 text-[9px] border-b border-dashed border-black pb-1">[ SALDO LIQUIDO ]</div>
               <div className="flex justify-between items-end">
                <span>VALOR:</span>
                <span className="font-bold text-sm">R$ {fmt(finalBalance)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-dashed border-black pt-2 mt-2 grid grid-cols-[1fr_200px] gap-4">
          <div className="flex flex-col justify-between h-20 text-[9px]">
            <div className="text-justify leading-tight">
              Recebi o total acima juntamente com a 2.a via, documento referente aos alugueis do(s) imovel(is) de minha propriedade.
              ATENCAO: Guarde bem os extratos de CONTAS CORRENTES, porque dele e que V.Sa.ira extrair os dados para declaracao de rendimentos destinada ao IMPOSTO DE RENDA.
            </div>
            <div className="flex gap-2 items-end">
              <span className="font-bold">TATUI {new Date().toLocaleDateString("pt-BR")}</span>
              <div className="flex-1 border-b border-black ml-2"></div>
              <span>Assinatura</span>
            </div>
          </div>

          <div className="border border-dashed border-black p-2 h-20 text-[9px]">
            <div className="text-center border-b border-dashed border-black mb-1 pb-1 font-bold">M E N S A G E N S</div>
            <p>POR MOTIVO DE SEGURANÇA A PARTIR DE MARÇO O PAGAMENTO SERÁ VIA PIX OU TRANSFERÊNCIA.</p>
          </div>
        </div>
      </div>
    );
  };

  const Template = type === "tenant" ? TenantReceiptTemplate : LandlordReceiptTemplate;

  return (
    <div className="bg-white text-black min-h-screen">
      <style>{`
        @media print {
          @page { margin: 0; size: auto; }
          body { margin: 0; }
        }
      `}</style>
      
      {/* Print Controls - Hidden when printing */}
      <div className="p-8 flex justify-end gap-4 print:hidden">
        <Button variant="outline" onClick={handleShareWhatsApp}>
          <MessageCircle className="mr-2 h-4 w-4" />
          Compartilhar no WhatsApp
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir
        </Button>
      </div>

      {/* A4 Container */}
      <div className="max-w-[210mm] mx-auto bg-white print:p-0 print:m-0 print:w-full print:h-screen">
        <div className="flex flex-col h-[280mm] justify-between py-8 px-4 print:px-4 print:py-0">
          <div><Template /></div>
          
          <div className="text-center border-b-2 border-dashed border-gray-300 relative my-2">
             <span className="bg-white px-2 text-xs absolute top-[-10px] left-1/2 -translate-x-1/2">CORTE AQUI</span>
          </div>

          <div><Template /></div>
        </div>
      </div>
    </div>
  );
}
