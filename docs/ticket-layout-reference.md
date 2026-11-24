# Ticket layout references

The current layouts use separate typography, proportions and field spacing for each ticket stock. They are source-code templates, not scans of another person's ticket.

## References

- [12306, 关于公布新车票式样的公告, 2015-06-24](https://www.12306.cn/mormhweb/zxdt/201506/t20150624_3160.html): official soft-paper, magnetic-stock and mobile supplement specimens. The red and blue tickets share the added station suffix, identity/name row and dashed notice. The supplement prints the date, reason, fee, additional charge and issuing passenger-transport division without the standard pinyin row or notice box.
- [12306, 关于修改部分车票票样的通知, 2009](https://www.12306.cn/mormhweb/kygfwj/gfxwj/201001/t20100120_1516.html) and [CCTV historical specimens](https://www.xinhuanet.com/politics/2018-02/01/c_129803457.htm): the linear barcode ran across the bottom of the older red ticket. From the December 2009 rollout the QR was at lower right. The QR appeared on anonymous red tickets before nationwide real-name ticketing.
- [CCTV, 2014-01-17](https://news.cntv.cn/2014/01/17/ARTI1389922787078519.shtml): reference for the older red ticket's paper margin, station lettering, upper-right sales station and lower-right gate position. The photographs remain untracked development references.
- [Airport Nikola Tesla procurement specifications](https://www.antb.rs/images/jn/arhiva/TD%2086-13%20BOARDING%20PASSES%20AND%20BAGGAGE%20TAGS%20FOR%20DCS.pdf): describes a common 203 × 82.5 mm stock. The unified aviation template uses a comparable 2.46:1 ratio. It is not a claim that every airline uses identical ticket stock.

## Independent coordinate systems

| Template | Native SVG | Content |
|---|---|---|
| rail-red-barcode | 900 × 600 | Older anonymous red stock, space across the bottom for the linear barcode and human-readable sales code |
| rail-red-qr | 900 × 600 | Older anonymous red stock with lower-right QR position |
| rail-red-classic | 900 × 600 | Older real-name red stock, passenger name above the masked identity, upper-right sales station |
| rail-red | 900 × 600 | 2015-style red stock, small station suffix, shared identity/name line and dashed notice |
| rail-blue | 856 × 540 | 2015-style magnetic stock, compact station and pinyin rows, blue sales footer |
| rail-supplement | 900 × 600 | 2015-style on-board supplement, date without time, reason, fees and issuing passenger-transport division |
| rail-receipt | 856 × 540 | Smaller thermal heading, left-side reimbursement label and return notice |
| rail-refund-receipt | 856 × 540 | Printed refund-fee voucher using the same reimbursement layout and a separate fee marker |
| air-boarding-pass | 1230 × 500 | Long boarding pass, main coupon, vertical tear line and right-hand passenger stub |

PNG dimensions are twice the native SVG dimensions. The export code obtains dimensions from the selected template, rather than resizing all records to a railway card.

## Fonts and development scope

Chinese station, body, numeral and pinyin fonts have distinct roles. Bundled fonts make the layout independent of whichever Song/Hei fonts happen to be installed on a device. Verified original QR data can be rendered at the template's lower-right coordinates. The linear-barcode layout uses the printed fields from OCR or manual entry and reserves the barcode area. The preview matrix uses fictional demonstration codes that contain only `XINGJI-DEMO-NOT-A-RAILWAY-TICKET`. Backgrounds are independently drawn vector reconstructions.

This is an unreleased development build. Only the current renderers and data structure are maintained; experimental legacy layouts and migration branches have been removed. Historical red/blue ticket styles remain distinct collection options.

## Checks

Station pinyin was rechecked on 2026-11-17 against the supplied magnetic, red-paper and thermal specimens (Liuzhou, Changshanan, Shanghaihongqiao, Yuxi, Zhangping and Suban, with additional crops). Candidates included Termes/Tinos, Courier/Cursor, Liberation Mono, OCR-B, Barlow and the Latin glyphs of Song/Hei/Fang families. The Times-family bold contours were the closer approximation across most readable crops; the main correction is narrower glyph bodies with wider tracking. The new `TicketRailPinyin` face has its own 61% outlines, 0.115 em tracking and generated advance metrics. Pinyin no longer shares the sale-code face; date, seat, fare and sale-code fonts retain their existing roles. Photos differ in perspective and print quality, so this is a visual approximation rather than an identification of an official railway font.

Flight records can be normal, OPEN or invalid. OPEN and invalid tickets have a visible mark on both the main coupon and stub, accept undetermined flight/date/seat fields, and remain archive items without contributing journeys, visited places, routes or aircraft counts. The archive's stored-ticket and search-result counts still describe its contents.

Tests cover independent dimensions, the long aviation ratio, identity/name alignment, rail-label differences, status exclusion, code payload preservation, escaping and undistorted PNG export. SVGs are rasterized with the bundled fonts for geometry review; desktop/mobile browser flows are checked with isolated fictional records.
