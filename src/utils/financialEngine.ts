/**
 * IT'S SIMPLE — MOTOR FINANCEIRO (FASE FIN.2A.2 - ETAPA 1)
 * Módulo puro, isolado e determinístico de cálculo financeiro.
 * 
 * Regras de Negócio e Decisões Comerciais Aprovadas:
 * 1. Cada Native Friend informa seu preço-base em USD por aula de 50 minutos.
 * 2. O ADM define a comissão individual (0% a 100%) antes de aprovar o professor.
 * 3. O aluno visualiza preços finais em BRL.
 * 4. A conversão utiliza a PTAX de venda do último dia útil anterior à precificação (D-1).
 * 5. Os descontos de pacotes (0%, 5%, 10%, 15%) são rateados proporcionalmente entre professor e plataforma.
 * 6. Arredondamento determinístico em centavos (sem divergência de centavos: Professor + Plataforma === Total).
 * 7. Sem gateway de pagamento real, sem chamadas externas, sem persistência nesta etapa.
 */

export type CommissionModel = 'MARKUP' | 'MARGIN';
export type CurrencyConversionBase = 'UNIT_PRICE_BRL' | 'PACKAGE_TOTAL_USD';

export interface PackageDefinition {
  lessonsCount: number;
  discountPercent: number;
  labelPt: string;
  labelEn: string;
  isPopular?: boolean;
  isBestValue?: boolean;
}

export const APPROVED_PACKAGES: readonly PackageDefinition[] = [
  {
    lessonsCount: 1,
    discountPercent: 0,
    labelPt: '1 Aula Avulsa',
    labelEn: '1 Single Lesson',
  },
  {
    lessonsCount: 4,
    discountPercent: 5,
    labelPt: 'Pacote 4 Aulas',
    labelEn: '4 Lessons Pack',
  },
  {
    lessonsCount: 8,
    discountPercent: 10,
    labelPt: 'Pacote 8 Aulas',
    labelEn: '8 Lessons Pack',
    isPopular: true,
  },
  {
    lessonsCount: 12,
    discountPercent: 15,
    labelPt: 'Pacote 12 Aulas',
    labelEn: '12 Lessons Pack',
    isBestValue: true,
  },
] as const;

export interface FinancialEngineInput {
  /** Preço-base em USD definido pelo Native Friend para aula de 50 min (> 0) */
  basePriceUsd: number;
  /** Comissão percentual administrativa definida pelo ADM (0 a 100) */
  adminCommissionPercent: number;
  /** Cotação oficial PTAX de venda D-1 (> 0) */
  ptaxRate: number;
  /** Modelo de comissão: 'MARKUP' (preço final = base * (1 + comissão)) ou 'MARGIN' (base / (1 - comissão)) */
  commissionModel?: CommissionModel;
  /** Base para cálculo dos pacotes em BRL: 'UNIT_PRICE_BRL' (padrão transparente) ou 'PACKAGE_TOTAL_USD' */
  conversionBase?: CurrencyConversionBase;
}

export interface LessonPackageCalculation {
  lessonsCount: number;
  discountPercent: number;
  labelPt: string;
  labelEn: string;

  // USD Breakdown
  grossTotalUsd: number;
  discountAmountUsd: number;
  finalPriceUsd: number;
  effectiveLessonPriceUsd: number;

  teacherShareUsd: number;
  platformRevenueUsd: number;
  teacherLessonShareUsd: number;
  platformLessonRevenueUsd: number;

  // BRL Breakdown
  grossTotalBrl: number;
  discountAmountBrl: number;
  finalPriceBrl: number; // Valor cobrado do aluno
  effectiveLessonPriceBrl: number;

  teacherShareBrl: number; // Participação bruta do professor
  platformRevenueBrl: number; // Receita bruta da plataforma
  teacherLessonShareBrl: number;
  platformLessonRevenueBrl: number;

