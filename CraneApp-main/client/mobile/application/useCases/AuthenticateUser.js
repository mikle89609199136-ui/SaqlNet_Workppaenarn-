class AuthenticateUser {
  constructor(authService) {
    this.authService = authService;
  }

  sendCode(phone) {
    return this.authService.sendCode(phone);
  }

  verifyCode(code) {
    return this.authService.verifyCode(code);
  }
}

export default AuthenticateUser;
