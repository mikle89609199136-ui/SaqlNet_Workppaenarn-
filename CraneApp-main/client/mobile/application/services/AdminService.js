import API_ENDPOINTS from '../../infrastructure/api/endpoints.js';

class AdminService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  listUsers(params = {}) {
    return this.apiClient
      .get(API_ENDPOINTS.ADMIN_USERS, params)
      .then((response) => response.data?.users ?? []);
  }

  disableUser(userId) {
    return this.apiClient
      .post(API_ENDPOINTS.ADMIN_USER_DISABLE(userId))
      .then((response) => response.data);
  }

  enableUser(userId) {
    return this.apiClient
      .post(API_ENDPOINTS.ADMIN_USER_ENABLE(userId))
      .then((response) => response.data);
  }

  listReports(params = {}) {
    return this.apiClient
      .get(API_ENDPOINTS.ADMIN_REPORTS, params)
      .then((response) => response.data?.reports ?? []);
  }

  createReport({ targetType, targetId, reason }) {
    return this.apiClient
      .post(API_ENDPOINTS.ADMIN_REPORTS, { targetType, targetId, reason })
      .then((response) => response.data);
  }

  resolveReport(reportId, resolution = '') {
    return this.apiClient
      .post(API_ENDPOINTS.ADMIN_REPORT_RESOLVE(reportId), { resolution })
      .then((response) => response.data);
  }
}

export default AdminService;
