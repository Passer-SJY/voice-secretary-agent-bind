import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createBridge, register, interpretReply, validateBinding, PROTOCOL } from '../voice-secretary-bind/scripts/bridge.mjs';
const context = { accountID: 'fixture', chatID: 'oc_fixture', requesterID: 'ou_fixture', sessionKey: 'agent:main:feishu:direct:ou_fixture' };
const invitation = () => ({ id: randomUUID(), challengeHash: createHash('sha256').update('a'.repeat(64)).digest('hex'), expires: new Date(Date.now() + 1800000).toISOString(), repository: 'https://github.com/fixture/fixture', revision: 'a'.repeat(40) });
const baseURL = 'https://fixture.fixture.ts.net:8443/v1';
const sent = { status: 'ok', result: { payloads: [{ text: 'Fixture result' }], deliveryStatus: { requested: true, status: 'sent', succeeded: true } } };

test('private pairing, scoped dispatch, context preservation, deduplication, delivery and recovery', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vs-bind-'));
  let bridge, calls = 0, release, hold = true;
  const command = async args => {
    if (args[0] === 'sessions') return { sessions: [{ key: context.sessionKey }] };
    calls++;
    assert.equal(args[args.indexOf('--session-key') + 1], context.sessionKey);
    assert.equal(args[args.indexOf('--reply-account') + 1], context.accountID);
    assert.equal(args[args.indexOf('--reply-to') + 1], 'chat:' + context.chatID);
    assert.ok(args.includes('--deliver')); assert.ok(!args.includes('--local'));
    const input = readFileSync(args[args.indexOf('--message-file') + 1], 'utf8');
    const id = input.match(/[a-f0-9-]{36}/)[0];
    assert.equal(JSON.parse(readFileSync(join(root, 'run-' + id + '.json'), 'utf8')).status, 'running');
    if (hold) await new Promise(resolve => { release = resolve; });
    return sent;
  };
  try {
    const invite = invitation();
    const receipt = await register(root, invite, context, baseURL, command);
    await assert.rejects(register(root, invite, context, baseURL, command));
    await assert.rejects(register(root, invitation(), { ...context, sessionKey: 'agent:main:main' }, baseURL, command));
    await assert.rejects(register(root, invitation(), { ...context, threadID: 'fixture' }, baseURL, command));
    await assert.rejects(register(root, invitation(), context, 'https://public.invalid/v1', command));
    await assert.rejects(register(root, invitation(), context, baseURL, async () => ({ sessions: [] })));
    bridge = createBridge(root, { command });
    assert.throws(() => createBridge(root, { command }));
    await new Promise(done => bridge.server.listen(0, '127.0.0.1', done));
    let origin = 'http://127.0.0.1:' + bridge.server.address().port;
    const send = async (path, key, body, id) => {
      const r = await fetch(origin + '/v1/' + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(id ? { 'Idempotency-Key': id } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return [r.status, await r.json()];
    };
    const pair = { invitation_id: invite.id, challenge: 'a'.repeat(64) };
    assert.equal((await send('pair', receipt.pairingToken, { ...pair, challenge: 'b'.repeat(64) }))[0], 403);
    const [code, claim] = await send('pair', receipt.pairingToken, pair); assert.equal(code, 200);
    const token = claim.accessToken;
    assert.equal((await send('pair', receipt.pairingToken, pair))[1].accessToken, token); // recover lost response
    const path = 'bindings/' + receipt.binding.id;
    assert.equal((await send(path, receipt.pairingToken))[0], 403);
    assert.deepEqual((await send(path, token))[1].binding, receipt.binding);
    const id = randomUUID(), task = randomUUID(), payload = { protocolVersion: PROTOCOL, binding: receipt.binding, task_id: task, revision: 1, input: 'Synthetic confirmed contents' };
    assert.equal((await send(path + '/runs', token, { ...payload, binding: { ...receipt.binding, chatID: 'oc_other' } }, id))[0], 400);
    assert.equal(calls, 0);
    assert.equal((await send(path + '/runs', token, payload, id))[0], 202);
    while (!release) await new Promise(done => setImmediate(done));
    assert.equal((await send(path + '/runs', token, payload, id))[0], 200);
    assert.equal(calls, 1);
    assert.equal((await send(path + '/runs', token, { ...payload, input: 'Changed contents' }, id))[0], 409);
    assert.equal((await send(path + '/runs', token, payload, randomUUID()))[0], 409);
    hold = false; release();
    let result;
    for (let i = 0; i < 30; i++) { result = (await send(path + '/runs/' + id, token))[1]; if (result.status === 'completed') break; await new Promise(done => setImmediate(done)); }
    assert.equal(result.status, 'completed'); assert.equal(result.delivery, 'sent'); assert.equal(result.output, 'Fixture result'); assert.equal(result.input, undefined);
    assert.equal((await send(path + '/runs', token, payload, id))[0], 200); assert.equal(calls, 1);
    const secondInvite = invitation();
    const second = await register(root, secondInvite, context, baseURL, command);
    const secondClaim = (await send('pair', second.pairingToken, { invitation_id: secondInvite.id, challenge: 'a'.repeat(64) }))[1];
    assert.equal((await send('bindings/' + second.binding.id + '/runs/' + id, secondClaim.accessToken))[0], 404);
    const unknownID = randomUUID();
    writeFileSync(join(root, 'run-' + unknownID + '.json'), JSON.stringify({ run_id: unknownID, binding_id: receipt.binding.id, status: 'running' }));
    await bridge.close(); bridge = createBridge(root, { command });
    await new Promise(done => bridge.server.listen(0, '127.0.0.1', done)); origin = 'http://127.0.0.1:' + bridge.server.address().port;
    assert.equal((await send(path + '/runs/' + unknownID, token))[1].status, 'outcome_unknown'); assert.equal(calls, 1);
    const receiptFile = join(root, 'binding-' + receipt.binding.id + '.json'), stored = JSON.parse(readFileSync(receiptFile, 'utf8'));
    stored.expires = new Date(Date.now() - 1000).toISOString(); writeFileSync(receiptFile, JSON.stringify(stored));
    assert.equal((await send('pair', receipt.pairingToken, pair))[0], 403);
    assert.ok(existsSync(join(root, 'run-' + id + '.json')));
  } finally { if (release) release(); if (bridge) await bridge.close(); rmSync(root, { recursive: true, force: true }); }
});

test('successful execution never implies successful Feishu delivery', () => {
  assert.equal(interpretReply({ payloads: [{ text: 'Done' }] }).delivery, 'unknown');
  const failed = interpretReply({ payloads: [{ text: 'Done' }], deliveryStatus: { requested: true, status: 'failed', succeeded: false } });
  assert.equal(failed.status, 'completed'); assert.equal(failed.delivery, 'failed');
  assert.equal(interpretReply({ status: 'accepted', result: sent.result }).status, 'outcome_unknown');
  assert.equal(interpretReply({ ok: false, result: sent.result }).status, 'outcome_unknown');
  assert.equal(interpretReply({ deliveryStatus: { status: 'sent', succeeded: true } }).status, 'outcome_unknown');
  assert.throws(() => validateBinding({ ...context, id: randomUUID(), skillVersion: '1.0.0', channel: 'feishu', sessionKey: 'agent:main:feishu:group:oc_other' }));
});
