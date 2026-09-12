import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { getErrorMessage } from '../../utils/error.utils';
import { HueEnvelopeSchema, HueLightResource, HueLightResourceSchema, HueLightUpdate } from './hue.interfaces';

const REQUEST_TIMEOUT_MS = 8000;

/**
 * The Hue bridge over CLIP v2, hand-rolled on `node:https`.
 *
 * Not `fetch`, because the bridge serves a certificate signed by Signify's private root, and the
 * global `fetch` offers no per-request way to accept it. The bridge sits on the LAN and the
 * application key in the header is what actually authenticates the caller, so the certificate
 * check is switched off here rather than pinning the Signify root — the same trade
 * `OpensearchService` makes for its own self-signed node.
 *
 * `HUE_SERVER` is the bridge's host or ip, with or without a scheme. `HUE_USERNAME` is the
 * application key the bridge handed out at link time, sent as `hue-application-key`.
 * `HUE_CLIENTKEY` is the Entertainment API's DTLS secret and is not used by CLIP.
 */
@Injectable()
export class HueClientService {
  private readonly logger = new Logger(HueClientService.name);

  private readonly host: string | undefined;
  private readonly applicationKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.host = readHost(this.configService.get<string>('HUE_SERVER'));
    this.applicationKey = this.configService.get<string>('HUE_USERNAME') || undefined;

    if (!this.host || !this.applicationKey) {
      this.logger.warn('HUE_SERVER or HUE_USERNAME is not set; the Hue bridge cannot be reached.');
    }
  }

  get isConfigured(): boolean {
    return !!this.host && !!this.applicationKey;
  }

  /** Every light the bridge knows, in the order it lists them. */
  async getLights(): Promise<HueLightResource[]> {
    const envelope = await this.call('GET', '/clip/v2/resource/light');
    const lights: HueLightResource[] = [];

    // Item by item, so one light the schema no longer fits costs that light and not the listing.
    for (const item of envelope.data) {
      const parsed = HueLightResourceSchema.safeParse(item);

      if (parsed.success) {
        lights.push(parsed.data);
      } else {
        this.logger.warn(`Skipping a light the bridge described in an unexpected shape: ${parsed.error.message}`);
      }
    }

    return lights;
  }

  /**
   * Writes state to one light. Only the fields set on `update` are sent; the bridge leaves the
   * rest as it was. `colorXy` and `mirek` are both sent when both are set, and the bridge keeps
   * the last one in the body — resolve to one before calling.
   */
  async updateLight(id: string, update: HueLightUpdate): Promise<void> {
    const body: Record<string, unknown> = {};

    if (update.on !== undefined) body.on = { on: update.on };
    if (update.brightness !== undefined) body.dimming = { brightness: update.brightness };
    if (update.colorXy !== undefined) body.color = { xy: update.colorXy };
    if (update.mirek !== undefined) body.color_temperature = { mirek: update.mirek };
    if (update.effect !== undefined) body.effects_v2 = { action: { effect: update.effect } };
    if (update.transitionMs !== undefined) body.dynamics = { duration: update.transitionMs };

    if (Object.keys(body).length === 0) return;

    await this.call('PUT', `/clip/v2/resource/light/${encodeURIComponent(id)}`, body);
  }

  private async call(method: 'GET' | 'PUT', path: string, body?: unknown): Promise<z.infer<typeof HueEnvelopeSchema>> {
    if (!this.host || !this.applicationKey) {
      throw new Error('HUE_SERVER and HUE_USERNAME must both be set to talk to the Hue bridge.');
    }

    const { status, text } = await this.send(this.host, this.applicationKey, method, path, body);

    let json: unknown;

    try {
      json = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(`Hue bridge answered ${method} ${path} with HTTP ${status} and a body that is not JSON: ${getErrorMessage(error)}`);
    }

    const envelope = HueEnvelopeSchema.parse(json);

    if (envelope.errors.length > 0) {
      const described = envelope.errors.map((entry) => entry.description).join('; ');
      throw new Error(`Hue bridge refused ${method} ${path} (HTTP ${status}): ${described}`);
    }

    if (status < 200 || status >= 300) {
      throw new Error(`Hue bridge answered ${method} ${path} with HTTP ${status}`);
    }

    return envelope;
  }

  private send(host: string, applicationKey: string, method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'hue-application-key': applicationKey,
      };

      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const req = httpsRequest(
        {
          host,
          port: 443,
          method,
          path,
          headers,
          rejectUnauthorized: false,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
          res.on('error', reject);
        },
      );

      req.on('timeout', () => req.destroy(new Error(`Hue bridge at ${host} did not answer within ${REQUEST_TIMEOUT_MS} ms`)));
      req.on('error', reject);

      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }
}

/** `192.168.1.10`, `https://192.168.1.10/` and `hue.lan` all reduce to the bare host. */
function readHost(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) return undefined;

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname || undefined;
  } catch {
    return trimmed;
  }
}
