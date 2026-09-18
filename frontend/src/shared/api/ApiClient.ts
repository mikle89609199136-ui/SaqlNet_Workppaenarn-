export interface IApiClientOptions {
  getToken?: () => string | null;
  headers?: Record<string, string>;
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
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, options: IApiClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.getToken = options.getToken ?? (() => null);
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
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
    if (/^https?:\/\//.test(String(endpoint))) {
      const url = new URL(endpoint);
      this.appendParams(url, params);
      return url.toString();
    }

    const normalizedBase = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    let normalizedEndpoint = String(endpoint).replace(/^\/+/, '');
    // Относительная база разрешается от адреса страницы; вне браузера
    // подставляется любой корректный origin — важен только путь.
    const documentUrl = globalThis.location?.href ?? 'http://localhost/';
    const absoluteBase = new URL(normalizedBase, documentUrl);
    const basePath = absoluteBase.pathname.replace(/\/+$/, '').replace(/^\/+/, '');
    if (basePath && normalizedEndpoint.startsWith(`${basePath}/`)) {
      normalizedEndpoint = normalizedEndpoint.slice(basePath.length + 1);
    }
    const url = new URL(normalizedEndpoint, absoluteBase);

    this.appendParams(url, params);
    return url.toString();
  }

  private appendParams(url: URL, params: TQueryParams = {}): void {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
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

      if (response.status === 401 && !isUserFacingAuthError(payloadObj.code)) {
        // Слушатель живёт в AuthGuard. Вне браузера событию некуда идти,
        // но и падать из-за этого запрос не должен.
        globalThis.dispatchEvent?.(new CustomEvent('craneapp:unauthorized'));
      }
      const message =
        payloadObj?.error ||
        payloadObj?.message ||
        (typeof payload === 'string' ? payload : JSON.stringify(payload)) ||
        'Request failed';
      const error = new Error(message) as IApiError;
      error.status = response.status;
      error.data = payload;
      error.code = payloadObj?.code;
      throw error;
    }

    return {
      data: payload as T,
      status: response.status,
      headers: response.headers,
    };
  }
}

/**
 * Ошибки со статусом 401, которые говорят не о сессии, а о том, что
 * человек ввёл неверный пароль.
 *
 * Раньше любой 401 считался протухшей сессией и выбрасывал на страницу
 * входа. Из-за этого ошибка «неверный текущий пароль» при его смене
 * выкидывала из аккаунта вместе с введённым: сессия была цела, а человек
 * оказывался на форме входа и не понимал почему.
 */
function isUserFacingAuthError(code: string | undefined): boolean {
  return code === 'wrong_password' || code === 'invalid_2fa' || code === 'invalid_credentials';
}
