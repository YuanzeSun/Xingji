import { readTrips } from './read-trips.js';

const pointsPage = 'https://cx.12306.cn/tlcx/jfinformation.html';
const appPage = 'https://yuanzesun.github.io/Xingji/';
let reading = false;

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (sender.frameId !== 0 || ![appPage, appPage + 'index.html'].includes(sender.url?.split(/[?#]/)[0])) return;
  if (message?.action !== 'readRailPoints') return;
  if (reading) { reply({ error: '正在查询 12306，请稍候。' }); return; }
  reading = true;
  (async () => {
    try {
      const tabs = await chrome.tabs.query({ url: pointsPage + '*' });
      const tab = tabs.find(item => item.url?.split(/[?#]/)[0] === pointsPage);
      if (!tab) { reply({ error: '请打开 12306 积分查询页面并扫码登录。' }); return; }
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, func: readTrips, args: [message.start, message.end]
      });
      reply(result ?? { error: '未能读取乘车明细，请刷新 12306 积分查询页面后重试。' });
    } catch {
      reply({ error: '未能读取 12306 积分查询页面，请确认页面已打开。' });
    } finally {
      reading = false;
    }
  })();
  return true;
});