  // Invariants checking
  invariants: {
    usdSumMatchesTotal: boolean;
    brlSumMatchesTotal: boolean;
    usdDiffCents: number;
    brlDiffCents: number;
  };
}

export interface FinancialPricingQuote {
  basePriceUsd: number;
  adminCommissionPercent: number;
  commissionModel: CommissionModel;
  ptaxRate: number;
  conversionBase: CurrencyConversionBase;

  unit: {
    basePriceUsd: number;
    platformMarkupUsd: number;
    finalPriceUsd: number;
    teacherShareRatio: number;
    platformShareRatio: number;

    finalPriceBrl: number;
    teacherShareBrl: number;
    platformRevenueBrl: number;
  };

  packages: {
    package1: LessonPackageCalculation;
    package4: LessonPackageCalculation;
    package8: LessonPackageCalculation;
    package12: LessonPackageCalculation;
    list: LessonPackageCalculation[];
  };

  allInvariantsPassed: boolean;
}

/**
 * Converte valor monetário float para centavos inteiros determinísticos.
 * Evita desvios clássicos de ponto flutuante IEEE-754 (ex: 0.1 + 0.2).
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100);
}

/**
 * Converte centavos inteiros de volta para float com 2 casas decimais.
 */
export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

/**
 * Arredonda valor monetário float para exatamente 2 casas decimais via centavos inteiros.
 */
export function roundToCents(amount: number): number {
  return fromCents(toCents(amount));
}

/**
 * Validação rigorosa dos parâmetros de entrada do motor financeiro.
 */
