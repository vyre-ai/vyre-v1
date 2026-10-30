import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMacServer } from './desktop-link.ts';

const base = { address: 'http://127.0.0.1:8420', spaceId: 'spc_fixture', claimUrl: null };

test('Mac server: one fixed command with no arguments, and the owner setup link of an unclaimed Space comes back checked', async () => {
  let calls = 0;
  const result = await ensureMacServer(async (command, args) => {
    calls++;
    assert.equal(command, 'ensure_mac_server');
    assert.equal(args, undefined);
    return { ...base, claimUrl: 'http://127.0.0.1:8420/claim/abcdefghijklmnop#s=spc_fixture&fp=ab12cd34' };
  });
  assert.equal(calls, 1);
  assert.equal(result.address, 'http://127.0.0.1:8420');
  assert.equal(result.spaceId, 'spc_fixture');
  assert.match(result.claimUrl ?? '', /\/claim\/abcdefghijklmnop#s=spc_fixture/);
});

test('Mac server: a claimed Space comes back as an address to sign in to', async () => {
  assert.equal((await ensureMacServer(async () => base)).claimUrl, null);
});

test('Mac server: a handoff that is not this computer, or whose setup link names another Space or origin, is refused with the Mac server named', async () => {
  const bad = [
    { address: 'https://evil.example' },
    { address: 'http://127.0.0.1:8420/other' },
    { address: 'http://localhost:8420' },
    { claimUrl: 'http://127.0.0.1:9999/claim/abcdefghijklmnop#s=spc_fixture' },
    { claimUrl: 'http://127.0.0.1:8420/claim/abcdefghijklmnop#s=spc_other' },
    { claimUrl: 'http://127.0.0.1:8420/claim/short#s=spc_fixture' },
    { spaceId: 'not-a-space' },
  ];
  for (const change of bad) await assert.rejects(() => ensureMacServer(async () => ({ ...base, ...change })), /Invalid Mac server/);
  await assert.rejects(() => ensureMacServer(async () => { throw new Error('unavailable'); }), /unavailable/);
});
