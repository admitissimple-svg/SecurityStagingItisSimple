/**
 * Centralized HTTP Client for "It's Simple" Application
 * 
 * Features:
 * 1. Base URL configuration (via VITE_BACKEND_API_URL or programmatic setApiBaseUrl).
 * 2. Secure Firebase ID Token forwarding (Authorization: Bearer <token>).
 * 3. Uniform error classification and handling for 401, 403, 500, 503.
 * 4. Global error subscription (onApiError) and browser CustomEvents.
 * 5. Safe relative-path fallback preserving existing published applet behavior.
 */

import { auth } from '../firebase';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
  params?: Record<string, string | number | boolean | null | undefined>;
  token?: string | null;
  forceRefreshToken?: boolean;
  skipAuth?: boolean;
  timeoutMs?: number;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly code: ApiErrorCode;
  public readonly data: any;
  public readonly endpoint: string;
  public readonly timestamp: string;

  constructor(
    status: number,
    statusText: string,
    message: string,
    data?: any,
    endpoint: string = ''
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.data = data;
    this.endpoint = endpoint;
    this.timestamp = new Date().toISOString();

    // Map status code to standard code enum
    switch (status) {
      case 401:
        this.code = 'UNAUTHORIZED';
        break;
      case 403:
        this.code = 'FORBIDDEN';
        break;
      case 404:
        this.code = 'NOT_FOUND';
        break;
      case 400:
        this.code = 'BAD_REQUEST';
        break;
      case 500:
        this.code = 'SERVER_ERROR';
        break;
      case 502:
      case 503:
      case 504:
        this.code = 'SERVICE_UNAVAILABLE';
        break;
      default:
        this.code = status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR';
    }

    Object.setPrototypeOf(this, ApiError.prototype);
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isServerError(): boolean {
    return this.status === 500;
  }

  get isServiceUnavailable(): boolean {
    return this.status === 503 || this.status === 502 || this.status === 504;
  }
}

// Global listeners for centralized monitoring and UI alerting
export type ApiErrorHandler = (error: ApiError) => void;
const errorListeners: Set<ApiErrorHandler> = new Set();

export function onApiError(handler: ApiErrorHandler): () => void {
  errorListeners.add(handler);
  return () => {
    errorListeners.delete(handler);
  };
}

function notifyError(error: ApiError): void {
  errorListeners.forEach((listener) => {
    try {
      listener(error);
    } catch (listenerErr) {
      console.warn('[apiClient] Error in onApiError listener:', listenerErr);
    }
  });

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('itissimple:api-error', { detail: error }));
      window.dispatchEvent(
        new CustomEvent(`itissimple:api-error:${error.status}`, { detail: error })
      );
    } catch {
      // Ignore event dispatch failure in non-browser or test runner environments
    }
  }
}

// Resolves base URL dynamically:
// Default: empty string ('') for relative same-origin routing in current published applet
// Dedicated backend: configured via VITE_BACKEND_API_URL or programmatic setApiBaseUrl
let configuredBaseUrl: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_BACKEND_API_URL)
    ? String((import.meta as any).env.VITE_BACKEND_API_URL).trim().replace(/\/+$/, '')
    : '';

export function setApiBaseUrl(url: string): void {
  configuredBaseUrl = (url || '').trim().replace(/\/+$/, '');
}

export function getApiBaseUrl(): string {
  return configuredBaseUrl;
}

export function buildApiUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  let fullUrl: string;

  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    fullUrl = endpoint;
  } else {
    const base = getApiBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    fullUrl = base ? `${base}${cleanEndpoint}` : cleanEndpoint;
  }

  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null) {
        searchParams.append(key, String(val));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
    }
  }

  return fullUrl;
}

/**
 * Resolves Firebase ID token securely.
 * Prioritizes explicit token passed in options, otherwise requests current Firebase Auth user ID token.
 */
async function resolveAuthToken(options?: RequestOptions): Promise<string | null> {
  if (options?.skipAuth) {
    return null;
  }

  if (options?.token) {
    return options.token;
  }

  try {
    if (auth && auth.currentUser) {
      return await auth.currentUser.getIdToken(Boolean(options?.forceRefreshToken));
    }
  } catch (err) {
    console.warn('[apiClient] Notice retrieving Firebase ID token:', err);
  }

  return null;
}

