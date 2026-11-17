// Cities associated by airport naming or location. Order retains the named service city first.
// These associations describe travel search/display, not airport administrative boundaries.
export const AIRPORT_CITY_ASSOCIATIONS = {
  XIY: ['西安', '咸阳'],
  XNN: ['西宁', '海东'],
  LXA: ['拉萨', '山南'],
  YTY: ['扬州', '泰州'],
  JGN: ['嘉峪关', '酒泉'],
  PKX: ['北京', '廊坊'],
  WHA: ['芜湖', '宣城'],
  TEN: ['铜仁', '湘西'],
  XAI: ['信阳', '驻马店']
};

export const AIRPORT_CITY_ALIASES = {
  西安: ['xian', "Xi'an"], 咸阳: ['xianyang'],
  西宁: ['xining'], 海东: ['haidong'],
  拉萨: ['lhasa', 'lasa'], 山南: ['shannan'],
  扬州: ['yangzhou'], 泰州: ['taizhou'],
  嘉峪关: ['jiayuguan'], 酒泉: ['jiuquan'],
  北京: ['beijing'], 廊坊: ['langfang'],
  芜湖: ['wuhu'], 宣城: ['xuancheng', '宣州', '宣州区', 'xuanzhou'],
  铜仁: ['tongren'], 湘西: ['xiangxi', '湘西州', '湘西土家族苗族自治州', '凤凰', '凤凰县', 'fenghuang'],
  信阳: ['xinyang'], 驻马店: ['zhumadian']
};

export const AIRPORT_CITY_ASSOCIATION_SOURCES = [
  'https://www.caac.gov.cn/XXGK/XXGK/TJSJ/202602/t20260226_230119.html',
  'https://jtj.xuancheng.gov.cn/OpennessContent/show/1804400.html',
  'https://www.caop.org.cn/kaifangkouan/yunshufangshi/kongyunkouan/2025-05-09/347.html',
  'https://www.gswbj.gov.cn/a/2024/04/17/20157.html'
];
