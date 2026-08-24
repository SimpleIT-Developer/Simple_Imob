export type FieldPermissionMode = "all" | "none" | "custom";

type EditableFieldDefinition = {
  key: string;
  label: string;
};

type EditableActionConfig = {
  label: string;
  fields: readonly EditableFieldDefinition[];
};

export const FIELD_PERMISSION_CONFIGS = {
  edit_property: {
    label: "Imóveis",
    fields: [
      { key: "code", label: "Código" },
      { key: "title", label: "Título" },
      { key: "type", label: "Tipo do Imóvel" },
      { key: "saleRent", label: "Aluguel/Venda" },
      { key: "zipCode", label: "CEP" },
      { key: "address", label: "Endereço" },
      { key: "neighborhood", label: "Bairro" },
      { key: "city", label: "Cidade" },
      { key: "state", label: "Estado" },
      { key: "rentDefault", label: "Aluguel Padrão" },
      { key: "status", label: "Status" },
      { key: "landlordShares", label: "Proprietários e Percentuais" },
    ],
  },
  edit_landlord: {
    label: "Proprietários",
    fields: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "doc", label: "CPF/CNPJ" },
      { key: "rg", label: "RG" },
      { key: "birthDate", label: "Data Nascimento" },
      { key: "maritalStatus", label: "Estado Civil" },
      { key: "nationality", label: "Naturalidade" },
      { key: "profession", label: "Profissão" },
      { key: "email", label: "E-mail" },
      { key: "phone", label: "Telefone" },
      { key: "zipCode", label: "CEP" },
      { key: "address", label: "Endereço" },
      { key: "neighborhood", label: "Bairro" },
      { key: "city", label: "Cidade" },
      { key: "state", label: "Estado" },
      { key: "bank", label: "Banco" },
      { key: "bankIspb", label: "ISPB do Banco" },
      { key: "branch", label: "Agência" },
      { key: "account", label: "Conta" },
      { key: "accountType", label: "Tipo de Conta" },
      { key: "pixKeyType", label: "Tipo de Chave PIX" },
      { key: "pixKey", label: "Chave PIX" },
      { key: "nfseEnabled", label: "Emissão de NFS-e" },
      { key: "nfseMunicipalRegistration", label: "Inscrição Municipal" },
      { key: "nfseMunicipioIbge", label: "Município IBGE" },
      { key: "nfseServiceItem", label: "Item de Serviço" },
      { key: "nfseNationalTaxCode", label: "Código Tributário Nacional" },
      { key: "nfseIssRate", label: "Alíquota ISS" },
      { key: "nfseIbsCbsCst", label: "CST IBS/CBS" },
      { key: "nfseIbsCbsClassTrib", label: "Classificação Tributária IBS/CBS" },
      { key: "nfseIbsCbsIndOp", label: "Indicador de Operação IBS/CBS" },
      { key: "nfseOpSimpNac", label: "Optante Simples Nacional" },
      { key: "nfseEnvironment", label: "Ambiente NFS-e" },
      { key: "nfseSeries", label: "Série" },
      { key: "nfseCertificatePassword", label: "Senha do Certificado" },
      { key: "nfseCertificatePfxBase64", label: "Certificado Digital" },
      { key: "nfseCertificateFileName", label: "Nome do Certificado" },
    ],
  },
  edit_tenant: {
    label: "Locatários",
    fields: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "doc", label: "CPF" },
      { key: "rg", label: "RG" },
      { key: "birthDate", label: "Data de Nascimento" },
      { key: "maritalStatus", label: "Estado Civil" },
      { key: "profession", label: "Profissão" },
      { key: "class", label: "Classe" },
      { key: "email", label: "E-mail" },
      { key: "phone", label: "Telefone" },
      { key: "zipCode", label: "CEP" },
      { key: "address", label: "Endereço" },
      { key: "neighborhood", label: "Bairro" },
      { key: "city", label: "Cidade" },
      { key: "state", label: "Estado" },
      { key: "pixKeyType", label: "Tipo de Chave PIX" },
      { key: "pixKey", label: "Chave PIX" },
    ],
  },
  edit_guarantor: {
    label: "Fiadores",
    fields: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "doc", label: "CPF/CNPJ" },
      { key: "rg", label: "RG" },
      { key: "birthDate", label: "Data Nascimento" },
      { key: "maritalStatus", label: "Estado Civil" },
      { key: "profession", label: "Profissão" },
      { key: "class", label: "Classe" },
      { key: "email", label: "E-mail" },
      { key: "phone", label: "Telefone" },
      { key: "zipCode", label: "CEP" },
      { key: "address", label: "Endereço" },
      { key: "neighborhood", label: "Bairro" },
      { key: "city", label: "Cidade" },
      { key: "state", label: "Estado" },
      { key: "spouseName", label: "Nome do Cônjuge" },
      { key: "spouseDoc", label: "CPF do Cônjuge" },
      { key: "spouseRg", label: "RG do Cônjuge" },
    ],
  },
  edit_provider: {
    label: "Prestadores",
    fields: [
      { key: "name", label: "Nome" },
      { key: "serviceType", label: "Tipo de Serviço" },
      { key: "doc", label: "CPF/CNPJ" },
      { key: "phone", label: "Telefone" },
      { key: "email", label: "E-mail" },
    ],
  },
  edit_contract: {
    label: "Contratos",
    fields: [
      { key: "propertyId", label: "Imóvel" },
      { key: "landlordId", label: "Proprietário" },
      { key: "tenantId", label: "Locatário" },
      { key: "guarantorId", label: "Fiador" },
      { key: "guaranteeType", label: "Garantia" },
      { key: "startDate", label: "Data Inicial" },
      { key: "duration", label: "Prazo" },
      { key: "endDate", label: "Data Final" },
      { key: "firstDueDate", label: "Primeiro Vencimento" },
      { key: "dueDay", label: "Dia do Vencimento" },
      { key: "rentAmount", label: "Valor do Aluguel" },
      { key: "adminFeePercent", label: "Taxa de Administração" },
      { key: "status", label: "Status" },
      { key: "insuranceValue", label: "Valor do Seguro Fiança" },
    ],
  },
  edit_receipt: {
    label: "Recibos",
    fields: [
      { key: "dueDate", label: "Vencimento" },
      { key: "adminFeeAmount", label: "Taxa de Administração" },
    ],
  },
  edit_service: {
    label: "Serviços",
    fields: [
      { key: "contractId", label: "Contrato" },
      { key: "description", label: "Descrição" },
      { key: "refMonth", label: "Mês de Referência" },
      { key: "refYear", label: "Ano de Referência" },
      { key: "amount", label: "Valor" },
      { key: "chargedTo", label: "Cobrar de" },
      { key: "passThrough", label: "Repasse" },
      { key: "providerId", label: "Prestador" },
    ],
  },
  edit_transaction: {
    label: "Caixa",
    fields: [
      { key: "type", label: "Tipo" },
      { key: "date", label: "Data" },
      { key: "category", label: "Categoria" },
      { key: "description", label: "Descrição" },
      { key: "amount", label: "Valor" },
    ],
  },
  edit_adjustment: {
    label: "Ajustes",
    fields: [
      { key: "contractId", label: "Contrato" },
      { key: "description", label: "Descrição" },
      { key: "refMonth", label: "Mês de Referência" },
      { key: "refYear", label: "Ano de Referência" },
      { key: "amount", label: "Valor" },
      { key: "chargedTo", label: "Destino" },
      { key: "type", label: "Tipo" },
    ],
  },
} as const satisfies Record<string, EditableActionConfig>;

