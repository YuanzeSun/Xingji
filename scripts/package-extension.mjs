import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

export async function extensionArchive(root) {
  const extension = 'xingji-connector';
  const files = ['manifest.json', 'background.js', 'read-trips.js', 'rules.json', 'INSTALL.txt', 'LICENSE'];
  const entries = await Promise.all(files.map(async name => {
    const source = await readFile(name === 'LICENSE' ? join(root, name) : join(root, 'extensions', extension, name), 'utf8');
    return [extension + '/' + name, strToU8(source.replace(/\r\n/g, '\n'))];
  }));
  // Use the earliest ZIP timestamp to keep builds reproducible across time zones.
  return zipSync(Object.fromEntries(entries), { level: 0, mtime: new Date(1980, 0, 1) });
}
