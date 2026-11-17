/**
 * Authoritative Student-Facing Pricing Quote Client (FIN.2C)
 *
 * Consumes ONLY backend-calculated BRL pricing quotes (financialEngine + PTAX D-1 + persisted MARKUP commission).
 * Never performs financial calculations, commission inference, or fixed-rate (5.5) fallbacks on the frontend.
 */

export interface PublicPackageQuoteItem {
  lessonsCount: number;
  discountPercent: number;
  labelPt: string;
  labelEn: string;
  grossTotalBrl: number;
  discountAmountBrl: number;
  finalPriceBrl: number;
  effectiveLessonPriceBrl: number;
  isPopular?: boolean;
  isBestValue?: boolean;
}

export interface PublicTutorPricingQuoteDto {
  success: true;
  commercializable: true;
  tutorId: string;
  publicTutorId: string;
  tutorName: string;
  currency: 'BRL';
  lessonDurationMinutes: number;
  ptax: {
    rate: number;
    quoteDate: string;
    pricingDate: string;
    source: string;
    tipoBoletim?: string;
  };
  unit: {
    finalPriceBrl: number;
  };
  lowestEffectiveLessonPriceBrl: number;
  packages: PublicPackageQuoteItem[];
}

export interface TutorQuoteUnavailableInfo {
  commercializable: false;
  error: string;
  message: string;
  httpStatus?: number;
}

export interface BatchPricingQuotesSuccess {
  success: true;
  currency: 'BRL';
  ptax: PublicTutorPricingQuoteDto['ptax'];
  quotesByTutorId: Record<string, PublicTutorPricingQuoteDto>;
  unavailableByTutorId: Record<string, TutorQuoteUnavailableInfo>;
}

export interface BatchPricingQuotesFailure {
  success: false;
  error: string;
  message: string;
  httpStatus: number;
}

export type BatchPricingQuotesResult = BatchPricingQuotesSuccess | BatchPricingQuotesFailure;

export type SinglePricingQuoteResult =
  | PublicTutorPricingQuoteDto
  | (TutorQuoteUnavailableInfo & { success: false });

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBrl(amount: number): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'R$ —';
  }
  return BRL_FORMATTER.format(amount);
}

export function getTutorQuoteLookupKeys(tutor: {
  id?: string | null;
  publicTutorId?: string | null;
  uid?: string | null;
  authUid?: string | null;
} | null | undefined): string[] {
  if (!tutor || typeof tutor !== 'object') return [];
  const raw = [tutor.id, tutor.publicTutorId, tutor.uid, tutor.authUid];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const val of raw) {
    if (typeof val === 'string') {
      const clean = val.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        result.push(clean);
      }
      const lower = clean.toLowerCase();
      if (lower && !seen.has(lower)) {
        seen.add(lower);
        result.push(lower);
      }
    }
  }
  return result;
}

export function findQuoteForTutor(
  tutor: {
    id?: string | null;
    publicTutorId?: string | null;
    uid?: string | null;
    authUid?: string | null;
  } | null | undefined,
  quotesByTutorId: Record<string, PublicTutorPricingQuoteDto>,
  unavailableByTutorId?: Record<string, TutorQuoteUnavailableInfo>
): {
  quote: PublicTutorPricingQuoteDto | null;
  unavailable: TutorQuoteUnavailableInfo | null;
} {
  const keys = getTutorQuoteLookupKeys(tutor);
  for (const k of keys) {
    if (quotesByTutorId[k]) {
      return { quote: quotesByTutorId[k], unavailable: null };
    }
  }
  if (unavailableByTutorId) {
    for (const k of keys) {
      if (unavailableByTutorId[k]) {
        return { quote: null, unavailable: unavailableByTutorId[k] };
      }
    }
  }
  return { quote: null, unavailable: null };
}

export async function fetchBatchTutorPricingQuotes(): Promise<BatchPricingQuotesResult> {
  try {
    const res = await fetch('/api/financial/pricing-quotes', {
      method: 'GET',
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.success !== true) {
      return {
        success: false,
        error: payload?.error || `HTTP_${res.status}`,
        message:
          payload?.message ||
          'Cotação oficial de preços indisponível no momento.',
        httpStatus: res.status || 503,
      };
    }

    return {
      success: true,
      currency: 'BRL',
      ptax: payload.ptax,
      quotesByTutorId: payload.quotesByTutorId || {},
      unavailableByTutorId: payload.unavailableByTutorId || {},
    };
  } catch (err: any) {
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: err?.message || 'Falha de comunicação ao consultar preços.',
      httpStatus: 0,
    };
  }
}

export async function fetchSingleTutorPricingQuote(
  tutorIdentifier: string
): Promise<SinglePricingQuoteResult> {
  const cleanId = (tutorIdentifier || '').trim();
  if (!cleanId) {
    return {
      success: false,
      commercializable: false,
      error: 'INVALID_TUTOR_IDENTIFIER',
      message: 'Identificador do Amigo Nativo inválido.',
      httpStatus: 400,
    };
  }

  try {
    const res = await fetch(`/api/financial/pricing-quote/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.success !== true) {
      return {
        success: false,
        commercializable: false,
        error: payload?.error || `HTTP_${res.status}`,
        message:
          payload?.message ||
          'Cotação oficial indisponível para este Amigo Nativo.',
        httpStatus: res.status || 503,
      };
    }

    return payload as PublicTutorPricingQuoteDto;
  } catch (err: any) {
    return {
      success: false,
      commercializable: false,
      error: 'NETWORK_ERROR',
      message: err?.message || 'Falha de comunicação ao consultar cotação.',
      httpStatus: 0,
    };
  }
}
