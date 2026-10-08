import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createBridge, register, interpretReply, validateBinding, PROTOCOL, readPlanning, proposePlanning } from '../voice-secretary-bind/scripts/bridge.mjs';
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

test('dead-process lock recovers without replay; live or invalid owner is retained', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vs-bind-crash-'));
  let child, bridge;
  try {
    const moduleURL = new URL('../voice-secretary-bind/scripts/bridge.mjs', import.meta.url).href;
    child = spawn(process.execPath, ['--input-type=module', '-e',
      `import {createBridge} from ${JSON.stringify(moduleURL)}; const b=createBridge(${JSON.stringify(root)}); b.server.listen(0,'127.0.0.1',()=>console.log('ready'));`],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    await once(child.stdout, 'data');
    assert.throws(() => createBridge(root));
    assert.equal(readFileSync(join(root, 'bridge.lock'), 'utf8'), String(child.pid));
    const id = randomUUID();
    writeFileSync(join(root, 'run-' + id + '.json'), JSON.stringify({ run_id: id, status: 'running' }));
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    let calls = 0;
    bridge = createBridge(root, { command: async () => { calls++; throw new Error('Never replay'); } });
    const journal = JSON.parse(readFileSync(join(root, 'run-' + id + '.json'), 'utf8'));
    assert.equal(journal.status, 'outcome_unknown'); assert.equal(calls, 0);
    await new Promise(done => bridge.server.listen(0, '127.0.0.1', done));
    const response = await fetch('http://127.0.0.1:' + bridge.server.address().port + '/health');
    assert.deepEqual(await response.json(), { service: 'voice-secretary-bridge', status: 'ready', version: '1.0.0' });
    await bridge.close(); bridge = undefined;
    writeFileSync(join(root, 'bridge.lock'), 'invalid');
    assert.throws(() => createBridge(root));
    assert.equal(readFileSync(join(root, 'bridge.lock'), 'utf8'), 'invalid');
    assert.ok(existsSync(join(root, 'run-' + id + '.json')));
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill('SIGKILL');
    if (bridge) await bridge.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test('planning scopes, atomic pages, stale snapshots, reviewed proposals and durable receipts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vs-planning-'));
  let bridge;
  const command = async args => { assert.equal(args[0], 'sessions', 'Planning must not execute or send a business message'); return { sessions: [{ key: context.sessionKey }] }; };
  try {
    const invite = invitation(), receipt = await register(root, invite, context, baseURL, command);
    bridge = createBridge(root, { command });
    await new Promise(done => bridge.server.listen(0, '127.0.0.1', done));
    let origin = 'http://127.0.0.1:' + bridge.server.address().port;
    const request = async (path, key, body) => {
      const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return [response.status, await response.json()];
    };
    const [, paired] = await request('/v1/pair', receipt.pairingToken, { invitation_id: invite.id, challenge: 'a'.repeat(64) });
    const key = paired.accessToken, path = '/v1/bindings/' + receipt.binding.id + '/planning';
    const snapshot = { protocolVersion: 'voice-secretary-planning/v1', snapshotID: randomUUID(), authorityID: randomUUID(), generation: 1, calendarIDs: ['cal'], reminderListIDs: ['list'], pages: 2 };
    const item = { id: 'reminder:fixture', kind: 'reminder', revision: 'revision-1', title: 'Fixture', containerID: 'list', writable: true, recurring: false, completed: false };
    assert.equal((await request(path + '/snapshots', 'wrong', { ...snapshot, page: 0, items: [item] }))[0], 403);
    assert.equal((await request(path + '/snapshots', key, { ...snapshot, page: 1, items: [] }))[0], 200);
    assert.equal((await request(path, key))[0], 404, 'Partial uploads are not visible');
    assert.equal((await request(path + '/snapshots', key, { ...snapshot, page: 0, items: [item] }))[0], 200);
    assert.equal(readPlanning(root, receipt.binding.id).items.length, 1);
    assert.equal(readPlanning(root, receipt.binding.id).total, 1);
    assert.equal((await request(path + '/snapshots', key, { ...snapshot, snapshotID: randomUUID(), page: 0, items: [] }))[0], 409);
    // Interrupted uploads must not accumulate into a permanent retry lockout.
    for (let generation = 2; generation <= 14; generation++) {
      assert.equal((await request(path + '/snapshots', key, { ...snapshot, snapshotID: randomUUID(), generation, page: 1, items: [] }))[0], 200);
      assert.equal(readPlanning(root, receipt.binding.id).generation, 1);
    }
    assert.equal((await request(path + '/snapshots', key, { ...snapshot, snapshotID: randomUUID(), generation: 13, page: 0, items: [item] }))[0], 409);
    assert.equal((await request(path + '/snapshots', key, { ...snapshot, snapshotID: randomUUID(), generation: 15, pages: 1, page: 0, items: [item] }))[0], 200);
    const proposal = { id: randomUUID(), kind: 'reminder', operation: 'complete', itemID: item.id, expectedRevision: item.revision, containerID: 'list', change: { completed: true } };
    assert.equal(proposePlanning(root, receipt.binding.id, proposal).state, 'received');
    assert.equal(proposePlanning(root, receipt.binding.id, proposal).state, 'received');
    assert.throws(() => proposePlanning(root, receipt.binding.id, { ...proposal, change: { completed: false } }));
    assert.throws(() => proposePlanning(root, receipt.binding.id, { ...proposal, id: randomUUID(), expectedRevision: 'stale' }));
    assert.throws(() => proposePlanning(root, receipt.binding.id, { ...proposal, id: randomUUID(), containerID: 'private' }));
    assert.equal((await request(path + '/proposals', key))[1].proposals.length, 1);
    assert.equal((await request(path + '/proposals/' + proposal.id + '/receipt', key, { state: 'applied', message: 'Fixture applied' }))[0], 200);
    assert.equal((await request(path + '/proposals/' + proposal.id + '/receipt', key, { state: 'applied' }))[0], 200);
    assert.equal((await request(path + '/proposals/' + proposal.id + '/receipt', key, { state: 'rejected' }))[0], 400);
    assert.equal((await request(path + '/proposals', key))[1].proposals.length, 0);
    await bridge.close(); bridge = createBridge(root, { command });
    assert.equal(readPlanning(root, receipt.binding.id).items[0].id, item.id);
    assert.equal(proposePlanning(root, receipt.binding.id, proposal).state, 'applied');
    const projectID = randomUUID(), taskID = randomUUID();
    const projectSnapshot = { ...snapshot, generation: 16, snapshotID: randomUUID(), pages: 1, page: 0,
      projectIDs: [projectID], projects: [{ id: projectID, name: 'Website', details: 'Homepage', revision: 1 }],
      items: [{ id: 'app:' + taskID, kind: 'app-item', revision: 'r1', title: 'Research', notes: 'Public fixture',
        containerID: 'project:' + projectID, writable: false, recurring: false, appTaskID: taskID, appKind: 'task', appRevision: 1,
        projectPlacement: { bucket: 'project', projectID }, projectName: 'Website' }] };
    await new Promise(done => bridge.server.listen(0, '127.0.0.1', done));
    origin = 'http://127.0.0.1:' + bridge.server.address().port;
    assert.equal((await request(path + '/snapshots', key, projectSnapshot))[0], 200);
    const projectRead = readPlanning(root, receipt.binding.id);
    assert.equal(projectRead.projects[0].id, projectID); assert.equal(projectRead.items[0].writable, false);
    assert.throws(() => proposePlanning(root, receipt.binding.id, { id: randomUUID(), kind: 'app-item', operation: 'complete', containerID: 'project:' + projectID, change: { completed: true } }));
    const invalidProject = { ...projectSnapshot, generation: 17, snapshotID: randomUUID(), projectIDs: [], projects: [] };
    assert.equal((await request(path + '/snapshots', key, invalidProject))[0], 400);
    assert.equal(readPlanning(root, receipt.binding.id).generation, 16);
    const revoked = { ...snapshot, generation: 17, snapshotID: randomUUID(), pages: 1, page: 0, items: [], calendarIDs: [], reminderListIDs: [] };
    // Read/propose are also available to the container-local bound Skill.
    origin = 'http://127.0.0.1:' + bridge.server.address().port;
    assert.equal((await request(path + '/snapshots', key, revoked))[0], 200);
    assert.equal(readPlanning(root, receipt.binding.id).total, 0);
    assert.equal(proposePlanning(root, receipt.binding.id, proposal).state, 'applied');
    assert.throws(() => proposePlanning(root, receipt.binding.id, { ...proposal, id: randomUUID() }));
  } finally { if (bridge) await bridge.close(); rmSync(root, { recursive: true, force: true }); }
});
