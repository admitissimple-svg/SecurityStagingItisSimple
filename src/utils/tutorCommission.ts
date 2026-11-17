/**
 * IT'S SIMPLE — FIN.2B: Validação, Persistência e Versionamento de Comissão Individual
 *
 * Regras de negócio:
 * - O professor informa seu preço-base em USD por aula de 50 minutos.
 * - O ADM define a comissão percentual individual antes da aprovação.
 * - Aceita explicitamente 0% até 100% (números finitos).
 * - Nunca aplica percentual padrão nem fallback.
 * - Modelo financeiro exclusivo: MARKUP.
 * - A comissão é um dado estritamente administrativo (nunca exposta em DTOs públicos ou documentos de alunos).
 */

export type CommissionModel = 'MARKUP';

export const ALLOWED_COMMISSION_MODEL: CommissionModel = 'MARKUP';

export interface CommissionHistoryEntry {
  version: number;
  adminCommissionPercent: number;
  commissionModel: CommissionModel;
  effectiveFrom: string;
  updatedAt: string;
  updatedByUid: string;
  previousPercent: number | null;
  action: 'initial_approval' | 'admin_configuration' | 'admin_update';
}

export type CommissionValidationErrorCode =
  | 'COMMISSION_REQUIRED'
  | 'COMMISSION_INVALID_NUMBER'
  | 'COMMISSION_OUT_OF_RANGE'
  | 'INVALID_COMMISSION_MODEL';

export type CommissionValidationResult =
  | { valid: true; value: number }
  | { valid: false; code: CommissionValidationErrorCode; error: string };

export const ADMIN_COMMISSION_KEYS = [
  'adminCommissionPercent',
  'commissionModel',
  'commissionVersion',
  'effectiveFrom',
  'updatedByUid',
  'commissionUpdatedAt',
  'commissionHistory',
  'financialConfigurationPending',
  'isCommercializable',
] as const;

/**
 * Validação rigorosa e determinística do percentual de comissão administrativa (0 a 100).
 * Nunca trata 0 como falsy e nunca aplica valores padrão.
 */
export function validateAdminCommissionPercent(rawValue: unknown): CommissionValidationResult {
  if (rawValue === undefined || rawValue === null) {
    return {
      valid: false,
      code: 'COMMISSION_REQUIRED',
      error: 'Comissão da plataforma (%) é obrigatória antes da aprovação (0% a 100%).',
    };
  }

  if (typeof rawValue === 'boolean' || typeof rawValue === 'object' || typeof rawValue === 'symbol' || typeof rawValue === 'bigint') {
    return {
      valid: false,
      code: 'COMMISSION_INVALID_NUMBER',
      error: 'Comissão inválida. Informe um número finito entre 0% e 100%.',
    };
  }

  let numericValue: number;

  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (trimmed === '') {
      return {
        valid: false,
        code: 'COMMISSION_REQUIRED',
        error: 'Comissão da plataforma (%) é obrigatória antes da aprovação (0% a 100%).',
      };
    }

    const normalized = trimmed.includes(',') && !trimmed.includes('.')
      ? trimmed.replace(',', '.')
      : trimmed;

    // Aceita apenas formato numérico estrito (rejeita "NaN", "Infinity", "20%", "abc", etc.)
    if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) {
      return {
        valid: false,
        code: 'COMMISSION_INVALID_NUMBER',
        error: 'Comissão inválida. Informe um número finito entre 0% e 100%.',
      };
    }

    numericValue = Number(normalized);
  } else if (typeof rawValue === 'number') {
    numericValue = rawValue;
  } else {
    return {
      valid: false,
      code: 'COMMISSION_INVALID_NUMBER',
      error: 'Comissão inválida. Informe um número finito entre 0% e 100%.',
    };
  }

  if (!Number.isFinite(numericValue)) {
    return {
      valid: false,
      code: 'COMMISSION_INVALID_NUMBER',
      error: 'Comissão inválida. Informe um número finito entre 0% e 100%.',
    };
  }

  if (numericValue < 0) {
    return {
      valid: false,
      code: 'COMMISSION_OUT_OF_RANGE',
      error: 'Comissão não pode ser negativa. Informe um percentual entre 0% e 100%.',
    };
  }

  if (numericValue > 100) {
    return {
      valid: false,
      code: 'COMMISSION_OUT_OF_RANGE',
      error: 'Comissão não pode ser superior a 100%. Informe um percentual entre 0% e 100%.',
    };
  }

  // Normaliza -0 para 0
  const cleanPercent = numericValue === 0 ? 0 : numericValue;
  return {
    valid: true,
    value: cleanPercent,
  };
}

