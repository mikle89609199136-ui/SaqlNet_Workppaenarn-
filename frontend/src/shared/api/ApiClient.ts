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

  get<T = unknown>(
    endpoint: string,
    params: TQueryParams = {},
    headers?: Record<string, string>
  ): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', params, headers });
  }

  post<T = unknown>(endpoint: string, data?: unknown): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', data });
  }

  put<T = unknown>(endpoint: string, data?: unknown): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PUT', data });
  }

  patch<T = unknown>(endpoint: string, data?: unknown): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PATCH', data });
  }

  /**
   * `keepalive` — для запроса, который уходит при закрытии вкладки:
   * без него браузер обрывает его вместе со страницей.
   */
  delete<T = unknown>(
    endpoint: string,
    data?: unknown,
    options: Pick<IRequestOptions, 'keepalive'> = {}
  ): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE', data });
  }

  private async request<T = unknown>(
    endpoint: string,
    options: IRequestOptions = {}
  ): Promise<IApiResponse<T>> {
    const { params, data, headers, ...requestOptions } = options;
    const url = this.buildUrl(endpoint, params);
    // Токен уходит только своему серверу (#871): абсолютный адрес чужого
    // origin получает запрос без авторизации.
    const token = this.isOwnOrigin(url) ? this.getToken() : null;
    const requestHeaders: Record<string, string> = {
      ...this.defaultHeaders,
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const isFormData = data instanceof FormData;
    const isNoData = data === null || data === undefined;
    if (isNoData || isFormData) {
      delete requestHeaders['Content-Type'];
    }

    const body = isFormData ? data : isNoData ? undefined : JSON.stringify(data);

    const response = await fetch(url, {
      ...requestOptions,
      headers: requestHeaders,
      body,
    });

    return this.parseResponse<T>(response);
  }

  /** Тот же origin, что у базы API: относительный адрес — всегда свой. */
  private isOwnOrigin(url: string): boolean {
    if (!/^https?:\/\//i.test(url)) return true;
    const here = globalThis.location?.href ?? 'http://localhost/';
    try {
      return new URL(url).origin === new URL(this.baseUrl, here).origin;
    } catch {
      return false;
    }
  }

  private buildUrl(endpoint: string, params: TQueryParams = {}): string {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        query.set(key, String(value));
      }
    });

    const base = this.baseUrl.replace(/\/+$/, '');
    // Путь базы — '/api/v2' и у относительной базы, и у абсолютной.
    const basePath = base.replace(/^https?:\/\/[^/]+/, '');
    const relative = endpoint.replace(/^\/+/, '');

    // Сервер отдаёт часть адресов уже с базой: mediaUrl вложений —
    // '/api/v2/media/<id>'. Приклеенная второй раз база давала
    // '/api/v2/api/v2/media/…' и 404: вложения не открывались ни у
    // получателя, ни у отправителя после перезагрузки.
    const path = /^https?:\/\//.test(endpoint)
      ? endpoint
      : basePath && `/${relative}`.startsWith(`${basePath}/`)
        ? `${base.slice(0, base.length - basePath.length)}/${relative}`
        : `${base}/${relative}`;

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
