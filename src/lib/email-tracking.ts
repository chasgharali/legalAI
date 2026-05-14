/**
 * Open + click tracking helpers. Two pieces:
 *   1. Inject a 1×1 transparent GIF that hits /api/track/open/[sendId].
 *   2. Rewrite anchor tags so href points at /api/track/click/[sendId]?u=...
 *
 * Caveats every user of this should know:
 *   - Gmail proxies images through their CDN. The pixel will fire once when
 *     the message loads, regardless of whether the recipient actually read
 *     it. Treat opens as "delivered to a client that loaded images" not
 *     "read with intent".
 *   - Some clients (Apple Mail Privacy Protection, ProtonMail) pre-load
 *     images so opens get reported within seconds of delivery — usually
 *     fine for our purposes because we only need to know "the message was
 *     seen at least once".
 *   - Click tracking is more reliable but you must avoid wrapping the
 *     unsubscribe link or anti-spam systems will flag the redirect.
 */

export function baseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

export function trackingPixelUrl(sendId: string): string {
  return `${baseUrl()}/api/track/open/${sendId}.gif`;
}

export function trackingClickUrl(sendId: string, originalUrl: string): string {
  const enc = encodeURIComponent(originalUrl);
  return `${baseUrl()}/api/track/click/${sendId}?u=${enc}`;
}

/**
 * Wrap markdown / inline links in HTML so the recipient's click goes
 * through our click tracker first. Run AFTER markdown→HTML conversion.
 * Skips mailto: and tel: links and anything already pointing at our own
 * tracking endpoint (to avoid double-wrapping during regeneration).
 */
export function injectClickTracking(html: string, sendId: string): string {
  const base = baseUrl();
  return html.replace(
    /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi,
    (_match, before, url, after) => {
      const lower = url.toLowerCase();
      if (
        lower.startsWith('mailto:') ||
        lower.startsWith('tel:') ||
        lower.startsWith('#') ||
        lower.startsWith(`${base}/api/track/`) ||
        lower.includes('/unsubscribe')
      ) {
        return `<a ${before}href="${url}"${after}>`;
      }
      const wrapped = trackingClickUrl(sendId, url);
      return `<a ${before}href="${wrapped}"${after}>`;
    }
  );
}

/**
 * Append a 1×1 tracking pixel to the email HTML. The image carries a
 * loud `alt` attribute so any reader that reveals alt text sees the
 * disclosure (helps with PECR / accessibility transparency).
 */
export function injectTrackingPixel(html: string, sendId: string): string {
  const pixel = `<img src="${trackingPixelUrl(
    sendId
  )}" width="1" height="1" alt="" style="display:block;border:0;outline:0;width:1px;height:1px;opacity:0" />`;
  return html.replace(/<\/div>\s*$/i, `${pixel}</div>`).replace(/^(?!.*<\/div>)/, html + pixel);
}

/**
 * One-shot helper: take a markdown body, render it to HTML, then inject
 * both trackers. Returns both the wired-up HTML and the original plain
 * text so we can send a multipart message.
 */
export function instrumentEmailHtml(html: string, sendId: string): string {
  let out = html;
  out = injectClickTracking(out, sendId);
  out = injectTrackingPixel(out, sendId);
  return out;
}

// 43-byte transparent 1×1 GIF. Base64 to avoid bundling binary blobs.
export const TRACKING_PIXEL_BASE64 =
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