/**
 * Valida que o modelo de comissão é estritamente MARKUP.
 */
export function validateCommissionModel(
  rawModel: unknown
): { valid: true; value: CommissionModel } | { valid: false; code: 'INVALID_COMMISSION_MODEL'; error: string } {
  if (rawModel === undefined || rawModel === null || rawModel === '') {
    return { valid: true, value: ALLOWED_COMMISSION_MODEL };
  }
  if (rawModel === ALLOWED_COMMISSION_MODEL) {
    return { valid: true, value: ALLOWED_COMMISSION_MODEL };
  }
  return {
    valid: false,
    code: 'INVALID_COMMISSION_MODEL',
    error: 'Modelo financeiro de comissão inválido. Apenas o modelo MARKUP é suportado.',
  };
}

/**
 * Verifica se o registro do professor possui comissão individual válida e persistida.
 */
export function hasValidPersistedCommission(tutorRecord: any): boolean {
  if (!tutorRecord || typeof tutorRecord !== 'object') return false;
  const pct = tutorRecord.adminCommissionPercent;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    return false;
  }
  if (tutorRecord.commissionModel && tutorRecord.commissionModel !== ALLOWED_COMMISSION_MODEL) {
    return false;
  }
  return true;
}

/**
 * Identifica se um professor já aprovado possui configuração financeira completa para comercialização.
 * Professores legados aprovados sem comissão permanecem aprovados, mas com comercialização bloqueada.
 */
export function isTutorCommercializable(tutorRecord: any): boolean {
  if (!tutorRecord || typeof tutorRecord !== 'object') return false;
  const isApproved =
    tutorRecord.approvalStatus === 'approved' &&
    tutorRecord.isApproved === true;
  return isApproved && hasValidPersistedCommission(tutorRecord);
}

/**
 * Verifica se o payload possui qualquer campo administrativo de comissão.
 */
export function payloadAttemptsCommissionMutation(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  return (
    payload.adminCommissionPercent !== undefined ||
    payload.commissionModel !== undefined ||
    payload.commissionVersion !== undefined ||
    payload.commissionHistory !== undefined ||
    payload.effectiveFrom !== undefined ||
    payload.updatedByUid !== undefined ||
    payload.commissionUpdatedAt !== undefined
  );
}

/**
 * Remove campos administrativos de comissão para projeções públicas ou visões não-administrativas.
 */
export function stripAdminCommissionFields<T extends Record<string, any>>(record: T): Omit<T, (typeof ADMIN_COMMISSION_KEYS)[number]> {
  if (!record || typeof record !== 'object') return record as any;
  const copy: Record<string, any> = { ...record };
  for (const key of ADMIN_COMMISSION_KEYS) {
    delete copy[key];
  }
  return copy as any;
}

export interface VersionedCommissionFields {
  adminCommissionPercent: number;
  commissionModel: CommissionModel;
  commissionVersion: number;
  effectiveFrom: string;
  updatedAt: string;
  commissionUpdatedAt: string;
  updatedByUid: string;
  commissionHistory: CommissionHistoryEntry[];
  financialConfigurationPending: false;
}

export type BuildCommissionResult =
  | { ok: true; fields: VersionedCommissionFields }
  | { ok: false; status: number; code: string; error: string };

/**
 * Constrói e versiona os campos de comissão individual de forma imutável.
 * - Exige comissão informada ou previamente persistida válida.
 * - Preserva todas as versões anteriores em commissionHistory.
 */
