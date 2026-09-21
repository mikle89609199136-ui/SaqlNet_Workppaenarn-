export interface IApiClientOptions {
  getToken?: () => string | null;
  onUnauthorized?: (error: IApiError) => void;
}

export type TQueryParamValue = string | number | boolean | null | undefined;
export type TQueryParams = Record<string, TQueryParamValue>;

export interface IRequestOptions extends Omit<RequestInit, 'headers' | 'body'> {
  params?: TQueryParams;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface IApiResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export interface IApiError extends Error {
  status: number;
  data: unknown;
  /**
   * Код ошибки от сервера: `member_muted`, `access_denied` и прочие.
   *
   * Показывать человеку нужно именно по нему, а не по `message`: там
   * лежит английская строка для разработчика — «member is muted».
   */
  code?: string;
}

export class ApiClient {
  private baseUrl: string;
  private getToken: () => string | null;
  private onUnauthorized?: (error: IApiError) => void;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, options: IApiClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.getToken = options.getToken ?? (() => null);
    this.onUnauthorized = options.onUnauthorized;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  setOnUnauthorized(handler: ((error: IApiError) => void) | undefined): void {
    this.onUnauthorized = handler;
  }

  get<T = unknown>(endpoint: string, params: TQueryParams = {}): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  post<T = unknown>(endpoint: string, data: unknown = null): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', data });
  }

  put<T = unknown>(endpoint: string, data: unknown = null): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PUT', data });
  }

  patch<T = unknown>(endpoint: string, data: unknown = null): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PATCH', data });
  }

  delete<T = unknown>(endpoint: string): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  private async request<T = unknown>(
    endpoint: string,
    options: IRequestOptions = {}
  ): Promise<IApiResponse<T>> {
    const { params, data, headers, ...requestOptions } = options;
    const token = this.getToken();
    let requestHeaders: Record<string, string> = {
      ...this.defaultHeaders,
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    if (data === null || data === undefined) {
      const { 'Content-Type': _omit, ...rest } = requestHeaders;
      requestHeaders = rest;
    }

    const response = await fetch(this.buildUrl(endpoint, params), {
      ...requestOptions,
      headers: requestHeaders,
      body: data === null || data === undefined ? undefined : JSON.stringify(data),
    });

    return this.parseResponse<T>(response);
  }

  private buildUrl(endpoint: string, params: TQueryParams = {}): string {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        query.set(key, String(value));
      }
    });

    const path = /^https?:\/\//.test(endpoint)
      ? endpoint
      : `${this.baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;

    const qs = query.toString();
    return qs ? `${path}?${qs}` : path;
  }

  private async parseResponse<T>(response: Response): Promise<IApiResponse<T>> {
    const contentType = response.headers?.get?.('content-type') ?? '';
    const payload: unknown =
      contentType.includes('application/json') || typeof response.text !== 'function'
        ? await response.json()
        : await response.text();

    if (!response.ok) {
      const payloadObj = (payload && typeof payload === 'object' ? payload : {}) as {
        code?: string;
        error?: string;
        message?: string;
      };

      const message =
        payloadObj?.error ||
        payloadObj?.message ||
        (typeof payload === 'string' ? payload : JSON.stringify(payload)) ||
        'Request failed';
      const error = new Error(message) as IApiError;
      error.status = response.status;
      error.data = payload;
      error.code = payloadObj?.code;

      if (response.status === 401) {
        this.onUnauthorized?.(error);
      }

      throw error;
    }

    return {
      data: payload as T,
      status: response.status,
      headers: response.headers,
    };
  }
}
