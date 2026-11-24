// Fictional demonstration payload; no ticket image or valid travel credential.
export const DEMO_TICKET_CODE = {"version":1,"format":"QRCode","rawBytes":"WElOR0pJLURFTU8tTk9ULUEtVkFMSUQtVElDS0VU","symbologyIdentifier":"]Q1","gs1":false,"eci":[],"parameters":{"symbolVersion":"2","errorCorrectionLevel":"M","mask":1}};
export const DEMO_RAIL_TICKET_CODE = {
  version: 1, format: 'QRCode',
  rawBytes: 'MjYwMDEyMzQwNzUzNTAzMjY0MTI0MTIxODg2NTcxODYxOTE1ODM0NDYxMjEwNDkxMjE5NDI2NDcyNjYwMzI0MDQ0ODAwMTAwMDAwMDAwMDAwMDAwMDAxMDUzOTAyOTE4NDA1Mzg5NzYyODgwNTM4OTc2Mjg4MDUzODk3NjI4ODA1Mzg5NzYyODgwODE1MzAw',
  symbologyIdentifier: ']Q1', gs1: false, eci: [],
  parameters: { symbolVersion: '4', errorCorrectionLevel: 'M', mask: 1 },
};
export const DEMO_RAIL_LINEAR_CODE = Object.freeze({
  version: 1, format: 'Code128', rawBytes: btoa('XINGJI-DEMO-NOT-A-RAILWAY-TICKET'),
  symbologyIdentifier: ']C0', gs1: false, eci: [], parameters: {}
});
