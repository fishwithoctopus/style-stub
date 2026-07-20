const assert = require('node:assert/strict');
const { startGateway } = require('../server/gateway');

async function close(server) {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function run() {
  let savedSecrets = null;
  const persistence = value => { savedSecrets = value; };
  const first = await startGateway({
    port: 0,
    quiet: true,
    initialSecrets: { qwen: 'test-key-123456' },
    onSecretsChanged: persistence,
    secretStorage: 'os-encrypted'
  });

  const firstBase = `http://127.0.0.1:${first.address().port}/v1`;
  const firstHealth = await (await fetch(`${firstBase}/health`)).json();
  assert.equal(firstHealth.secretStorage, 'os-encrypted');
  assert.equal(firstHealth.providers.qwen.connected, true);

  const connectResponse = await fetch(`${firstBase}/config/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'deepseek', key: 'test-key-abcdef' })
  });
  assert.equal(connectResponse.ok, true);
  await close(first);

  const second = await startGateway({
    port: 0,
    quiet: true,
    initialSecrets: savedSecrets,
    onSecretsChanged: persistence,
    secretStorage: 'os-encrypted'
  });
  const secondHealth = await (await fetch(`http://127.0.0.1:${second.address().port}/v1/health`)).json();
  assert.equal(secondHealth.providers.qwen.connected, true);
  assert.equal(secondHealth.providers.deepseek.connected, true);
  await close(second);

  console.log('gateway persistence contract ok');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
