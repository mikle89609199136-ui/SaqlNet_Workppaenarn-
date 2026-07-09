class ApiClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.getToken = options.getToken ?? (() => null);
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options.headers,
    };
  }

  get(endpoint, params = {}) {
    return this.request(endpoint, { method: 'GET', params });
  }

  post(endpoint, data = null) {
    return this.request(endpoint, { method: 'POST', data });
  }

  put(endpoint, data = null) {
    return this.request(endpoint, { method: 'PUT', data });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  async request(endpoint, options = {}) {
    const { params, data, headers, ...requestOptions } = options;
    const token = this.getToken();
    const requestHeaders = {
      ...this.defaultHeaders,
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    if (data === null || data === undefined) {
      delete requestHeaders['Content-Type'];
    }

    const response = await fetch(this.buildUrl(endpoint, params), {
      ...requestOptions,
      headers: requestHeaders,
      body: data === null || data === undefined ? undefined : JSON.stringify(data),
    });

    return this.parseResponse(response);
  }

  buildUrl(endpoint, params = {}) {
    if (/^https?:\/\//.test(String(endpoint))) {
      const url = new URL(endpoint);
      this.appendParams(url, params);
      return url.toString();
    }

    const normalizedBase = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    let normalizedEndpoint = String(endpoint).replace(/^\/+/, '');
    const basePath = new URL(normalizedBase, window.location.href).pathname.replace(/\/+$/, '').replace(/^\/+/, '');
    if (basePath && normalizedEndpoint.startsWith(`${basePath}/`)) {
      normalizedEndpoint = normalizedEndpoint.slice(basePath.length + 1);
    }
    const url = new URL(normalizedEndpoint, normalizedBase);

    this.appendParams(url, params);
    return url.toString();
  }

  appendParams(url, params = {}) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, value);
      }
    });
  }

  async parseResponse(response) {
    const contentType = response.headers?.get?.('content-type') ?? '';
    const payload = contentType.includes('application/json') || typeof response.text !== 'function'
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('craneapp:unauthorized'));
      }
      const message = payload?.error || payload?.message || (typeof payload === 'string' ? payload : JSON.stringify(payload)) || 'Request failed';
      const error = new Error(message);
      error.status = response.status;
      error.data = payload;
      throw error;
    }

    return { data: payload, status: response.status, headers: response.headers };
  }
}

export default ApiClient;
