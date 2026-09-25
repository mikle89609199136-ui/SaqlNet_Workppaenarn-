import { API_ENDPOINTS } from '@/shared/api';

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

  /**
   * Выход на всех устройствах: сервер отзывает все токены пользователя.
   *
   * Метода здесь не было вовсе, а раздел «Активные сеансы» его вызывал —
   * нажатие на «Завершить все сеансы» падало с TypeError, ничего не
   * завершая. Адрес существует давно: POST /api/v2/auth/logout-all.
   */
  async logoutAll() {
    try {
      await this.apiClient.post(API_ENDPOINTS.AUTH_LOGOUT_ALL);
    } finally {
      this.authStorage.clearProfile();
    }
  }

  /**
   * Смена пароля.
   *
   * Метода здесь не было, а форма его вызывала: смена пароля падала на
   * TypeError и показывала «Не удалось изменить пароль» при любом вводе.
   */
  changePassword(currentPassword: string, newPassword: string) {
    return this.apiClient
      .post(API_ENDPOINTS.AUTH_CHANGE_PASSWORD, { currentPassword, newPassword })
      .then((response) => response.data);
  }

  /** Включена ли вторая ступень входа. */
  getTwoFAStatus() {
    return this.apiClient
      .get(API_ENDPOINTS.AUTH_2FA_STATUS)
      .then((response) => Boolean(response.data?.enabled));
  }

  /**
   * Включение и отключение второй ступени.
   *
   * Это не приложение-аутентификатор, а дополнительный пароль: сервер
   * принимает его и при включении, и при отключении — во втором случае
   * чтобы убедиться, что отключает владелец.
   */
  setTwoFA(enabled: boolean, password: string) {
    const endpoint = enabled ? API_ENDPOINTS.AUTH_2FA_ENABLE : API_ENDPOINTS.AUTH_2FA_DISABLE;

    return this.apiClient.post(endpoint, { password }).then((response) => response.data);
  }

  /**
   * Новое устройство: начать вход по QR с одноразовым ключом (#745) или
   * сменить показанный код (#753). Прежний код перестаёт работать сразу;
   * сменить его может только тот, кто знает секрет из ответа.
   */
  startQrLogin(
    publicKey: string,
    deviceName: string,
    replaces?: { token: string; secret: string }
  ) {
    return this.apiClient
      .post(API_ENDPOINTS.AUTH_QR_TOKEN, {
        publicKey,
        deviceName,
        ...(replaces && { replaces: replaces.token, secret: replaces.secret }),
      })
      .then((response) => response.data as { qrToken: string; secret: string; expiresAt: number });
  }

  /** Секрет в код не попадает: по фотографии экрана сессию не забрать. */
  getQrStatus(token: string, secret: string) {
    return this.apiClient
      .get(API_ENDPOINTS.AUTH_QR_STATUS(token), {}, { 'X-QR-Secret': secret })
      .then(
        (response) =>
          response.data as {
            status: 'pending' | 'scanned' | 'confirmed' | 'expired';
            expiresAt?: number;
            authToken?: string;
            payload?: { senderPublicKey: string; iv: string; ct: string };
          }
      );
  }

  /** Погасить код, когда страница с ним закрывается. */
  cancelQrLogin(token: string, secret: string, options: { keepalive?: boolean } = {}) {
    return this.apiClient
      .delete(API_ENDPOINTS.AUTH_QR_TOKEN_BY_ID(token), { secret }, options)
      .then(() => undefined);
  }

  /** Вошедшее устройство: какое устройство просит войти. */
  getQrRequest(token: string) {
    return this.apiClient.get(API_ENDPOINTS.AUTH_QR_REQUEST(token)).then(
      (response) =>
        response.data as {
          publicKey: string;
          deviceName: string;
          userAgent: string;
          createdAt: number;
          expiresAt: number;
        }
    );
  }

  /** Вошедшее устройство: отказаться от отсканированного кода. */
  declineQrRequest(token: string) {
    return this.apiClient.delete(API_ENDPOINTS.AUTH_QR_REQUEST(token)).then(() => undefined);
  }

  confirmQrLogin(qrToken: string, payload: { senderPublicKey: string; iv: string; ct: string }) {
    return this.apiClient
      .post(API_ENDPOINTS.AUTH_QR_CONFIRM, { qrToken, payload })
      .then((response) => response.data);
  }

  /** Устройства, на которых выполнен вход. */
  getSessions() {
    return this.apiClient
      .get(API_ENDPOINTS.AUTH_SESSIONS)
      .then((response) => response.data?.sessions ?? []);
  }

  resendCode() {
    return this.apiClient.post(API_ENDPOINTS.AUTH_RESEND_CODE).then((response) => response.data);
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