/**
 * Core centralized request executor with uniform error handling
 */
export async function request<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const url = buildApiUrl(endpoint, options.params);
  const headers = new Headers(options.headers || {});

  // Add default content-type if body is provided and not FormData
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!headers.has('Content-Type') && options.body && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }

  // Attach Firebase ID token securely if available
  if (!headers.has('Authorization')) {
    const token = await resolveAuthToken(options);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  // Serialize JSON body if object provided
  let bodyPayload: BodyInit | null | undefined = options.body;
  if (
    options.body &&
    typeof options.body === 'object' &&
    !isFormData &&
    !(options.body instanceof Blob) &&
    !(options.body instanceof ArrayBuffer)
  ) {
    bodyPayload = JSON.stringify(options.body);
  }

  const fetchInit: RequestInit = {
    ...options,
    headers,
    body: bodyPayload,
  };

  // Timeout handling via AbortController
  let timeoutId: any = null;
  if (options.timeoutMs && options.timeoutMs > 0) {
    const controller = new AbortController();
    fetchInit.signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchInit);
  } catch (netErr: any) {
    if (timeoutId) clearTimeout(timeoutId);
    const isAbort = netErr?.name === 'AbortError';
    const message = isAbort
      ? `Requisição expirou após ${options.timeoutMs}ms para ${endpoint}`
      : `Falha de rede ou conectividade com o servidor: ${netErr?.message || 'Host indisponível'}`;

    const apiErr = new ApiError(
      isAbort ? 504 : 0,
      isAbort ? 'Gateway Timeout' : 'Network Error',
      message,
      { originalError: netErr?.message },
      endpoint
    );
    notifyError(apiErr);
    throw apiErr;
  }

  if (timeoutId) clearTimeout(timeoutId);

  // Parse response payload safely
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let responseData: any = null;
  if (response.status !== 204) {
    try {
      if (isJson) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }
    } catch {
      responseData = null;
    }
  }

  // Handle HTTP status errors uniformly
  if (!response.ok) {
    let errorMessage = '';

    if (responseData && typeof responseData === 'object') {
      errorMessage =
        responseData.message ||
        responseData.error ||
        responseData.detail ||
        `Erro ${response.status}: ${response.statusText}`;
    } else if (typeof responseData === 'string' && responseData.trim()) {
      errorMessage = responseData.slice(0, 200);
    } else {
      errorMessage = `Erro ${response.status} (${response.statusText || 'Falha na requisição'})`;
    }

    // Specific user-friendly messages for key status codes
    if (response.status === 401) {
      errorMessage = responseData?.message || 'Sessão expirada ou autenticação necessária. Faça login novamente.';
    } else if (response.status === 403) {
      errorMessage = responseData?.message || 'Acesso negado: privilégios insuficientes para esta operação.';
    } else if (response.status === 500) {
      errorMessage = responseData?.message || 'Erro interno no servidor backend. Tente novamente mais tarde.';
    } else if (response.status === 503) {
      errorMessage = responseData?.message || 'Serviço temporariamente indisponível (Cloud Run iniciando ou sob manutenção).';
    }

    const apiError = new ApiError(
      response.status,
      response.statusText,
      errorMessage,
      responseData,
      endpoint
    );

    notifyError(apiError);
    throw apiError;
  }

  return responseData as T;
}

/**
 * Convenient shorthand methods
 */
export const apiClient = {
  get: <T = any>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(endpoint, { ...options, method: 'GET' }),

  post: <T = any>(endpoint: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'POST', body }),

  put: <T = any>(endpoint: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'PUT', body }),

  delete: <T = any>(endpoint: string, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(endpoint, { ...options, method: 'DELETE' }),

  patch: <T = any>(endpoint: string, body?: any, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(endpoint, { ...options, method: 'PATCH', body }),

  request,
  setBaseUrl: setApiBaseUrl,
  getBaseUrl: getApiBaseUrl,
  onError: onApiError,
};

export default apiClient;
