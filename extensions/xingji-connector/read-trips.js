// This function is serialized and runs in the official points page's isolated world.
export async function readTrips(start, end) {
  try {
    if (location.origin !== 'https://cx.12306.cn' || location.pathname !== '/tlcx/jfinformation.html') {
      throw new Error('请打开 12306 积分查询页面并扫码登录。');
    }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const startTime = Date.parse(start), endTime = Date.parse(end);
    if (typeof start !== 'string' || typeof end !== 'string' || !datePattern.test(start) || !datePattern.test(end)
      || !Number.isFinite(startTime) || !Number.isFinite(endTime)
      || startTime > endTime || endTime - startTime > 365 * 86400000) {
      throw new Error('请选择不超过一年的有效查询日期。');
    }

    const lookupSignal = AbortSignal.timeout(120000);
    const loggedOut = '请在 12306 积分查询页面扫码登录，再回来查询。';
    const successful = value => value === true || value === 1 || value === '1';
    async function post(path, parameters) {
      const response = await fetch('/tlcx/' + path, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams(parameters),
        signal: AbortSignal.any([lookupSignal, AbortSignal.timeout(12000)])
      });
      if (response.type === 'opaqueredirect' || [401, 403].includes(response.status)) throw new Error(loggedOut);
      if (!response.ok) throw new Error('12306 积分查询暂不可用，请稍后重试。');
      const payload = await response.json().catch(() => null);
      if (!payload || payload.noLogin === 'Y' || payload.code === 'NO_LOGIN') throw new Error(loggedOut);
      return payload;
    }

    const session = await post('login/checkLogin', {});
    if (!successful(session.data?.flag)) throw new Error(loggedOut);
    const points = new Map();
    const pageSize = 10;
    const dates = { queryStartDate: start.replaceAll('-', ''), queryEndDate: end.replaceAll('-', '') };
    for (let pageIndex = 1; ; pageIndex++) {
      const response = await post('memberInfo/pointSimpleQuery', {
        queryType: '0', ...dates, pageIndex, pageSize
      });
      if (!successful(response.status)) throw new Error(`12306 未能返回第 ${pageIndex} 页积分流水，请在官网用相同日期查询确认。`);
      const rows = response.data ?? [];
      if (!Array.isArray(rows)) throw new Error('未能识别 12306 积分流水的返回格式。');
      const previousSize = points.size;
      for (const row of rows) {
        const tradeId = String(row?.trade_id ?? ''), tradeType = String(row?.trade_type ?? '');
        if (tradeId && tradeType) points.set(`${tradeType}:${tradeId}`, { tradeId, tradeType });
      }
      const total = Number(rows[0]?.record_sum);
      if (!rows.length) break;
      if (pageIndex > 1 && points.size === previousSize) throw new Error('12306 返回了重复的积分流水页，请缩小日期范围后重试。');
      if (total > 0 ? pageIndex * pageSize >= total : rows.length < pageSize) break;
    }

    const safe = value => {
      if (typeof value !== 'string' && typeof value !== 'number') return '';
      const text = String(value).normalize('NFKC').trim();
      return text.includes('*') ? '' : text.slice(0, 100);
    };
    const rides = [];
    async function readDetail({ tradeId, tradeType }) {
      const response = await post('memberInfo/PointDetailQuery', { queryType: tradeType, trade_id: tradeId });
      if (!successful(response.status)) {
        if (String(response.errorMsg ?? response.message ?? '').includes('无积分详情')) return;
        throw new Error('未能读完整乘车明细，请缩小日期范围后重试。');
      }
      if (!Array.isArray(response.data)) return;
      for (const row of response.data) {
        if (!row || ['fc', 'fr'].includes(row.query_type)) continue;
        const prefix = ['tg', 'ts'].includes(row.query_type) ? 'resign_' : '';
        rides.push({
          event: safe(row.query_type), service: safe(row[prefix + 'station_train_code']), date: safe(row[prefix + 'train_date']),
          originCode: safe(row[prefix + 'board_station_telecode']), destinationCode: safe(row[prefix + 'arrive_station_telecode']),
          origin: safe(row[prefix + 'board_station_name']), destination: safe(row[prefix + 'arrive_station_name']),
          seatClass: safe(row[prefix + 'seat_type_name']), seatClassCode: safe(row[prefix + 'seat_type_code']),
          carriage: safe(row[prefix + 'coach_no']), passenger: safe(row.v_assignee_id_name), orderNumber: safe(row.sequence_no)
        });
      }
    }

    const entries = [...points.values()];
    for (let i = 0; i < entries.length; i += 3) {
      await Promise.all(entries.slice(i, i + 3).map(readDetail));
    }
    return { rides };
  } catch (error) {
    if (error.name === 'TimeoutError') return { error: '查询超时，请缩小日期范围后重试。' };
    return { error: error.name === 'TypeError' ? '无法连接 12306 积分查询。' : error.message };
  }
}
