const ENDPOINT = 'https://c-gw.variflight.com/chat_message/mcp/api';
import { flightQuery } from './flight-query.js';
export class FlightConnector {
  constructor(key, signal) { this.key = key.trim(); this.signal = signal; this.sequence = 0; this.session = null; this.endpoint = ENDPOINT; this.protocolVersion = '2025-03-26'; }
  async send(method, params = {}, notification = false) {
    const id = notification ? undefined : ++this.sequence;
    const timeout = AbortSignal.timeout(45000), signal = this.signal ? AbortSignal.any([timeout, this.signal]) : timeout;
    const response = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.key}`, 'MCP-Protocol-Version': this.protocolVersion, ...(this.session ? { 'Mcp-Session-Id': this.session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }), signal });
    if (!response.ok) {
      let detail = '';
      try { const body = await response.json(); detail = body.error?.message || body.message || ''; } catch {}
      detail = String(detail).replaceAll(this.key, '[已隐藏]').slice(0, 200);
      throw new Error(`航空接口返回 ${response.status}${detail ? '：' + detail : '，请检查 Key、授权或剩余积分'}`);
    }
    this.session = response.headers.get('Mcp-Session-Id') || this.session;
    if (notification || response.status === 204) return null;
    let message;
    const matching = value => (Array.isArray(value) ? value : [value]).find(item => item?.id === id);
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      const parse = block => {
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) return;
        try { return matching(JSON.parse(data)); } catch {}
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          if (buffer.length > 5_000_000) throw new Error('接口响应过大');
          const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop();
          for (const block of blocks) { message = parse(block); if (message) break; }
          if (message) break;
          if (done) { message = parse(buffer); break; }
        }
      } finally { await reader.cancel(); }
    } else message = matching(await response.json());
    if (!message) throw new Error('接口没有返回与本次请求匹配的结果');
    if (message.error) throw new Error(String(message.error.message || '航空接口调用失败').replaceAll(this.key, '[已隐藏]'));
    return message.result;
  }
  async connect() {
    const initialized = await this.send('initialize', { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: 'xingji', version: '1.0.0' } });
    this.protocolVersion = initialized?.protocolVersion || this.protocolVersion;
    if (!this.session) throw new Error('请先在电脑 Chrome 或 Edge 安装并启用“行迹 · 飞常准连接”扩展，再刷新网页重试');
    await this.send('notifications/initialized', {}, true);
  }
  async historyTrips(year) {
    year = String(year ?? '').trim();
    const currentYear = new Date().getFullYear();
    if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > currentYear) throw new Error(`请填写 1900 至 ${currentYear} 之间的历史行程年份`);
    await this.connect();
    const result = await this.send('tools/call', { name: 'queryUserHistoryTrip', arguments: { year, identityType: 0 } });
    if (result.isError) throw new Error('平台未能查询本人历史行程，请检查授权和账户权益');
    return result;
  }
  async flightStatus(input) {
    const query = flightQuery(input);
    await this.connect();
    const result = await this.send('tools/call', { name: 'getFlightStatus', arguments: query });
    if (result.isError) throw new Error('平台未能查询航班，请检查日期、授权或账户权益');
    return result;
  }
  async flightTrack(flightStr) {
    await this.connect();
    const result = await this.send('tools/call', { name: 'getFlightTrackLine', arguments: { flightStr } });
    if (result?.isError) throw new Error('飞常准未能查询航迹，请检查账号权限或剩余额度');
    return result;
  }
}
