/**
 * The chat wire protocol, and the single source of truth for both repos.
 *
 * Zod rather than plain types because a socket frame is exactly the external boundary the project
 * rule names: what arrives is `unknown` until a schema says otherwise. The Android side mirrors
 * these shapes as kotlinx.serialization sealed interfaces and is held to them by the golden
 * fixtures `npm run cli -- chat fixtures` writes.
 */
export * from './action.schema';
export * from './payload.schema';
export * from './envelope.schema';
export * from './inbound.schema';
export * from './copy-text';
export * from './default-actions';
