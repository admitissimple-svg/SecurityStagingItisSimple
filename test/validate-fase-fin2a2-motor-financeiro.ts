/**
 * TEST SUITE: FASE FIN.2A.2 — MOTOR FINANCEIRO ISOLADO
 * Verificação do módulo puro de cálculo financeiro, rateio proporcional,
 * conversão PTAX D-1 e invariante estrita de centavos exatos.
 */

import {
  calculateFinancialPricingQuote,
  calculateUnitPricingUsd,
  calculatePackageFinancials,
  validateFinancialInputs,
  roundToCents,
  toCents,
  fromCents,
  APPROVED_PACKAGES,
  FinancialPricingQuote,
} from '../src/utils/financialEngine';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` -> ${detail}` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🏁 INICIANDO TESTES DO MOTOR FINANCEIRO (FASE FIN.2A.2)');
  console.log('======================================================\n');

  // ------------------------------------------------------------------
  // 1. Validação de Entrada
  // ------------------------------------------------------------------
  console.log('🧪 GRUPO 1: Validação de Parâmetros de Entrada');
  {
    const v1 = validateFinancialInputs({ basePriceUsd: -10, adminCommissionPercent: 20, ptaxRate: 5.5 });
    assert(!v1.isValid && v1.errors.length > 0, 'Rejeita preço-base negativo');

    const v2 = validateFinancialInputs({ basePriceUsd: 0, adminCommissionPercent: 20, ptaxRate: 5.5 });
    assert(!v2.isValid, 'Rejeita preço-base zero');

    const v3 = validateFinancialInputs({ basePriceUsd: 20, adminCommissionPercent: -5, ptaxRate: 5.5 });
    assert(!v3.isValid, 'Rejeita comissão negativa');

    const v4 = validateFinancialInputs({ basePriceUsd: 20, adminCommissionPercent: 105, ptaxRate: 5.5 });
    assert(!v4.isValid, 'Rejeita comissão superior a 100%');

    const v5 = validateFinancialInputs({ basePriceUsd: 20, adminCommissionPercent: 20, ptaxRate: -1 });
    assert(!v5.isValid, 'Rejeita cotação PTAX negativa ou zero');

    const v6 = validateFinancialInputs({
      basePriceUsd: 20,
      adminCommissionPercent: 100,
      ptaxRate: 5.5,
      commissionModel: 'MARGIN',
    });
    assert(!v6.isValid, 'Rejeita comissão de 100% no modelo MARGIN (evita divisão por zero)');

    const vValid = validateFinancialInputs({ basePriceUsd: 20, adminCommissionPercent: 20, ptaxRate: 5.6543 });
    assert(vValid.isValid && vValid.errors.length === 0, 'Aceita parâmetros comerciais válidos');
  }

  // ------------------------------------------------------------------
  // 2. Aritmética Determinística de Centavos
  // ------------------------------------------------------------------
  console.log('\n🧪 GRUPO 2: Aritmética Determinística de Centavos');
  {
    assert(toCents(1.005) === 101, 'Arredonda 1.005 para 101 centavos');
    assert(toCents(1.004) === 100, 'Arredonda 1.004 para 100 centavos');
    assert(roundToCents(0.1 + 0.2) === 0.3, 'Corrige desvio clássico de ponto flutuante 0.1 + 0.2');
    assert(fromCents(13570) === 135.7, 'Converte 13570 centavos para R$ 135.70');
  }

  // ------------------------------------------------------------------
  // 3. Preço Unitário USD e Comissão
  // ------------------------------------------------------------------
  console.log('\n🧪 GRUPO 3: Preço Unitário USD e Comissão Administrativa');
  {
    // Exemplo: Base $20.00, Comissão 20% (Markup)
    const unitMarkup = calculateUnitPricingUsd(20, 20, 'MARKUP');
    assert(unitMarkup.basePriceUsd === 20.0, 'Preço-base do professor preservado em $20.00');
    assert(unitMarkup.platformMarkupUsd === 4.0, 'Comissão administrativa calculada em $4.00 (20%)');
    assert(unitMarkup.finalPriceUsd === 24.0, 'Preço final unitário USD é $24.00');
    assert(Math.abs(unitMarkup.teacherShareRatio - 20 / 24) < 1e-6, 'Proporção do professor é 20/24 (83.33%)');

    // Exemplo: Base $20.00, Comissão 20% (Margin)
    const unitMargin = calculateUnitPricingUsd(20, 20, 'MARGIN');
    assert(unitMargin.finalPriceUsd === 25.0, 'No modelo Margin, preço final é $20 / 0.8 = $25.00');
    assert(unitMargin.platformMarkupUsd === 5.0, 'No modelo Margin, receita da plataforma é $5.00 (20% de $25)');
    assert(unitMargin.teacherShareRatio === 0.8, 'No modelo Margin, proporção do professor é 80%');

    // Borda: Comissão 0%
    const unitZero = calculateUnitPricingUsd(20, 0, 'MARKUP');
    assert(unitZero.finalPriceUsd === 20.0, 'Comissão 0% resulta em preço final igual à base');
    assert(unitZero.teacherShareRatio === 1.0, 'Comissão 0% atribui 100% da receita ao professor');

    // Borda: Comissão 100% (Markup)
    const unit100 = calculateUnitPricingUsd(20, 100, 'MARKUP');
    assert(unit100.finalPriceUsd === 40.0, 'Comissão 100% (Markup) resulta em dobro da base ($40)');
    assert(unit100.teacherShareRatio === 0.5, 'Comissão 100% (Markup) divide 50/50 o total');
  }

  // ------------------------------------------------------------------
  // 4. Pacotes Aprovados (1, 4, 8, 12 aulas) e Descontos (0%, 5%, 10%, 15%)
  // ------------------------------------------------------------------
  console.log('\n🧪 GRUPO 4: Pacotes e Descontos Aprovados');
  {
    assert(APPROVED_PACKAGES.length === 4, 'Exatamente 4 pacotes padrão definidos');
    assert(APPROVED_PACKAGES[0].lessonsCount === 1 && APPROVED_PACKAGES[0].discountPercent === 0, '1 aula: 0% desconto');
    assert(APPROVED_PACKAGES[1].lessonsCount === 4 && APPROVED_PACKAGES[1].discountPercent === 5, '4 aulas: 5% desconto');
    assert(APPROVED_PACKAGES[2].lessonsCount === 8 && APPROVED_PACKAGES[2].discountPercent === 10, '8 aulas: 10% desconto');
    assert(APPROVED_PACKAGES[3].lessonsCount === 12 && APPROVED_PACKAGES[3].discountPercent === 15, '12 aulas: 15% desconto');
  }

  // ------------------------------------------------------------------
  // 5. Cotação Completa e Rateio Proporcional (Cenário de Referência)
  // ------------------------------------------------------------------
  console.log('\n🧪 GRUPO 5: Cotação Completa e Rateio Proporcional de Descontos');
  {
    // Cenário: Professor define $20.00 USD, ADM define 20% comissão, PTAX D-1 = 5.6543
    const quote = calculateFinancialPricingQuote({
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      ptaxRate: 5.6543,
      commissionModel: 'MARKUP',
    });

    assert(quote.allInvariantsPassed, 'Todos os invariantes de centavos foram aprovados');

    // Preço Unitário BRL: $24.00 * 5.6543 = R$ 135.7032 -> R$ 135.70
    assert(quote.unit.finalPriceBrl === 135.7, 'Preço unitário BRL arredondado para R$ 135.70');
    // Unit Share: 135.70 * (20/24) = 113.0833 -> 113.08. Plataforma: 135.70 - 113.08 = 22.62
    assert(quote.unit.teacherShareBrl === 113.08, 'Participação do professor no unitário BRL é R$ 113.08');
    assert(quote.unit.platformRevenueBrl === 22.62, 'Receita da plataforma no unitário BRL é R$ 22.62');
    assert(
      roundToCents(quote.unit.teacherShareBrl + quote.unit.platformRevenueBrl) === quote.unit.finalPriceBrl,
      'Soma unitária em BRL fecha exatamente em R$ 135.70'
    );

    // Pacote 1 Aula (0% desconto)
    const p1 = quote.packages.package1;
    assert(p1.finalPriceBrl === 135.7, 'Pacote 1: R$ 135.70 cobrado do aluno');
    assert(p1.teacherShareBrl === 113.08 && p1.platformRevenueBrl === 22.62, 'Pacote 1: Split idêntico ao unitário');
    assert(p1.invariants.brlSumMatchesTotal, 'Pacote 1: Invariante BRL válida (0 centavos de diferença)');
    assert(p1.invariants.usdSumMatchesTotal, 'Pacote 1: Invariante USD válida (0 centavos de diferença)');

    // Pacote 4 Aulas (5% desconto)
    // Bruto: 4 * 135.70 = 542.80. Desconto 5%: 27.14. Final: 515.66.
    const p4 = quote.packages.package4;
    assert(p4.grossTotalBrl === 542.8, 'Pacote 4: Bruto R$ 542.80');
    assert(p4.discountAmountBrl === 27.14, 'Pacote 4: Desconto 5% = R$ 27.14');
    assert(p4.finalPriceBrl === 515.66, 'Pacote 4: Final cobrado R$ 515.66');
    // Split: 515.66 * (20/24) = 429.7166... -> 429.72. Plataforma: 515.66 - 429.72 = 85.94.
    assert(p4.teacherShareBrl === 429.72, 'Pacote 4: Professor recebe R$ 429.72');
    assert(p4.platformRevenueBrl === 85.94, 'Pacote 4: Plataforma recebe R$ 85.94');
    assert(
      roundToCents(p4.teacherShareBrl + p4.platformRevenueBrl) === p4.finalPriceBrl,
      'Pacote 4: Soma das parcelas fecha exatamente em R$ 515.66'
    );

    // Pacote 8 Aulas (10% desconto)
    // Bruto: 8 * 135.70 = 1085.60. Desconto 10%: 108.56. Final: 977.04.
    const p8 = quote.packages.package8;
    assert(p8.grossTotalBrl === 1085.6, 'Pacote 8: Bruto R$ 1085.60');
    assert(p8.discountAmountBrl === 108.56, 'Pacote 8: Desconto 10% = R$ 108.56');
    assert(p8.finalPriceBrl === 977.04, 'Pacote 8: Final cobrado R$ 977.04');
    assert(
      roundToCents(p8.teacherShareBrl + p8.platformRevenueBrl) === p8.finalPriceBrl,
      'Pacote 8: Soma das parcelas fecha exatamente em R$ 977.04'
    );

    // Pacote 12 Aulas (15% desconto)
    // Bruto: 12 * 135.70 = 1628.40. Desconto 15%: 244.26. Final: 1384.14.
    const p12 = quote.packages.package12;
    assert(p12.grossTotalBrl === 1628.4, 'Pacote 12: Bruto R$ 1628.40');
    assert(p12.discountAmountBrl === 244.26, 'Pacote 12: Desconto 15% = R$ 244.26');
    assert(p12.finalPriceBrl === 1384.14, 'Pacote 12: Final cobrado R$ 1384.14');
    assert(
      roundToCents(p12.teacherShareBrl + p12.platformRevenueBrl) === p12.finalPriceBrl,
      'Pacote 12: Soma das parcelas fecha exatamente em R$ 1384.14'
    );

    console.log('\n📊 EXEMPLO DETALHADO DO CÁLCULO (Cenário Referência):');
    console.log(`   Preço-Base Professor: $${quote.basePriceUsd.toFixed(2)} USD`);
    console.log(`   Comissão ADM: ${quote.adminCommissionPercent}%`);
    console.log(`   Preço Unitário USD: $${quote.unit.finalPriceUsd.toFixed(2)} USD`);
    console.log(`   Cotação PTAX D-1: R$ ${quote.ptaxRate}`);
    console.log(`   Preço Unitário BRL: R$ ${quote.unit.finalPriceBrl.toFixed(2)}`);
    console.log('   ---');
    for (const pkg of quote.packages.list) {
      console.log(
        `   • ${pkg.labelPt} (${pkg.lessonsCount} aulas, ${pkg.discountPercent}% OFF): ` +
        `Cobrado: R$ ${pkg.finalPriceBrl.toFixed(2)} | ` +
        `Prof: R$ ${pkg.teacherShareBrl.toFixed(2)} | ` +
        `Plataforma: R$ ${pkg.platformRevenueBrl.toFixed(2)} | ` +
        `Soma confere? ${pkg.invariants.brlSumMatchesTotal ? 'SIM' : 'NÃO'}`
      );
    }
  }

  // ------------------------------------------------------------------
  // 6. Teste de Estresse Estatístico (1.000 Combinações Randômicas)
  // ------------------------------------------------------------------
  console.log('\n🧪 GRUPO 6: Teste de Estresse (1.000 Combinações Randômicas de Preços, Comissões e PTAX)');
  {
    let stressPassed = 0;
    const TOTAL_SIMULATIONS = 1000;

    for (let i = 0; i < TOTAL_SIMULATIONS; i++) {
      // Preço-base entre $5.00 e $150.00
      const basePrice = Math.round((5 + Math.random() * 145) * 100) / 100;
      // Comissão ADM entre 0% e 99%
      const commission = Math.round(Math.random() * 99 * 10) / 10;
      // Cotação PTAX entre R$ 4.2000 e R$ 6.8000
      const ptax = Math.round((4.2 + Math.random() * 2.6) * 10000) / 10000;

      const q = calculateFinancialPricingQuote({
        basePriceUsd: basePrice,
        adminCommissionPercent: commission,
        ptaxRate: ptax,
      });

      let allPackagesConsistent = true;
      for (const p of q.packages.list) {
        if (!p.invariants.brlSumMatchesTotal || !p.invariants.usdSumMatchesTotal) {
          allPackagesConsistent = false;
          break;
        }
      }

      if (q.allInvariantsPassed && allPackagesConsistent) {
        stressPassed++;
      }
    }

    assert(
      stressPassed === TOTAL_SIMULATIONS,
      `1.000 de 1.000 simulações com soma de parcelas 100% exatas (sem divergência de centavos)`
    );
  }

  // ------------------------------------------------------------------
  // 7. Confirmação de Isolamento e Não-Regressão
  // ------------------------------------------------------------------
  console.log('\n🧪 GRUPO 7: Confirmação de Isolamento e Ausência de Side-Effects');
  {
    // Verificar que a função é puramente síncrona e não altera nenhum estado externo
    const quote1 = calculateFinancialPricingQuote({ basePriceUsd: 25, adminCommissionPercent: 15, ptaxRate: 5.6 });
    const quote2 = calculateFinancialPricingQuote({ basePriceUsd: 25, adminCommissionPercent: 15, ptaxRate: 5.6 });
    assert(
      JSON.stringify(quote1) === JSON.stringify(quote2),
      'Determinismo referencial: duas execuções com mesmos inputs geram saída idêntica'
    );
  }

  console.log('\n======================================================');
  console.log(`🏁 RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
