import fs from 'node:fs';
import path from 'node:path';
import {
  extractRawBaseUsd,
  buildCandidateMailtoHref,
  resolveTutorVideoPresentation,
  computeAdminCandidatePricingSummary,
} from '../src/components/AdminApprovalsModal';
import { calculateFinancialPricingQuote } from '../src/utils/financialEngine';
import type { NativeFriendTutor } from '../src/types';
import type { PublicTutorPricingQuoteDto } from '../src/utils/pricingQuoteClient';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

function makeTutor(overrides: Partial<NativeFriendTutor> = {}): NativeFriendTutor {
  return {
    id: 'tutor-test-1',
    uid: 'tutor-test-1',
    name: 'Sarah Johnson',
    email: 'sarah.candidate@example.com',
    avatar: 'https://example.com/avatar.png',
    country: 'United States',
    flag: '🇺🇸',
    accent: 'American',
    headline: 'Native English Speaker from Austin',
    bio: 'I love helping Brazilian professionals speak naturally.',
    specialties: ['Business English', 'Conversation'],
    languagesSpoken: ['English', 'Portuguese'],
    availableDays: ['monday', 'wednesday', 'friday'],
    pricePerSessionUsd: 20,
    approvalStatus: 'pending',
    isApproved: false,
    status: 'pending',
    appliedAt: '2026-11-10T14:30:00.000Z',
    ...overrides,
  };
}

