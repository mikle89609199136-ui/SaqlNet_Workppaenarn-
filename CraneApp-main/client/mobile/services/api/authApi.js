import { services } from '../../application/services/serviceContainer.js';

export const authApi = {
  sendCode(phone) {
    return services.authService.sendCode(phone);
  },

  verifyCode(code) {
    return services.authService.verifyCode(code);
  },

  register(userData) {
    return services.authService.register(userData);
  },

  resendCode() {
    return services.authService.resendCode();
  },
};
