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

  it('should preserve the root error code when an upload is too large', async () => {
    server.use(
      http.post(api('/media'), () =>
        HttpResponse.json(
          {
            code: 'file_too_large',
            message: 'file exceeds 100 MB limit',
            requestId: 'media-upload-test',
          },
          { status: 413 }
        )
      )
    );

    const file = new File(['large content'], 'large.png', { type: 'image/png' });
    const failure = await services.mediaService.upload(file).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('file exceeds 100 MB limit');
    expect((failure as Error & { code?: string }).code).toBe('file_too_large');
  });
});
