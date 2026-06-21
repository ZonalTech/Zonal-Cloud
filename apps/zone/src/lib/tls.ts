/**
 * TLS / Let's Encrypt setup for VPS deployments.
 *
 * Traefik's static config does not interpolate environment variables, so the
 * ACME email is baked in by rendering traefik.prod.yml in the data dir from the
 * bundled traefik.prod.yml.template. Called by `install --domain ...` and by
 * `zone tls`.
 */
import { writeFileSync } from 'node:fs';
import { Paths } from './paths';
import { readTemplate } from './templates';

const PLACEHOLDER = '__ACME_EMAIL__';

/**
 * Render traefik.prod.yml into the data dir with the given ACME email.
 * Returns the path written.
 */
export function renderTraefikProd(paths: Paths, acmeEmail: string): string {
  const tpl = readTemplate(paths, 'traefik.prod.yml.template');
  const rendered = tpl.split(PLACEHOLDER).join(acmeEmail);
  writeFileSync(paths.traefikProd, rendered);
  return paths.traefikProd;
}

/** Basic email shape check (good enough to catch typos before ACME fails). */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}