export function validateFinancialInputs(input: FinancialEngineInput): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof input.basePriceUsd !== 'number' || !Number.isFinite(input.basePriceUsd) || input.basePriceUsd <= 0) {
    errors.push('Preço-base em USD deve ser um número positivo maior que zero.');
  }

  if (
    typeof input.adminCommissionPercent !== 'number' ||
    !Number.isFinite(input.adminCommissionPercent) ||
    input.adminCommissionPercent < 0 ||
    input.adminCommissionPercent > 100
  ) {
    errors.push('Comissão administrativa deve ser um percentual entre 0% e 100%.');
  }

  if (typeof input.ptaxRate !== 'number' || !Number.isFinite(input.ptaxRate) || input.ptaxRate <= 0) {
    errors.push('Cotação PTAX D-1 deve ser um número positivo maior que zero.');
  }

  const model = input.commissionModel || 'MARKUP';
  if (model === 'MARGIN' && input.adminCommissionPercent >= 100) {
    errors.push('No modelo MARGIN, a comissão administrativa deve ser estritamente inferior a 100%.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Calcula o preço unitário em USD a partir do preço-base e da comissão administrativa.
 */
export function calculateUnitPricingUsd(
  basePriceUsd: number,
  adminCommissionPercent: number,
  commissionModel: CommissionModel = 'MARKUP'
): {
  basePriceUsd: number;
  platformMarkupUsd: number;
  finalPriceUsd: number;
  teacherShareRatio: number;
  platformShareRatio: number;
} {
  const cleanBase = roundToCents(basePriceUsd);
  const commRate = adminCommissionPercent / 100;

  let finalPriceUsd: number;
  let platformMarkupUsd: number;

  if (commissionModel === 'MARGIN') {
    // Modelo MARGIN: Preço final = Base / (1 - comissão)
    finalPriceUsd = roundToCents(cleanBase / (1 - commRate));
    platformMarkupUsd = roundToCents(finalPriceUsd - cleanBase);
  } else {
    // Modelo MARKUP (Padrão): Preço final = Base * (1 + comissão)
    platformMarkupUsd = roundToCents(cleanBase * commRate);
    finalPriceUsd = roundToCents(cleanBase + platformMarkupUsd);
  }

  // Relação de rateio proporcional exato
  const teacherShareRatio = finalPriceUsd > 0 ? cleanBase / finalPriceUsd : 1;
  const platformShareRatio = 1 - teacherShareRatio;

  return {
    basePriceUsd: cleanBase,
    platformMarkupUsd,
    finalPriceUsd,
    teacherShareRatio,
    platformShareRatio,
  };
}

/**
 * Calcula os valores financeiros completos para um pacote específico (1, 4, 8 ou 12 aulas).
 * Garante que a soma das parcelas (Professor + Plataforma) corresponda exatamente
 * ao total cobrado, sem discrepância de centavos.
 */
export function calculatePackageFinancials(
  lessonsCount: number,
  discountPercent: number,
  unitUsd: {
    basePriceUsd: number;
    finalPriceUsd: number;
    teacherShareRatio: number;
    platformShareRatio: number;
  },
  ptaxRate: number,
  meta: { labelPt: string; labelEn: string },
  conversionBase: CurrencyConversionBase = 'UNIT_PRICE_BRL'
): LessonPackageCalculation {
  // 1. Cálculos em USD
  const grossUsdCents = toCents(lessonsCount * unitUsd.finalPriceUsd);
  const discountUsdCents = Math.round(grossUsdCents * (discountPercent / 100));
  const finalUsdCents = grossUsdCents - discountUsdCents;

  // Rateio proporcional do valor com desconto em USD
  const teacherShareUsdCents = Math.round(finalUsdCents * unitUsd.teacherShareRatio);
  const platformRevenueUsdCents = finalUsdCents - teacherShareUsdCents; // Complemento exato garante soma zero

  // 2. Cálculos em BRL
  let grossBrlCents: number;
  let discountBrlCents: number;
  let finalBrlCents: number;

  if (conversionBase === 'PACKAGE_TOTAL_USD') {
    // Conversão direta do total USD
    finalBrlCents = Math.round(finalUsdCents * (ptaxRate / 100) * 100);
    grossBrlCents = Math.round(grossUsdCents * (ptaxRate / 100) * 100);
    discountBrlCents = grossBrlCents - finalBrlCents;
  } else {
    // UNIT_PRICE_BRL (Padrão): Preço unitário BRL visível ao aluno
    const unitPriceBrlCents = toCents(unitUsd.finalPriceUsd * ptaxRate);
    grossBrlCents = unitPriceBrlCents * lessonsCount;
    discountBrlCents = Math.round(grossBrlCents * (discountPercent / 100));
    finalBrlCents = grossBrlCents - discountBrlCents;
  }

  // Rateio proporcional do valor cobrado em BRL
  // Os descontos são rateados na exata proporção original entre professor e plataforma
  const teacherShareBrlCents = Math.round(finalBrlCents * unitUsd.teacherShareRatio);
  const platformRevenueBrlCents = finalBrlCents - teacherShareBrlCents; // Complemento exato

  // 3. Verificação de Invariantes Monetárias (zero centavos de diferença)
  const usdDiffCents = (teacherShareUsdCents + platformRevenueUsdCents) - finalUsdCents;
  const brlDiffCents = (teacherShareBrlCents + platformRevenueBrlCents) - finalBrlCents;

  const usdSumMatchesTotal = usdDiffCents === 0;
  const brlSumMatchesTotal = brlDiffCents === 0;

  return {
    lessonsCount,
    discountPercent,
    labelPt: meta.labelPt,
    labelEn: meta.labelEn,

    grossTotalUsd: fromCents(grossUsdCents),
    discountAmountUsd: fromCents(discountUsdCents),
    finalPriceUsd: fromCents(finalUsdCents),
    effectiveLessonPriceUsd: fromCents(Math.round(finalUsdCents / lessonsCount)),

    teacherShareUsd: fromCents(teacherShareUsdCents),
    platformRevenueUsd: fromCents(platformRevenueUsdCents),
    teacherLessonShareUsd: fromCents(Math.round(teacherShareUsdCents / lessonsCount)),
    platformLessonRevenueUsd: fromCents(Math.round(platformRevenueUsdCents / lessonsCount)),

    grossTotalBrl: fromCents(grossBrlCents),
    discountAmountBrl: fromCents(discountBrlCents),
    finalPriceBrl: fromCents(finalBrlCents),
    effectiveLessonPriceBrl: fromCents(Math.round(finalBrlCents / lessonsCount)),

    teacherShareBrl: fromCents(teacherShareBrlCents),
    platformRevenueBrl: fromCents(platformRevenueBrlCents),
    teacherLessonShareBrl: fromCents(Math.round(teacherShareBrlCents / lessonsCount)),
    platformLessonRevenueBrl: fromCents(Math.round(platformRevenueBrlCents / lessonsCount)),

    invariants: {
      usdSumMatchesTotal,
      brlSumMatchesTotal,
      usdDiffCents,
      brlDiffCents,
    },
  };
}

/**
 * Ponto de entrada principal do Motor Financeiro.
 * Executa todo o fluxo de cálculo determinístico e devolve cotação completa.
 */
export function calculateFinancialPricingQuote(input: FinancialEngineInput): FinancialPricingQuote {
  const validation = validateFinancialInputs(input);
  if (!validation.isValid) {
    throw new Error(`[FinancialEngine] Parâmetros inválidos: ${validation.errors.join(' | ')}`);
  }

  const commissionModel = input.commissionModel || 'MARKUP';
  const conversionBase = input.conversionBase || 'UNIT_PRICE_BRL';

  // 1. Preço Unitário USD
  const unitUsd = calculateUnitPricingUsd(input.basePriceUsd, input.adminCommissionPercent, commissionModel);

  // 2. Preço Unitário BRL
  const unitFinalBrlCents = toCents(unitUsd.finalPriceUsd * input.ptaxRate);
  const teacherShareBrlCents = Math.round(unitFinalBrlCents * unitUsd.teacherShareRatio);
  const platformRevenueBrlCents = unitFinalBrlCents - teacherShareBrlCents;

  const unit = {
    basePriceUsd: unitUsd.basePriceUsd,
    platformMarkupUsd: unitUsd.platformMarkupUsd,
    finalPriceUsd: unitUsd.finalPriceUsd,
    teacherShareRatio: unitUsd.teacherShareRatio,
    platformShareRatio: unitUsd.platformShareRatio,

    finalPriceBrl: fromCents(unitFinalBrlCents),
    teacherShareBrl: fromCents(teacherShareBrlCents),
    platformRevenueBrl: fromCents(platformRevenueBrlCents),
  };

  // 3. Cálculos de todos os pacotes aprovados
  const calculatedList = APPROVED_PACKAGES.map((pkg) =>
    calculatePackageFinancials(
      pkg.lessonsCount,
      pkg.discountPercent,
      unitUsd,
      input.ptaxRate,
      { labelPt: pkg.labelPt, labelEn: pkg.labelEn },
      conversionBase
    )
  );

  const package1 = calculatedList.find((p) => p.lessonsCount === 1)!;
  const package4 = calculatedList.find((p) => p.lessonsCount === 4)!;
  const package8 = calculatedList.find((p) => p.lessonsCount === 8)!;
  const package12 = calculatedList.find((p) => p.lessonsCount === 12)!;

  const allInvariantsPassed =
    calculatedList.every((p) => p.invariants.usdSumMatchesTotal && p.invariants.brlSumMatchesTotal) &&
    (teacherShareBrlCents + platformRevenueBrlCents === unitFinalBrlCents);

  return {
    basePriceUsd: unitUsd.basePriceUsd,
    adminCommissionPercent: input.adminCommissionPercent,
    commissionModel,
    ptaxRate: input.ptaxRate,
    conversionBase,
    unit,
    packages: {
      package1,
      package4,
      package8,
      package12,
      list: calculatedList,
    },
    allInvariantsPassed,
  };
}