export type EditableActionId = keyof typeof FIELD_PERMISSION_CONFIGS;
export type EditableFieldKey<TAction extends EditableActionId> = (typeof FIELD_PERMISSION_CONFIGS)[TAction]["fields"][number]["key"];

export function getFieldPermissionAllToken(actionId: EditableActionId) {
  return `${actionId}_fields:*`;
}

export function getFieldPermissionNoneToken(actionId: EditableActionId) {
  return `${actionId}_fields:none`;
}

export function getFieldPermissionPrefix(actionId: EditableActionId) {
  return `${actionId}_field:`;
}

export function getFieldPermissionToken<TAction extends EditableActionId>(actionId: TAction, field: EditableFieldKey<TAction>) {
  return `${getFieldPermissionPrefix(actionId)}${field}`;
}

export function getEditableFields(actionId: EditableActionId) {
  return FIELD_PERMISSION_CONFIGS[actionId].fields;
}

export function getEditableFieldKeys<TAction extends EditableActionId>(actionId: TAction) {
  return FIELD_PERMISSION_CONFIGS[actionId].fields.map((field) => field.key) as EditableFieldKey<TAction>[];
}

export function stripFieldPermissions<TAction extends EditableActionId>(permissions: string[], actionId: TAction) {
  const prefix = getFieldPermissionPrefix(actionId);
  const allToken = getFieldPermissionAllToken(actionId);
  const noneToken = getFieldPermissionNoneToken(actionId);
  return permissions.filter(
    (permission) => permission !== allToken && permission !== noneToken && !permission.startsWith(prefix),
  );
}

