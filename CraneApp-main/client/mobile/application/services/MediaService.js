class MediaService {
  constructor(apiClient) {
    this.apiClient = apiClient;
  }

  async upload(file) {
    const form = new FormData();
    form.append('file', file);
    const token = localStorage.getItem('craneapp_auth_token');
    const response = await fetch('/api/v2/media', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Ошибка загрузки файла');
    }
    return data.upload;
  }

  getUrl(uploadId) {
    return `/api/v2/media/${uploadId}`;
  }

  async getUpload(uploadId) {
    const { data } = await this.apiClient.get(`/media/${uploadId}`);
    return data.upload ?? data;
  }
}

export default MediaService;
