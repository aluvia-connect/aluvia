import { requireApi } from './api-helpers.js';
import { output } from './cli.js';

export async function handleGeos(): Promise<void> {
  const api = requireApi();
  const geos = await api.geos.list();
  return output({
    geos,
    count: geos.length,
    next: 'Use --geo <code> with proxy-on or rotate-ip only if a site requires that country. Omit --geo otherwise.',
  });
}
