import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightConnector } from '../src/mcp.js';

test('direct MCP carries the negotiated session and performs exactly one historical trip query for the selected year', async () => {
  const previous = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    const message = JSON.parse(options.body); calls.push(message);
    if (message.method !== 'initialize') assert.equal(options.headers['Mcp-Session-Id'], 'test-session');
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26' } : { content: [], isError: false };
    return Response.json({ jsonrpc: '2.0', id: message.id, result }, { headers: message.method === 'initialize' ? { 'Mcp-Session-Id': 'test-session' } : {} });
  };
  try {
    await new FlightConnector('test-key').historyTrips('2024');
    assert.deepEqual(calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/call']);
    assert.deepEqual(calls[2].params, { name: 'queryUserHistoryTrip', arguments: { year: '2024', identityType: 0 } });
  } finally { globalThis.fetch = previous; }
});

test('an invisible session header stops before quota is spent and identifies the browser limitation', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; return Response.json({ id: JSON.parse(options.body).id, result: { protocolVersion: '2025-03-26' } }); };
  try { await assert.rejects(new FlightConnector('test-key').historyTrips('2024'), /连接.*扩展/); assert.equal(calls, 1); }
  finally { globalThis.fetch = previous; }
});

test('SSE decoding preserves Chinese text and JSON split across event and byte boundaries', async () => {
  const previous = globalThis.fetch;
  const bytes = new TextEncoder().encode('event: message\ndata: {"jsonrpc":"2.0","id":1,\ndata: "result":{"message":"查询成功"}}\n\n');
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  try { assert.deepEqual(await new FlightConnector('test-key').send('tools/list'), { message: '查询成功' }); }
  finally { globalThis.fetch = previous; }
});

test('invalid history years never make a network request', async () => {
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected request'); };
  try {
    for (const year of ['', 'all', '24', '2024.5', '1899', String(new Date().getFullYear() + 1)]) await assert.rejects(new FlightConnector('test-key').historyTrips(year), /历史行程年份/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});