export function getFieldPermissionState<TAction extends EditableActionId>(actionId: TAction, permissions?: string[] | null): {
  mode: FieldPermissionMode;
  fields: EditableFieldKey<TAction>[];
} {
  const list = Array.isArray(permissions) ? permissions : [];
  const allToken = getFieldPermissionAllToken(actionId);
  const noneToken = getFieldPermissionNoneToken(actionId);
  const fieldKeys = getEditableFieldKeys(actionId);

  if (list.includes(allToken)) {
    return { mode: "all", fields: fieldKeys };
  }

  if (list.includes(noneToken)) {
    return { mode: "none", fields: [] };
  }

  const customFields = fieldKeys.filter((field) => list.includes(getFieldPermissionToken(actionId, field)));

  if (customFields.length > 0) {
    return { mode: "custom", fields: customFields };
  }

  return { mode: "all", fields: fieldKeys };
}

export function applyFieldPermissions<TAction extends EditableActionId>(
  actionId: TAction,
  permissions: string[],
  mode: FieldPermissionMode,
  fields: EditableFieldKey<TAction>[],
) {
  const basePermissions = stripFieldPermissions(permissions, actionId);

  if (!basePermissions.includes(actionId)) {
    return basePermissions;
  }

  if (mode === "all") {
    return [...basePermissions, getFieldPermissionAllToken(actionId)];
  }

  if (mode === "none") {
    return [...basePermissions, getFieldPermissionNoneToken(actionId)];
  }

  const allowedFields = getEditableFieldKeys(actionId)
    .filter((field) => fields.includes(field))
    .map((field) => getFieldPermissionToken(actionId, field));

  return [...basePermissions, ...allowedFields];
}

export function hasFieldPermission<TAction extends EditableActionId>(
  permissions: string[] | undefined | null,
  actionId: TAction,
  field: EditableFieldKey<TAction>,
) {
  const state = getFieldPermissionState(actionId, permissions);
  if (state.mode === "all") return true;
  if (state.mode === "none") return false;
  return state.fields.includes(field);
}

export function hasAnyFieldPermission(actionId: EditableActionId, permissions: string[] | undefined | null) {
  const state = getFieldPermissionState(actionId, permissions);
  return state.mode === "all" || state.fields.length > 0;
}

export const PROPERTY_EDITABLE_FIELDS = FIELD_PERMISSION_CONFIGS.edit_property.fields;
export type PropertyEditableFieldKey = EditableFieldKey<"edit_property">;
export type PropertyFieldPermissionMode = FieldPermissionMode;

export const EDIT_PROPERTY_FIELDS_ALL = getFieldPermissionAllToken("edit_property");
export const EDIT_PROPERTY_FIELDS_NONE = getFieldPermissionNoneToken("edit_property");
export const EDIT_PROPERTY_FIELD_PREFIX = getFieldPermissionPrefix("edit_property");

export function getPropertyFieldPermissionToken(field: PropertyEditableFieldKey) {
  return getFieldPermissionToken("edit_property", field);
}

export function stripPropertyFieldPermissions(permissions: string[]) {
  return stripFieldPermissions(permissions, "edit_property");
}

export function getPropertyFieldPermissionState(permissions?: string[] | null) {
  return getFieldPermissionState("edit_property", permissions);
}

export function applyPropertyFieldPermissions(
  permissions: string[],
  mode: PropertyFieldPermissionMode,
  fields: PropertyEditableFieldKey[],
) {
  return applyFieldPermissions("edit_property", permissions, mode, fields);
}

export function hasPropertyFieldPermission(permissions: string[] | undefined | null, field: PropertyEditableFieldKey) {
  return hasFieldPermission(permissions, "edit_property", field);
}

export function hasAnyPropertyFieldPermission(permissions: string[] | undefined | null) {
  return hasAnyFieldPermission("edit_property", permissions);
}
