import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { services } from '@/services/serviceContainer';
import { api } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';

describe('MediaService: upload', () => {
  it('should post file to /media and return upload data with url', async () => {
    let capturedMethod = '';
    let capturedContentType = '';

    server.use(
      http.post(api('/media'), async ({ request }) => {
        capturedMethod = request.method;
        capturedContentType = request.headers.get('content-type') || '';
        return HttpResponse.json(
          {
            success: true,
            url: '/api/v2/media/test-upload-id',
            fileName: 'avatar.png',
            sizeBytes: 1234,
            contentType: 'image/png',
          },
          { status: 201 }
        );
      })
    );

    const file = new File(['dummy content'], 'avatar.png', { type: 'image/png' });
    const result = await services.mediaService.upload(file);

    expect(capturedMethod).toBe('POST');
    // fetch with FormData produces multipart/form-data
    expect(capturedContentType).toContain('multipart/form-data');
    expect(result.url).toBe('/api/v2/media/test-upload-id');
    expect(result.success).toBe(true);
  });

  it('should throw error when server returns failure status', async () => {
    server.use(
      http.post(api('/media'), () =>
        HttpResponse.json(
          { error: 'file_too_large', message: 'Файл слишком большой' },
          { status: 413 }
        )
      )
    );

    const file = new File(['large content'], 'large.png', { type: 'image/png' });
    await expect(services.mediaService.upload(file)).rejects.toThrow('file_too_large');
  });
});
