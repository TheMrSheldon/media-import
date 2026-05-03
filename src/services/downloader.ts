import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import http from 'http';
import https from 'https';

export function downloadFile(
  url: string,
  destPath: string,
  onProgress: (percent: number, receivedBytes: number, totalBytes: number) => void,
): Promise<{ receivedBytes: number; totalBytes: number }> {
  return new Promise(async (resolve, reject) => {
    await mkdir(dirname(destPath), { recursive: true });

    const request = (u: string) => {
      const get = u.startsWith('https') ? https.get : http.get;
      get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          if (location) return request(location);
          return reject(new Error('Redirect with no location'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] ?? '0', 10);
        let receivedBytes = 0;
        const out = createWriteStream(destPath);

        res.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          const pct = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
          onProgress(pct, receivedBytes, totalBytes);
        });

        res.pipe(out);
        out.on('finish', () => resolve({ receivedBytes, totalBytes }));
        out.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    };

    request(url);
  });
}
