import apiClient, { ApiError } from './apiClient';
import type { SwitchExecuteResponseDto, SwitchPreviewResponseDto } from '../types';

export interface SwitchApiFailure {
  success: false;
  statusCode: number;
  errorCode: string;
  message: string;
  details?: Record<string, any>;
}

export type SwitchPreviewApiResult =
  | (SwitchPreviewResponseDto & { errorCode?: never })
  | SwitchApiFailure;

export type SwitchExecuteApiResult =
  | (SwitchExecuteResponseDto & { errorCode?: never })
  | SwitchApiFailure;

const BRL_CENTS_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatBrlFromCents(cents: number | null | undefined): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) {
    return 'R$ —';
  }
  return BRL_CENTS_FORMATTER.format(cents / 100);
}

export function createSwitchIdempotencyKey(targetTeacherId?: string): string {
  const cleanTarget = (targetTeacherId || 'tutor').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'tutor';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `nf-sw-${cleanTarget}-${crypto.randomUUID()}`;
  }
  return `nf-sw-${cleanTarget}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function requestNativeFriendSwitchPreview(params: {
  targetTeacherId: string;
  expectedCurrentTeacherUid?: string;
}): Promise<SwitchPreviewApiResult> {
  const cleanTarget = (params.targetTeacherId || '').trim();
  if (!cleanTarget) {
    return {
      success: false,
      statusCode: 400,
      errorCode: 'TARGET_TEACHER_REQUIRED',
      message: 'Identificador do Amigo Nativo de destino é obrigatório.',
    };
  }

  try {
    const res = await apiClient.post<SwitchPreviewResponseDto>(
      '/api/students/switch-native-friend/preview',
      {
        targetTeacherUid: cleanTarget,
        ...(params.expectedCurrentTeacherUid ? { expectedCurrentTeacherUid: params.expectedCurrentTeacherUid } : {}),
      }
    );
    return res;
  } catch (err: any) {
    if (err instanceof ApiError) {
      return {
        success: false,
        statusCode: err.status,
        errorCode: String(err.data?.error || err.code || `HTTP_${err.status}`),
        message: String(err.data?.message || err.message || 'Falha ao gerar prévia no servidor.'),
        ...(err.data?.details ? { details: err.data.details } : {}),
      };
    }
    return {
      success: false,
      statusCode: 0,
      errorCode: 'NETWORK_ERROR',
      message: err?.message || 'Falha de conexão ao calcular prévia no servidor.',
    };
  }
}

export async function confirmNativeFriendSwitch(params: {
  targetTeacherUid: string;
  expectedCurrentTeacherUid?: string;
  previewToken: string;
  previewSnapshotHash: string;
  idempotencyKey: string;
}): Promise<SwitchExecuteApiResult> {
  try {
    const res = await apiClient.post<SwitchExecuteResponseDto>(
      '/api/students/switch-native-friend',
      {
        targetTeacherUid: params.targetTeacherUid,
        ...(params.expectedCurrentTeacherUid ? { expectedCurrentTeacherUid: params.expectedCurrentTeacherUid } : {}),
        previewToken: params.previewToken,
        previewSnapshotHash: params.previewSnapshotHash,
        idempotencyKey: params.idempotencyKey,
      }
    );
    return res;
  } catch (err: any) {
    if (err instanceof ApiError) {
      return {
        success: false,
        statusCode: err.status,
        errorCode: String(err.data?.error || err.code || `HTTP_${err.status}`),
        message: String(err.data?.message || err.message || 'Falha ao confirmar troca no servidor.'),
        ...(err.data?.details ? { details: err.data.details } : {}),
      };
    }
    return {
      success: false,
      statusCode: 0,
      errorCode: 'NETWORK_ERROR',
      message: err?.message || 'Falha de conexão ao confirmar troca no servidor.',
    };
  }
}

export interface BilingualSwitchErrorCopy {
  title: string;
  message: string;
  requiresPreviewRefresh: boolean;
}

export function getBilingualSwitchError(
  errorCode: string | undefined,
  rawMessage: string | undefined,
  isEn: boolean
): BilingualSwitchErrorCopy {
  const code = String(errorCode || '').trim().toUpperCase();

  switch (code) {
    case 'PREVIEW_EXPIRED':
      return {
        title: isEn ? 'Preview Expired' : 'Prévia Expirada',
        message: isEn
          ? 'The financial preview expired before confirmation. Refresh the preview to load current server values.'
          : 'A prévia financeira expirou antes da confirmação. Atualize a prévia para obter os valores atuais do servidor.',
        requiresPreviewRefresh: true,
      };
    case 'PREVIEW_STALE_BALANCE_CHANGED':
      return {
        title: isEn ? 'Credit Balance Changed' : 'Saldo de Créditos Alterado',
        message: isEn
          ? 'Your available lesson balance or credit lots changed after this preview was generated. Refresh the preview before confirming.'
          : 'Seu saldo disponível ou lotes de crédito foram alterados após a geração desta prévia. Atualize a prévia antes de confirmar.',
        requiresPreviewRefresh: true,
      };
    case 'PREVIEW_STALE_LESSONS_CHANGED':
      return {
        title: isEn ? 'Scheduled Lessons Changed' : 'Aulas Agendadas Alteradas',
        message: isEn
          ? 'Your scheduled lessons or cancellation eligibility changed after this preview. Refresh the preview to recalculate.'
          : 'Suas aulas agendadas ou a elegibilidade de estorno Q2 mudaram após a geração desta prévia. Atualize a prévia para recalcular.',
        requiresPreviewRefresh: true,
      };
    case 'PREVIEW_STALE_PRICE_CHANGED':
      return {
        title: isEn ? 'Target Teacher Price Updated' : 'Preço do Amigo Nativo Atualizado',
        message: isEn
          ? 'The selected Native Friend pricing changed after this preview was generated. Refresh the preview to view the updated calculation.'
          : 'A precificação do Amigo Nativo de destino foi atualizada após a geração desta prévia. Atualize a prévia para prosseguir.',
        requiresPreviewRefresh: true,
      };
    case 'PREVIEW_STALE_PTAX_CHANGED':
      return {
        title: isEn ? 'Official PTAX Rate Updated' : 'Cotação PTAX D-1 Atualizada',
        message: isEn
          ? 'The official BACEN PTAX D-1 exchange rate updated after this preview was generated. Refresh the preview before confirming.'
          : 'A cotação oficial BACEN PTAX D-1 foi atualizada após a prévia. Atualize a prévia antes de confirmar.',
        requiresPreviewRefresh: true,
      };
    case 'PREVIEW_STALE_CONVERSION_CHANGED':
    case 'PREVIEW_BINDING_INVALID':
    case 'PREVIEW_TARGET_MISMATCH':
    case 'PREVIEW_BINDING_INCOMPLETE':
    case 'CONCURRENCY_CONFLICT':
      return {
        title: isEn ? 'Preview Needs Refresh' : 'Prévia Desatualizada',
        message: isEn
          ? 'Account or pricing data changed since the preview was calculated. Refresh the preview to continue safely.'
          : 'Os dados da conta ou cotação foram alterados desde o cálculo desta prévia. Atualize a prévia para confirmar com segurança.',
        requiresPreviewRefresh: true,
      };
    case 'LEGACY_UNRECONCILED_PRESENT':
      return {
        title: isEn ? 'Administrative Credit Reconciliation Required' : 'Conciliação Administrativa Necessária',
        message: isEn
          ? 'Your account contains legacy unreconciled credits without verified BRL origin. An administrator must reconcile them before switching.'
          : 'Sua conta possui créditos legados sem conciliação financeira verificada. Solicite a conciliação administrativa antes de trocar de Amigo Nativo.',
        requiresPreviewRefresh: false,
      };
    case 'INSUFFICIENT_BUDGET_FOR_MINIMUM_LESSON':
      return {
        title: isEn ? 'Insufficient Budget for 1 Lesson' : 'Orçamento Insuficiente para 1 Aula',
        message: isEn
          ? 'Your remaining paid BRL budget does not cover 1 full lesson with this Native Friend. Choose another Native Friend or contact support.'
          : 'Seu orçamento disponível em reais não cobre o valor de 1 aula completa com este Amigo Nativo. Escolha outro Amigo Nativo ou fale com o suporte.',
        requiresPreviewRefresh: false,
      };
    case 'PTAX_UNAVAILABLE':
      return {
        title: isEn ? 'Official PTAX D-1 Unavailable' : 'Cotação Oficial PTAX D-1 Indisponível',
        message: isEn
          ? 'The official BACEN PTAX D-1 exchange rate could not be retrieved right now. Switching is paused to guarantee accurate conversion.'
          : 'A cotação oficial BACEN PTAX D-1 está indisponível no momento. A troca foi bloqueada temporariamente sem estimativas fictícias.',
        requiresPreviewRefresh: true,
      };
    case 'TUTOR_NOT_APPROVED':
    case 'TUTOR_BASE_PRICE_UNAVAILABLE':
    case 'TUTOR_COMMISSION_NOT_CONFIGURED':
      return {
        title: isEn ? 'Native Friend Unavailable for Switch' : 'Amigo Nativo Indisponível para Troca',
        message: isEn
          ? 'This Native Friend is not currently approved and configured with official commercial pricing.'
          : 'Este Amigo Nativo não está aprovado e configurado comercialmente para receber transferências de saldo no momento.',
        requiresPreviewRefresh: false,
      };
    case 'SAME_TEACHER_SWITCH_FORBIDDEN':
      return {
        title: isEn ? 'Already Your Current Native Friend' : 'Este já é Seu Amigo Nativo Atual',
        message: isEn
          ? 'Select a different Native Friend from your current mentor.'
          : 'Selecione um Amigo Nativo diferente do seu Amigo Nativo atual.',
        requiresPreviewRefresh: false,
      };
    case 'NO_ACTIVE_NATIVE_FRIEND_LINK':
      return {
        title: isEn ? 'No Active Native Friend Link' : 'Sem Vínculo Ativo',
        message: isEn
          ? 'Your account does not currently have an active Native Friend link to switch from.'
          : 'Sua conta não possui um vínculo ativo com um Amigo Nativo para realizar troca.',
        requiresPreviewRefresh: false,
      };
    case 'FIRESTORE_TIMEOUT':
      return {
        title: isEn ? 'Request Timed Out' : 'Tempo Limite Excedido',
        message: isEn
          ? 'The server took too long to complete the transaction. No changes were saved—you may safely try again.'
          : 'O servidor demorou para responder e nenhuma alteração foi gravada. Você pode tentar confirmar novamente com segurança.',
        requiresPreviewRefresh: false,
      };
    case 'UNAUTHORIZED':
    case 'FORBIDDEN':
    case 'FORBIDDEN_ROLE':
      return {
        title: isEn ? 'Authentication Required' : 'Permissão Negada',
        message: isEn
          ? 'Sign in with your student account to preview and confirm a Native Friend switch.'
          : 'Autentique-se na sua própria conta de estudante para visualizar a prévia e confirmar a troca.',
        requiresPreviewRefresh: false,
      };
    default:
      return {
        title: isEn ? 'Unable to Process Switch' : 'Não Foi Possível Concluir a Troca',
        message:
          rawMessage ||
          (isEn
            ? 'An unexpected error prevented the switch. Refresh the preview and try again.'
            : 'Ocorreu uma falha ao processar a solicitação. Atualize a prévia e tente novamente.'),
        requiresPreviewRefresh: code.startsWith('PREVIEW_'),
      };
  }
}
