// Saved-code account recovery against the production export, a fresh claimed daemon and real Chromium. Nothing is mocked: the claim, the Mine Vault item, sign-out, the wrong code,
// the saved-code recovery, the revoked old password and old session, and the new verified session all go through the real capabilities.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import { bootFreshSpace, claimOnEdge, edge } from './real-app-harness.test.ts';
import { createCapCaller } from '../../../client/src/gateway/index.ts';import { routes } from '../../../generated/routes.ts';

const OLD_PASSWORD = 'fixture recovery password 123';
const NEW_PASSWORD = 'fixture recovered password 456';
const WRONG_CODE = 'WRONG-CODE-WRONG-CODE-WRONG-CODE';
const VAULT_SECRET = 'recovery-fixture-private-secret-7c1f';

test('saved-code recovery: same keys, private Vault data kept, old password and session refused, no code or proof stored', async (t) => {
  const dist = process.env['VYRE_APP_DIST'];
  if (!dist) { if (process.env['VYRE_REQUIRE_CHROME'] === '1') assert.fail('VYRE_APP_DIST required for the production recovery proof'); t.skip('VYRE_APP_DIST required for the production recovery proof'); return; }
  const { chromium } = await import('playwright-core');
  const exe = process.env['CHROME_BIN'] || chromium.executablePath();
  assert.ok(fs.existsSync(exe), 'a Chrome binary is required');
  const space = await bootFreshSpace(undefined, true), web = await edge(dist, space.url);
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  const shots = process.env['VYRE_RECOVERY_SHOTS'] ?? '/tmp/vyre-recovery-shots';fs.mkdirSync(shots, { recursive: true });
  // Everything the browser says or visits is kept so the code and proof can be searched for afterwards.
  const urls: string[] = [], console_: string[] = [], errors: string[] = [], restoreBodies: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => console_.push(m.text()));
  page.on('framenavigated', (f) => urls.push(f.url()));
  page.on('request', (r) => { urls.push(r.url()); if (r.url().endsWith('/v1/identity/recovery_restore') && r.postData()) restoreBodies.push(r.postData()!); });
  const api = (token: string) => createCapCaller({ baseUrl: web.origin, token: () => token, routes: async () => routes });
  const anonymous = createCapCaller({ baseUrl: web.origin, token: () => '', routes: async () => routes });
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'recovery fits the phone width');
  const storedSession = () => page.evaluate(() => JSON.parse(localStorage.getItem('vyre.session.v1') ?? '{"sessions":{}}').sessions[location.origin] as { token: string; personId: string } | undefined);
  let code = '', ownerToken = '', secondToken = '', itemId = '';
  let keysBefore: Record<string, unknown> = {}, recoveryBefore: Record<string, unknown> = {};
  try {
    await t.test('a fresh owner claim shows the saved recovery code and lands in the shell', async () => {
      await page.goto(claimOnEdge(space.claim!, web.origin));
      await page.getByTestId('claim-name').fill('Recovery proof owner');await page.getByTestId('claim-username').fill('recoveryowner');
      await page.getByTestId('claim-password').fill(OLD_PASSWORD);await page.getByTestId('claim-confirm').fill(OLD_PASSWORD);await page.getByTestId('claim-next').click();
      await page.getByTestId('claim-code').waitFor();code = (await page.getByTestId('claim-code').innerText()).trim();assert.ok(code.length >= 8, 'the claim page shows a recovery code');
      await page.getByTestId('claim-saved').click();await page.getByTestId('claim-create').click();await page.getByTestId('shell').or(page.getByTestId('mobile-shell')).first().waitFor({ timeout: 30000 });
      ownerToken = (await storedSession())!.token;assert.ok(ownerToken);
    });
    await t.test('a private Mine Vault item is created and revealed before recovery', async () => {
      const owner = api(ownerToken);
      keysBefore = (await owner('identity.keys_get', {}) as { keys: Record<string, unknown> }).keys;
      recoveryBefore = (await anonymous('identity.recovery_fetch', { username: 'recoveryowner' }) as { keys: Record<string, unknown> }).keys;
      const folder = (await owner('vault.folders.create', { name: 'Recovery proof', scope: 'mine', idempotencyKey: 'recovery-folder' }) as { folder: { id: string } }).folder.id;
      const item = (await owner('vault.item.put', { folderId: folder, name: 'Recovery proof key', kind: 'api_key', fields: [{ key: 'api_key', value: VAULT_SECRET }], idempotencyKey: 'recovery-item' }) as { item: { id: string } }).item;
      itemId = item.id;
      const revealed = await owner('vault.item.reveal', { itemId }) as { fields: { key: string; value: string }[] };
      assert.equal(revealed.fields.find((f) => f.key === 'api_key')?.value, VAULT_SECRET, 'the owner reads the private value before recovery');
      // A second signed-in session that recovery must revoke along with the old password.
      const signed = await anonymous('identity.sign_in', { username: 'recoveryowner', password: OLD_PASSWORD, deviceName: 'Second device', deviceClass: 'web' }) as { session: { token: string } };
      secondToken = signed.session.token;assert.ok(secondToken);
    });
    await t.test('sign out returns to sign-in and the stored session is gone', async () => {
      await page.getByTestId('tab-you').click();await page.getByTestId('row-you-sign-out').click();
      await page.getByTestId('si-user').waitFor({ timeout: 20000 });
      assert.equal(await storedSession(), undefined, 'sign-out removes the stored session');
      assert.equal((await context.request.post(`${web.origin}/v1/identity/whoami`, { headers: { authorization: `Bearer ${ownerToken}` }, data: {} })).status(), 401, 'the signed-out bearer is revoked');
    });
    await t.test('a wrong recovery code fails and changes nothing', async () => {
      await page.getByTestId('signin-help').click();await page.getByTestId('recovery-username').waitFor();await noOverflow();await page.screenshot({ path: path.join(shots, 'recovery-form-phone.png') });
      await page.getByTestId('recovery-username').fill('recoveryowner');await page.getByTestId('recovery-code').fill(WRONG_CODE);
      await page.getByTestId('recovery-password').fill(NEW_PASSWORD);await page.getByTestId('recovery-confirm').fill(NEW_PASSWORD);await page.getByTestId('recovery-submit').click();
      await page.getByTestId('recovery-error').waitFor({ timeout: 30000 });await page.screenshot({ path: path.join(shots, 'recovery-wrong-code-phone.png') });
      assert.equal(restoreBodies.length, 0, 'a code that cannot open the keys never reaches the server');
      assert.equal((await context.request.post(`${web.origin}/v1/identity/sign_in`, { data: { username: 'recoveryowner', password: NEW_PASSWORD, deviceName: 'Wrong code', deviceClass: 'web' } })).status(), 401, 'the new password was not set');
      const still = await context.request.post(`${web.origin}/v1/identity/whoami`, { headers: { authorization: `Bearer ${secondToken}` }, data: {} });assert.equal(still.status(), 200, 'the other session survives a failed attempt');
    });
    await t.test('a dead connection gets its own honest line and sends nothing', async () => {
      await page.route('**/v1/identity/recovery_fetch', (route) => route.abort('failed'));
      await page.getByTestId('recovery-code').fill(code);await page.getByTestId('recovery-submit').click();
      await page.getByText(/reach the Space/).waitFor({ timeout: 15000 });assert.match(await page.getByTestId('recovery-error').innerText(), /new password already works/);
      await page.unroute('**/v1/identity/recovery_fetch');assert.equal(restoreBodies.length, 0, 'an unreachable Space never produced a recovery commit');
    });
    let newToken = '';
    await t.test('the saved code and a new password recover the account as the Owner', async () => {
      await page.getByTestId('recovery-code').fill(code);await page.getByTestId('recovery-password').fill(NEW_PASSWORD);await page.getByTestId('recovery-confirm').fill(NEW_PASSWORD);
      await page.getByTestId('recovery-submit').click();
      await page.getByTestId('mobile-shell').or(page.getByTestId('shell')).first().waitFor({ timeout: 60000 }).catch(async (error) => { await page.screenshot({ path: path.join(shots, 'recovery-stuck.png') });fs.writeFileSync(path.join(shots, 'recovery-stuck.txt'), await page.locator('body').innerText());throw error; });
      newToken = (await storedSession())!.token;assert.ok(newToken);assert.notEqual(newToken, ownerToken);assert.notEqual(newToken, secondToken);
      assert.equal(restoreBodies.length, 1, 'exactly one recovery commit was sent');
    });
    await t.test('same keys and private data, old credentials refused, new session accepted', async () => {
      const fresh = api(newToken);
      const who = await fresh('identity.whoami', {}) as { person?: { role?: string }; role?: string; roles?: string[] };
      assert.match(JSON.stringify(who), /owner/i, 'the recovered session is the Owner');
      const keysAfter = (await fresh('identity.keys_get', {}) as { keys: Record<string, unknown> }).keys;
      const { personKeyByPassword: oldWrap, ...stable } = keysBefore as Record<string, unknown>, { personKeyByPassword: newWrap, ...stableAfter } = keysAfter;
      assert.deepEqual(stableAfter, stable, 'public key, private key wrap, recovery wrap and every Space key wrap are unchanged');
      assert.notEqual(newWrap, oldWrap, 'only the password wrap changed');
      const recoveryAfter = (await anonymous('identity.recovery_fetch', { username: 'recoveryowner' }) as { keys: Record<string, unknown> }).keys;
      assert.deepEqual(recoveryAfter, recoveryBefore, 'the recovery-only bundle served to anyone is unchanged');
      const revealed = await fresh('vault.item.reveal', { itemId }) as { fields: { key: string; value: string }[] };
      assert.equal(revealed.fields.find((f) => f.key === 'api_key')?.value, VAULT_SECRET, 'the private Vault item still decrypts under the preserved key');
      assert.equal((await context.request.post(`${web.origin}/v1/identity/whoami`, { headers: { authorization: `Bearer ${secondToken}` }, data: {} })).status(), 401, 'the old session is revoked');
      assert.equal((await context.request.post(`${web.origin}/v1/identity/sign_in`, { data: { username: 'recoveryowner', password: OLD_PASSWORD, deviceName: 'Old password', deviceClass: 'web' } })).status(), 401, 'the old password is refused');
      const signed = await context.request.post(`${web.origin}/v1/identity/sign_in`, { data: { username: 'recoveryowner', password: NEW_PASSWORD, deviceName: 'New password', deviceClass: 'web' } });assert.equal(signed.status(), 200, 'the new password signs in');
      await page.screenshot({ path: path.join(shots, 'recovered-shell-phone.png') });
    });
    await t.test('a real rate limit gets its own honest line (the limit is per source address)', async () => {
      await page.evaluate(() => { document.documentElement.scrollTop = 0; });await page.getByTestId('tab-you').click();await page.getByTestId('row-you-sign-out').click();
      await page.getByTestId('si-user').waitFor({ timeout: 20000 });await page.getByTestId('signin-help').click();
      for (let i = 0; i < 12; i++) await anonymous('identity.recovery_fetch', { username: 'nobodyhere' }).catch(() => undefined);
      await page.getByTestId('recovery-username').fill('nobodyhere');await page.getByTestId('recovery-code').fill(WRONG_CODE);
      await page.getByTestId('recovery-password').fill(NEW_PASSWORD);await page.getByTestId('recovery-confirm').fill(NEW_PASSWORD);await page.getByTestId('recovery-submit').click();
      await page.getByText(/Too many recovery attempts/).waitFor({ timeout: 15000 });await page.screenshot({ path: path.join(shots, 'recovery-rate-limit-phone.png') });
      assert.equal(restoreBodies.length, 1, 'the rate-limited attempt sent no recovery commit');
    });
    await t.test('the proof is single use and neither code nor proof is stored, navigated to or logged', async () => {
      const body = JSON.parse(restoreBodies[0]!) as { recoveryProof: string };const proof = body.recoveryProof;assert.ok(proof && proof.length >= 16, 'the commit carried a proof');
      const replay = await context.request.post(`${web.origin}/v1/identity/recovery_restore`, { data: JSON.parse(restoreBodies[0]!) });assert.ok(replay.status() >= 400, 'the same proof cannot commit twice');
      const secrets = [code, proof, WRONG_CODE, NEW_PASSWORD];
      const browserStore = await page.evaluate(async () => {
        const dump: Record<string, unknown> = { local: { ...localStorage }, session: { ...sessionStorage }, cookies: document.cookie };
        const dbs = (indexedDB.databases ? await indexedDB.databases() : []) as { name?: string }[];const idb: Record<string, unknown> = {};
        for (const d of dbs) { if (!d.name) continue; idb[d.name] = await new Promise((resolve) => { const open = indexedDB.open(d.name!);open.onerror = () => resolve('unreadable');open.onsuccess = () => { const db = open.result, out: Record<string, unknown[]> = {};const names = Array.from(db.objectStoreNames);if (!names.length) { db.close();resolve(out);return; }const tx = db.transaction(names, 'readonly');names.forEach((n) => { const all = tx.objectStore(n).getAll();all.onsuccess = () => { out[n] = all.result; }; });tx.oncomplete = () => { db.close();resolve(out); };tx.onerror = () => { db.close();resolve('unreadable'); }; }; }); }
        dump['indexedDB'] = idb;return JSON.stringify(dump);
      });
      const visible = [browserStore, urls.join('\n'), console_.join('\n'), errors.join('\n')].join('\n');
      for (const secret of secrets) assert.equal(visible.includes(secret), false, 'a recovery secret reached browser storage, a URL or the console');
      const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
      for (const file of files(space.dir)) { const bytes = fs.readFileSync(file); for (const secret of [code, proof, NEW_PASSWORD, OLD_PASSWORD]) assert.equal(bytes.includes(Buffer.from(secret)), false, `a recovery secret reached ${path.basename(file)} in the Space data directory`); }
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => undefined);
    fs.writeFileSync(path.join(shots, 'failure.txt'), `${String(error)}\n${await page.locator('body').innerText().catch(() => '')}`);throw error;
  } finally { await context.close();await browser.close();web.close();await space.stop();fs.rmSync(space.dir, { recursive: true, force: true }); }
});
