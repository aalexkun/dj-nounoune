import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { z } from 'zod';
import { getErrorMessage } from '../../utils/error.utils';

/** The claims this app cares about, once the token has been verified. */
export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  nonce?: string;
  hd?: string;
}

/** Google's public signing keys. `createRemoteJWKSet` caches them and follows `kid` rotation on its own. */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Both spellings Google has ever issued; a token carrying anything else is not Google's. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Seconds of clock skew tolerated on `exp` and `iat`. A phone whose clock drifts a little still signs in. */
const CLOCK_TOLERANCE_SECONDS = 60;

/**
 * The payload as it reaches us: verified as a JWT, but still `unknown` as data.
 *
 * `email_verified` arrives as a boolean on an ID token and as the string `"true"` from some of
 * Google's other endpoints, so both are accepted here and the truthiness is decided below — a
 * schema that insisted on the boolean would reject a valid sign-in with a confusing reason.
 */
const GoogleClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.union([z.boolean(), z.string()]).optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
  nonce: z.string().optional(),
  hd: z.string().optional(),
});

/**
 * Verifies a Google ID token and reduces it to a {@link GoogleIdentity}.
 *
 * `jose` rather than `google-auth-library`: zero dependencies, no install script, it handles JWKS
 * caching and `kid` lookup, and it refuses `alg: none`. Hand-rolling this on `node:crypto` is where
 * algorithm-confusion bugs live.
 *
 * Nothing about the token ever reaches a log or an error message. A bad token yields
 * `UnauthorizedException` with a short reason and no echo of what was sent.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);

  /** The Web OAuth client id: the audience of every ID token the phone obtains. `null` disables sign-in. */
  private readonly clientId: string | null;

  /** Built once — it is a closure over a key cache, so a per-call one would refetch Google's keys every time. */
  private readonly jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

  constructor(private readonly configService: ConfigService) {
    const clientId = this.configService.get<string>('GOOGLE_SIGNIN_CLIENT_ID')?.trim();
    this.clientId = clientId ? clientId : null;

    if (!this.clientId) {
      this.logger.warn('GOOGLE_SIGNIN_CLIENT_ID is not set — Google sign-in is disabled and POST /auth/google will fail until it is configured.');
    }
  }

  /**
   * @param idToken - The raw JWT the phone received from Credential Manager
   * @returns The verified identity, with the `nonce` still to be consumed by the caller
   * @throws UnauthorizedException on any signature, issuer, audience, expiry or claim problem
   */
  public async verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.clientId) {
      // A server misconfiguration, not a bad token: let it surface as a 500 rather than telling the
      // phone its perfectly good credential was rejected.
      throw new Error('Google sign-in is not configured: set GOOGLE_SIGNIN_CLIENT_ID to the Web OAuth client id.');
    }

    if (!idToken || typeof idToken !== 'string') {
      throw new UnauthorizedException('Missing ID token');
    }

    let payload: unknown;
    try {
      const verified = await jwtVerify(idToken, this.jwks, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientId,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      payload = verified.payload;
    } catch (error: unknown) {
      // A JOSE error is a verdict on the token — signature, audience, expiry — and is answered 401,
      // with the reason logged and never echoed. Anything else is this server failing to fetch
      // Google's keys (no WAN, a timeout), which is a 503: telling the phone its perfectly good
      // credential was rejected would send somebody to the Google console over a network blip.
      if (error instanceof joseErrors.JOSEError && !(error instanceof joseErrors.JWKSTimeout)) {
        this.logger.warn(`Rejected a Google ID token: ${getErrorMessage(error)}`);
        throw new UnauthorizedException('Invalid Google ID token');
      }

      this.logger.error(`Could not verify a Google ID token against Google's keys: ${getErrorMessage(error)}`);
      throw new ServiceUnavailableException('Could not reach Google to verify the sign-in; try again in a moment.');
    }

    const claims = GoogleClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new UnauthorizedException('Google ID token is missing the sub or email claim');
    }

    const { email_verified: emailVerified } = claims.data;
    if (emailVerified !== true && emailVerified !== 'true') {
      throw new UnauthorizedException('Google account email is not verified');
    }

    return {
      sub: claims.data.sub,
      email: claims.data.email,
      name: claims.data.name,
      picture: claims.data.picture,
      nonce: claims.data.nonce,
      hd: claims.data.hd,
    };
  }
}