export function buildVersionedCommissionFields(params: {
  existingTutor?: any;
  incomingCommissionPercent?: unknown;
  incomingCommissionModel?: unknown;
  updatedByUid: string;
  nowIso?: string;
  action?: 'initial_approval' | 'admin_configuration' | 'admin_update';
  forceNewVersion?: boolean;
}): BuildCommissionResult {
  const {
    existingTutor,
    incomingCommissionPercent,
    incomingCommissionModel,
    updatedByUid,
    nowIso = new Date().toISOString(),
    action,
    forceNewVersion = false,
  } = params;

  const cleanAdminUid = typeof updatedByUid === 'string' ? updatedByUid.trim() : '';
  if (!cleanAdminUid) {
    return {
      ok: false,
      status: 401,
      code: 'ADMIN_UID_REQUIRED',
      error: 'UID canônico do administrador autenticado é obrigatório para registrar comissão.',
    };
  }

  const modelCheck = validateCommissionModel(incomingCommissionModel);
  if (!modelCheck.valid) {
    return {
      ok: false,
      status: 400,
      code: modelCheck.code,
      error: modelCheck.error,
    };
  }

  const existingHistory: CommissionHistoryEntry[] = Array.isArray(existingTutor?.commissionHistory)
    ? existingTutor.commissionHistory.map((h: any) => ({ ...h }))
    : [];

  const existingHasCommission = hasValidPersistedCommission(existingTutor);
  const existingVersion =
    typeof existingTutor?.commissionVersion === 'number' &&
    Number.isInteger(existingTutor.commissionVersion) &&
    existingTutor.commissionVersion >= 1
      ? existingTutor.commissionVersion
      : existingHasCommission
      ? 1
      : 0;

  // Backfill defensivo se havia comissão válida sem array de histórico
  if (existingHasCommission && existingHistory.length === 0) {
    existingHistory.push({
      version: existingVersion,
      adminCommissionPercent: existingTutor.adminCommissionPercent,
      commissionModel: ALLOWED_COMMISSION_MODEL,
      effectiveFrom: existingTutor.effectiveFrom || existingTutor.updatedAt || nowIso,
      updatedAt: existingTutor.commissionUpdatedAt || existingTutor.updatedAt || nowIso,
      updatedByUid: existingTutor.updatedByUid || cleanAdminUid,
      previousPercent: null,
      action: 'initial_approval',
    });
  }

  // Caso 1: ADM não informou percentual no payload
  if (incomingCommissionPercent === undefined) {
    if (!existingHasCommission) {
      return {
        ok: false,
        status: 400,
        code: 'COMMISSION_REQUIRED',
        error: 'Comissão individual da plataforma (0% a 100%) é obrigatória antes de aprovar o Native Friend.',
      };
    }

    // Preserva comissão já persistida sem inventar nova versão
    return {
      ok: true,
      fields: {
        adminCommissionPercent: existingTutor.adminCommissionPercent,
        commissionModel: ALLOWED_COMMISSION_MODEL,
        commissionVersion: existingVersion,
        effectiveFrom: existingTutor.effectiveFrom || nowIso,
        updatedAt: nowIso,
        commissionUpdatedAt: existingTutor.commissionUpdatedAt || existingTutor.updatedAt || nowIso,
        updatedByUid: existingTutor.updatedByUid || cleanAdminUid,
        commissionHistory: existingHistory,
        financialConfigurationPending: false,
      },
    };
  }

  // Caso 2: ADM informou percentual no payload -> validação estrita obrigatória
  const pctValidation = validateAdminCommissionPercent(incomingCommissionPercent);
  if (!pctValidation.valid) {
    return {
      ok: false,
      status: 400,
      code: pctValidation.code,
      error: pctValidation.error,
    };
  }

  const newPercent = pctValidation.value;

  // Idempotência na aprovação se o valor informado é idêntico ao já persistido e não forçada nova versão
  if (
    !forceNewVersion &&
    existingHasCommission &&
    existingTutor.adminCommissionPercent === newPercent &&
    existingVersion >= 1
  ) {
    return {
      ok: true,
      fields: {
        adminCommissionPercent: newPercent,
        commissionModel: ALLOWED_COMMISSION_MODEL,
        commissionVersion: existingVersion,
        effectiveFrom: existingTutor.effectiveFrom || nowIso,
        updatedAt: nowIso,
        commissionUpdatedAt: existingTutor.commissionUpdatedAt || existingTutor.updatedAt || nowIso,
        updatedByUid: existingTutor.updatedByUid || cleanAdminUid,
        commissionHistory: existingHistory,
        financialConfigurationPending: false,
      },
    };
  }

  const maxHistoryVersion = existingHistory.reduce(
    (max, item) => (typeof item?.version === 'number' && item.version > max ? item.version : max),
    0
  );
  const nextVersion = Math.max(existingVersion, maxHistoryVersion) + 1;
  const previousPercent = existingHasCommission ? existingTutor.adminCommissionPercent : null;
  const resolvedAction =
    action || (previousPercent === null ? 'initial_approval' : 'admin_update');

  const newHistoryEntry: CommissionHistoryEntry = {
    version: nextVersion,
    adminCommissionPercent: newPercent,
    commissionModel: ALLOWED_COMMISSION_MODEL,
    effectiveFrom: nowIso,
    updatedAt: nowIso,
    updatedByUid: cleanAdminUid,
    previousPercent,
    action: resolvedAction,
  };

  return {
    ok: true,
    fields: {
      adminCommissionPercent: newPercent,
      commissionModel: ALLOWED_COMMISSION_MODEL,
      commissionVersion: nextVersion,
      effectiveFrom: nowIso,
      updatedAt: nowIso,
      commissionUpdatedAt: nowIso,
      updatedByUid: cleanAdminUid,
      commissionHistory: [...existingHistory, newHistoryEntry],
      financialConfigurationPending: false,
    },
  };
}
