/**
 * Small JSON fetch helper with an abort timeout. Provider errors never carry upstream bodies,
 * headers or keys, so nothing sensitive can leak through an error message or stack trace.
 */
export type ProviderName = 'toncenter' | 'tonapi' | 'stonfi';

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly status: number | null;

  constructor(provider: ProviderName, status: number | null = null) {
    super('UPSTREAM_UNAVAILABLE');
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
    signal?: AbortSignal | undefined;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchJson<T>(
  provider: ProviderName,
  url: string,
  options: {
    method?: 'GET' | 'POST' | undefined;
    headers?: Record<string, string> | undefined;
    body?: string | undefined;
    timeoutMs?: number | undefined;
    fetchImpl?: FetchLike | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<T> {
  const doFetch: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener('abort', onAbort);
  try {
    const init: NonNullable<Parameters<FetchLike>[1]> = {
      headers: options.headers,
      signal: controller.signal,
    };
    if (options.method !== undefined) init.method = options.method;
    if (options.body !== undefined) init.body = options.body;
    const response = await doFetch(url, init);
    if (!response.ok) throw new ProviderError(provider, response.status);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(provider);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