function runAdmNf1Validation() {
  console.log('\n======================================================================');
  console.log('=== VALIDATION: ADM.NF.1 — AVALIAÇÃO DE CANDIDATOS NATIVE FRIENDS   ===');
  console.log('======================================================================\n');

  // -------------------------------------------------------------------------
  // 1. Extração de Preço-base USD persistido (sem dados fictícios)
  // -------------------------------------------------------------------------
  console.log('--- 1. extractRawBaseUsd (dados persistidos sem valores fictícios) ---');
  {
    assert(extractRawBaseUsd(makeTutor({ pricePerSessionUsd: 25 })) === 25, 'Extrai pricePerSessionUsd numérico');
    assert(extractRawBaseUsd(makeTutor({ pricePerSessionUsd: '18.5' as any })) === 18.5, 'Converte string numérica válida');
    assert(extractRawBaseUsd(makeTutor({ pricePerSessionUsd: '' as any })) === null, 'String vazia retorna null (não converte para 0)');
    assert(extractRawBaseUsd(makeTutor({ pricePerSessionUsd: undefined })) === null, 'Valor ausente retorna null');
    assert(extractRawBaseUsd({ hourlyRateUsd: 30 } as any) === 30, 'Suporta fallback legado hourlyRateUsd quando persistido');
    assert(extractRawBaseUsd(makeTutor({ pricePerSessionUsd: -10 })) === null, 'Valor negativo é rejeitado como null');
  }

  // -------------------------------------------------------------------------
  // 2. Contact Candidate via mailto: com o e-mail cadastrado
  // -------------------------------------------------------------------------
  console.log('\n--- 2. buildCandidateMailtoHref (Contact Candidate via mailto:) ---');
  {
    const hrefPt = buildCandidateMailtoHref(
      { name: 'Sarah Johnson', email: 'sarah.candidate@example.com' },
      false
    );
    assert(
      Boolean(hrefPt && hrefPt.startsWith('mailto:sarah.candidate@example.com?subject=') && hrefPt.includes('&body=')),
      'Gera link mailto: válido com subject e body codificados (PT)'
    );

    const hrefEn = buildCandidateMailtoHref(
      { name: 'Sarah Johnson', email: '  sarah@example.com \r\n ' },
      true
    );
    assert(
      Boolean(hrefEn && hrefEn.startsWith('mailto:sarah@example.com?subject=') && !hrefEn.includes('\r') && !hrefEn.includes('\n')),
      'Sanitiza espaços e quebras de linha no e-mail cadastrado (EN)'
    );

    assert(buildCandidateMailtoHref({ name: 'No Email', email: '' }, true) === null, 'Retorna null quando e-mail está vazio');
    assert(buildCandidateMailtoHref({ name: 'Invalid Email', email: 'not-an-email' }, false) === null, 'Retorna null quando e-mail não é válido');
  }

  // -------------------------------------------------------------------------
  // 3. View Application — Vídeo de apresentação (YouTube, Shorts/Live, MP4, ausente, XSS)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. resolveTutorVideoPresentation (vídeo de apresentação do candidato) ---');
  {
    const ytWatch = resolveTutorVideoPresentation(
      makeTutor({ videoIntroUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    );
    assert(
      ytWatch.hasVideo &&
        ytWatch.youtubeId === 'dQw4w9WgXcQ' &&
        ytWatch.embedUrl === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1' &&
        !ytWatch.isDirectVideo,
      'Resolve URL padrão youtube.com/watch para embed youtube-nocookie'
    );

    const ytShorts = resolveTutorVideoPresentation(
      makeTutor({ youtubeUrl: 'https://www.youtube.com/shorts/AbCdEf12345' })
    );
    assert(
      ytShorts.hasVideo &&
        ytShorts.youtubeId === 'AbCdEf12345' &&
        ytShorts.embedUrl?.includes('/embed/AbCdEf12345') === true,
      'Resolve URL youtube.com/shorts para embed'
    );

    const ytEmbedOnly = resolveTutorVideoPresentation(
      makeTutor({ youtubeEmbedId: 'XyZ12345678' })
    );
    assert(
      ytEmbedOnly.hasVideo &&
        ytEmbedOnly.youtubeId === 'XyZ12345678' &&
        ytEmbedOnly.watchUrl === 'https://www.youtube.com/watch?v=XyZ12345678',
      'Resolve quando apenas youtubeEmbedId está persistido'
    );

    const mp4Video = resolveTutorVideoPresentation(
      makeTutor({ videoUrl: 'https://cdn.example.com/videos/intro.mp4' })
    );
    assert(
      mp4Video.hasVideo &&
        mp4Video.isDirectVideo &&
        mp4Video.embedUrl === null &&
        mp4Video.rawUrl === 'https://cdn.example.com/videos/intro.mp4',
      'Resolve URL HTTPS direta (.mp4) como player de vídeo HTML5'
    );

    const unsafeVideo = resolveTutorVideoPresentation(
      makeTutor({ videoIntroUrl: 'javascript:alert(1)' })
    );
    assert(!unsafeVideo.hasVideo, 'Rejeita esquema inseguro javascript: no campo de vídeo');

    const noVideo = resolveTutorVideoPresentation(makeTutor());
    assert(!noVideo.hasVideo && noVideo.embedUrl === null && noVideo.watchUrl === null, 'Candidato sem vídeo retorna hasVideo=false sem inventar URL');
  }

  // -------------------------------------------------------------------------
  // 4. Precificação ADM via FIN.2C / PTAX D-1 (sem fallback 5.5 ou comissão default)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. computeAdminCandidatePricingSummary (FIN.2C / MARKUP / PTAX D-1) ---');
  {
    const ptaxMeta: PublicTutorPricingQuoteDto['ptax'] = {
      rate: 5.0,
      quoteDate: '2026-11-17',
      pricingDate: '2026-11-18',
      source: 'BACEN_PTAX_D1',
    };

    // 4a. Tutor aprovado com cotação oficial FIN.2C
    const approvedTutor = makeTutor({
      approvalStatus: 'approved',
      isApproved: true,
      pricePerSessionUsd: 20,
      adminCommissionPercent: 25,
      commissionModel: 'MARKUP',
      commissionVersion: 2,
    });
    const expectedFromEngine = calculateFinancialPricingQuote({
      basePriceUsd: 20,
      adminCommissionPercent: 25,
      ptaxRate: 5.0,
      commissionModel: 'MARKUP',
      conversionBase: 'UNIT_PRICE_BRL',
    });
    const officialQuote: PublicTutorPricingQuoteDto = {
      success: true,
      tutorId: approvedTutor.id,
      publicTutorId: approvedTutor.id,
      tutorName: approvedTutor.name,
      commercializable: true,
      currency: 'BRL',
      lessonDurationMinutes: 50,
      unit: {
        finalPriceBrl: expectedFromEngine.unit.finalPriceBrl,
      },
      lowestEffectiveLessonPriceBrl:
        expectedFromEngine.packages.list[expectedFromEngine.packages.list.length - 1]
          .effectiveLessonPriceBrl,
      packages: expectedFromEngine.packages.list.map((p) => ({
        lessonsCount: p.lessonsCount,
        discountPercent: p.discountPercent,
        labelPt: `${p.lessonsCount} aula(s)`,
        labelEn: `${p.lessonsCount} lesson(s)`,
        grossTotalBrl: p.grossTotalBrl,
        discountAmountBrl: p.discountAmountBrl,
        finalPriceBrl: p.finalPriceBrl,
        effectiveLessonPriceBrl: p.effectiveLessonPriceBrl,
      })),
      ptax: ptaxMeta,
    };

    const summaryApproved = computeAdminCandidatePricingSummary({
      tutor: approvedTutor,
      officialQuote,
      ptaxMeta,
    });
    assert(
      summaryApproved.publicPriceSource === 'fin2c_batch_quote' &&
        summaryApproved.basePriceUsd === 20 &&
        summaryApproved.activeCommissionPercent === 25 &&
        summaryApproved.commissionModel === 'MARKUP' &&
        summaryApproved.publicPriceBrl === expectedFromEngine.unit.finalPriceBrl &&
        summaryApproved.packages.length === 4,
      'Tutor aprovado exibe base USD, comissão MARKUP v2 e preço público BRL da cotação oficial FIN.2C'
    );

    // 4b. Candidato pendente/rejeitado já com comissão persistida + PTAX D-1 -> usa engine FIN.2C
    const pendingWithCommission = makeTutor({
      pricePerSessionUsd: 20,
      adminCommissionPercent: 20,
      commissionModel: 'MARKUP',
      commissionVersion: 1,
    });
    const summaryPendingComm = computeAdminCandidatePricingSummary({
      tutor: pendingWithCommission,
      ptaxMeta,
    });
    const expected20 = calculateFinancialPricingQuote({
      basePriceUsd: 20,
      adminCommissionPercent: 20,
      ptaxRate: 5.0,
      commissionModel: 'MARKUP',
      conversionBase: 'UNIT_PRICE_BRL',
    });
    assert(
      summaryPendingComm.publicPriceSource === 'fin2c_engine_ptax' &&
        summaryPendingComm.publicPriceBrl === expected20.unit.finalPriceBrl &&
        summaryPendingComm.activeCommissionPercent === 20,
      'Candidato com comissão persistida calcula preço BRL exatamente pelo motor FIN.2C + PTAX D-1'
    );

    // 4c. Candidato pendente SEM comissão configurada e COM simulação digitada pelo ADM
    const pendingNoComm = makeTutor({
      pricePerSessionUsd: 20,
      adminCommissionPercent: undefined,
    });
    const summaryPendingNoComm = computeAdminCandidatePricingSummary({
      tutor: pendingNoComm,
      ptaxMeta,
      draftCommissionInput: '15',
    });
    const expected15 = calculateFinancialPricingQuote({
      basePriceUsd: 20,
      adminCommissionPercent: 15,
      ptaxRate: 5.0,
      commissionModel: 'MARKUP',
      conversionBase: 'UNIT_PRICE_BRL',
    });
    assert(
      summaryPendingNoComm.publicPriceSource === 'missing_commission' &&
        summaryPendingNoComm.publicPriceBrl === null &&
        summaryPendingNoComm.activeCommissionPercent === null &&
        summaryPendingNoComm.previewCommissionPercent === 15 &&
        summaryPendingNoComm.previewPriceBrl === expected15.unit.finalPriceBrl,
      'Sem comissão persistida, não inventa comissão default e calcula simulação do rascunho via FIN.2C'
    );

    // 4d. PTAX indisponível -> NÃO usa taxa fallback (ex.: 5.5)
    const summaryNoPtax = computeAdminCandidatePricingSummary({
      tutor: pendingWithCommission,
      ptaxMeta: null,
      ptaxErrorCode: 'PTAX_UNAVAILABLE',
    });
    assert(
      summaryNoPtax.publicPriceSource === 'ptax_unavailable' &&
        summaryNoPtax.publicPriceBrl === null &&
        summaryNoPtax.ptaxRate === null,
      'Quando PTAX D-1 está indisponível, retorna ptax_unavailable sem fallback de câmbio fixo'
    );

    // 4e. Preço base USD ausente
    const summaryNoUsd = computeAdminCandidatePricingSummary({
      tutor: makeTutor({ pricePerSessionUsd: undefined }),
      ptaxMeta,
    });
    assert(
      summaryNoUsd.publicPriceSource === 'missing_base_usd' && summaryNoUsd.publicPriceBrl === null,
      'Quando preço-base USD está ausente, retorna missing_base_usd sem inventar valor'
    );
  }

  // -------------------------------------------------------------------------
  // 5. Verificações estruturais, segurança e isolamento de escopo
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Verificação estática: ADM-only, controles preservados e zero exposição pública ---');
  {
    const adminModalSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/AdminApprovalsModal.tsx'),
      'utf-8'
    );
    const findTutorsSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/components/FindTutorsSection.tsx'),
      'utf-8'
    );

    assert(
      adminModalSrc.includes('View Application') &&
        adminModalSrc.includes('id="admin-view-application-modal"'),
      'AdminApprovalsModal contém botão e modal dedicado "View Application"'
    );
    assert(
      adminModalSrc.includes('Contact Candidate') &&
        adminModalSrc.includes('href={mailtoHref}') &&
        adminModalSrc.includes('mailto:${cleanEmail}'),
      'AdminApprovalsModal contém ação "Contact Candidate" via mailto: com o e-mail cadastrado'
    );
    assert(
      !adminModalSrc.includes('smtp') && !adminModalSrc.includes('nodemailer'),
      'Nenhum envio SMTP ou sistema próprio de mensagens adicionado'
    );
    assert(
      adminModalSrc.includes("commissionInputs[tutorKey] ?? ''") &&
        adminModalSrc.includes('Comissão da Plataforma (%)') &&
        adminModalSrc.includes('onApproveTutor') &&
        adminModalSrc.includes('onRejectTutor') &&
        adminModalSrc.includes('onUpdateTutorCommission'),
      'Controles existentes de aprovação, rejeição e atualização de comissão preservados'
    );
    assert(
      adminModalSrc.includes('useBatchTutorPricingQuotes') &&
        adminModalSrc.includes('calculateFinancialPricingQuote') &&
        adminModalSrc.includes('/api/financial/ptax'),
      'Precificação do painel ADM consome exclusivamente o mecanismo FIN.2C / PTAX vigente'
    );
    assert(
      !findTutorsSrc.includes('{tutor.email}') &&
        !findTutorsSrc.includes('mailto:') &&
        !findTutorsSrc.includes('adminCommissionPercent') &&
        !findTutorsSrc.includes('View Application') &&
        !findTutorsSrc.includes('Contact Candidate'),
      'Página pública FindTutorsSection NÃO renderiza e-mail privado, mailto:, comissão ADM ou controles ADM.NF.1'
    );
  }

  console.log('\n======================================================================');
  console.log(`TOTAL ADM.NF.1: ${passed + failed} | PASSOU: ${passed} | FALHOU: ${failed}`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runAdmNf1Validation();
