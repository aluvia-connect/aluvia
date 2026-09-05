// Subprocess fixture: no real HTTP, no install creation, no credential/token output.
import { drainAttribution, reportSetupReady } from '../../src/growth-attribution.js';
const mode = process.argv[2];
const uuid = '781b451f-b36d-4350-8134-c09f0890851d';
globalThis.fetch = (async (url, init) => {
  if (String(url) === 'https://api.aluvia.io/v1/growth/install-attribution') {
    return Response.json({ schema_version: 1, status: 'bound', acquisition_id: uuid }, { status: 201 });
  }
  if (String(url) !== 'https://api.aluvia.io/v1/growth/install-events')
    throw new Error('Unexpected endpoint');
  console.log(String(init?.body));
  if (mode === 'lost') throw new Error('fixture lost receipt');
  return Response.json({ schema_version: 1, status: 'recorded', receipt_id: uuid }, { status: 200 });
}) as typeof fetch;
if (mode === 'lost') {
  await reportSetupReady({
    aimed: true,
    healthy: true,
    probeOk: true,
    credentialKind: 'install',
    connectionId: 17,
  });
} else {
  await drainAttribution();
}
