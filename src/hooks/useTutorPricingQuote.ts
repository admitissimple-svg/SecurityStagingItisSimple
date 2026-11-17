import { useState, useEffect, useCallback, useRef } from 'react';
import {
  BatchPricingQuotesResult,
  PublicTutorPricingQuoteDto,
  TutorQuoteUnavailableInfo,
  fetchBatchTutorPricingQuotes,
  fetchSingleTutorPricingQuote,
} from '../utils/pricingQuoteClient';
import { NativeFriendTutor } from '../types';

export function useBatchTutorPricingQuotes(enabled: boolean = true, refreshTrigger?: any) {
  const [quotesByTutorId, setQuotesByTutorId] = useState<Record<string, PublicTutorPricingQuoteDto>>({});
  const [unavailableByTutorId, setUnavailableByTutorId] = useState<Record<string, TutorQuoteUnavailableInfo>>({});
  const [ptaxMeta, setPtaxMeta] = useState<PublicTutorPricingQuoteDto['ptax'] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const requestSeqRef = useRef<number>(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    const res: BatchPricingQuotesResult = await fetchBatchTutorPricingQuotes();
    if (seq !== requestSeqRef.current) return;

    if (res.success) {
      setQuotesByTutorId(res.quotesByTutorId);
      setUnavailableByTutorId(res.unavailableByTutorId);
      setPtaxMeta(res.ptax);
      setError(null);
      setErrorCode(null);
    } else {
      setQuotesByTutorId({});
      setUnavailableByTutorId({});
      setPtaxMeta(null);
      setError(res.message);
      setErrorCode(res.error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, refreshTrigger, load]);

  return {
    quotesByTutorId,
    unavailableByTutorId,
    ptaxMeta,
    isLoading,
    error,
    errorCode,
    refresh: load,
  };
}

export function useSingleTutorPricingQuote(
  tutor: Pick<NativeFriendTutor, 'id' | 'publicTutorId' | 'uid' | 'authUid'> | null | undefined,
  enabled: boolean = true,
  refreshTrigger?: any
) {
  const tutorKey = (
    tutor?.uid ||
    tutor?.authUid ||
    tutor?.id ||
    tutor?.publicTutorId ||
    ''
  ).trim();

  const [quote, setQuote] = useState<PublicTutorPricingQuoteDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(enabled && tutorKey));
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const requestSeqRef = useRef<number>(0);

  const load = useCallback(async () => {
    if (!tutorKey) {
      setQuote(null);
      setIsLoading(false);
      setError(null);
      setErrorCode(null);
      return;
    }

    const seq = ++requestSeqRef.current;
    setIsLoading(true);
    setError(null);
    setErrorCode(null);

    const res = await fetchSingleTutorPricingQuote(tutorKey);
    if (seq !== requestSeqRef.current) return;

    if (res.success) {
      setQuote(res);
      setError(null);
      setErrorCode(null);
    } else {
      setQuote(null);
      setError(res.message);
      setErrorCode(res.error);
    }
    setIsLoading(false);
  }, [tutorKey]);

  useEffect(() => {
    if (!enabled || !tutorKey) {
      if (!tutorKey) {
        setQuote(null);
        setIsLoading(false);
        setError(null);
        setErrorCode(null);
      }
      return;
    }
    load();
  }, [enabled, tutorKey, refreshTrigger, load]);

  return {
    quote,
    isLoading,
    error,
    errorCode,
    isCommercializable: Boolean(quote && quote.commercializable),
    refresh: load,
  };
}
