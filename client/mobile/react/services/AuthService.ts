import { API_ENDPOINTS } from '@/api';

export class AuthService {
  constructor(apiClient, authStorage) {
    this.apiClient = apiClient;
    this.authStorage = authStorage;
  }

  async sendCode(phone) {
    const response = await this.apiClient.post(API_ENDPOINTS.AUTH_SEND_CODE, { phone });
    return response.data;
  }

  async verifyCode(code) {
    const response = await this.apiClient.post(API_ENDPOINTS.AUTH_VERIFY_CODE, { code });
    const token = response.data?.token ?? response.data;

    if (token) {
      this.authStorage.setToken(token);
    }

    if (response.data?.user) {
      this.authStorage.setUser(response.data.user);
    }

    return token;
  }

  async register(userData) {
    const response = await this.apiClient.post(API_ENDPOINTS.AUTH_REGISTER, userData);

    if (response.data?.token) {
      this.authStorage.setToken(response.data.token);
    }

    if (response.data?.user) {
      this.authStorage.setUser(response.data.user);
    }

    return response.data;
  }

  async login({ username, password }) {
    const response = await this.apiClient.post(API_ENDPOINTS.AUTH_LOGIN, { username, password });

    if (response.data?.token) {
      this.authStorage.setToken(response.data.token);
    }

    if (response.data?.user) {
      this.authStorage.setUser(response.data.user);
    }

    return response.data;
  }

  async logout() {
    try {
      await this.apiClient.post(API_ENDPOINTS.AUTH_LOGOUT);
    } finally {
      this.authStorage.clearProfile();
    }
  }

  savePublicKey(publicKey) {
    return this.apiClient
      .post(API_ENDPOINTS.AUTH_PUBLIC_KEY, { publicKey })
      .then((response) => response.data);
  }

  resendCode() {
    return this.apiClient
      .post(API_ENDPOINTS.AUTH_RESEND_CODE)
      .then((response) => response.data);
  }

  async validateSession() {
    const token = this.authStorage.token;
    if (!token) return false;

    try {
      const response = await this.apiClient.get(API_ENDPOINTS.AUTH_VALIDATE);
      if (response.data?.user) {
        this.authStorage.setUser(response.data.user);
      }
      return true;
    } catch (error) {
      this.authStorage.clearProfile();
      return false;
    }
  }
}