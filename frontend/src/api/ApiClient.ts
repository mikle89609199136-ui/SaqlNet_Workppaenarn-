export interface IApiClientOptions {
  getToken?: () => string | null;
  headers?: Record<string, string>;
}

export type TQueryParamValue = string | number | boolean | null | undefined;
export type TQueryParams = Record<string, TQueryParamValue>;

export interface IRequestOptions extends Omit<RequestInit, "headers" | "body"> {
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
}

export class ApiClient {
  private baseUrl: string;
  private getToken: () => string | null;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, options: IApiClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.getToken = options.getToken ?? (() => null);
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...options.headers,
    };
  }

  get<T = unknown>(
    endpoint: string,
    params: TQueryParams = {},
  ): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: "GET", params });
  }

  post<T = unknown>(
    endpoint: string,
    data: unknown = null,
  ): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: "POST", data });
  }

  put<T = unknown>(
    endpoint: string,
    data: unknown = null,
  ): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: "PUT", data });
  }

  delete<T = unknown>(endpoint: string): Promise<IApiResponse<T>> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }

  async request<T = unknown>(
    endpoint: string,
    options: IRequestOptions = {},
  ): Promise<IApiResponse<T>> {
    const { params, data, headers, ...requestOptions } = options;
    const token = this.getToken();
    let requestHeaders: Record<string, string> = {
      ...this.defaultHeaders,
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    if (data === null || data === undefined) {
      const { "Content-Type": _omit, ...rest } = requestHeaders;
      requestHeaders = rest;
    }

    const response = await fetch(this.buildUrl(endpoint, params), {
      ...requestOptions,
      headers: requestHeaders,
      body:
        data === null || data === undefined ? undefined : JSON.stringify(data),
    });

    return this.parseResponse<T>(response);
  }

  buildUrl(endpoint: string, params: TQueryParams = {}): string {
    if (/^https?:\/\//.test(String(endpoint))) {
      const url = new URL(endpoint);
      this.appendParams(url, params);
      return url.toString();
    }

    const normalizedBase = this.baseUrl.endsWith("/")
      ? this.baseUrl
      : `${this.baseUrl}/`;
    let normalizedEndpoint = String(endpoint).replace(/^\/+/, "");
    const basePath = new URL(normalizedBase, window.location.href).pathname
      .replace(/\/+$/, "")
      .replace(/^\/+/, "");
    if (basePath && normalizedEndpoint.startsWith(`${basePath}/`)) {
      normalizedEndpoint = normalizedEndpoint.slice(basePath.length + 1);
    }
    const url = new URL(normalizedEndpoint, normalizedBase);

    this.appendParams(url, params);
    return url.toString();
  }

  appendParams(url: URL, params: TQueryParams = {}): void {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  async parseResponse<T>(response: Response): Promise<IApiResponse<T>> {
    const contentType = response.headers?.get?.("content-type") ?? "";
    const payload: unknown =
      contentType.includes("application/json") ||
      typeof response.text !== "function"
        ? await response.json()
        : await response.text();

    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("craneapp:unauthorized"));
      }
      const payloadObj = (
        payload && typeof payload === "object" ? payload : {}
      ) as {
        error?: string;
        message?: string;
      };
      const message =
        payloadObj?.error ||
        payloadObj?.message ||
        (typeof payload === "string" ? payload : JSON.stringify(payload)) ||
        "Request failed";
      const error = new Error(message) as IApiError;
      error.status = response.status;
      error.data = payload;
      throw error;
    }

    return {
      data: payload as T,
      status: response.status,
      headers: response.headers,
    };
  }
}
