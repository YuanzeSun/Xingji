import {readFile, readdir, writeFile, access} from 'node:fs/promises';
import path from 'node:path';

// fontkit's published browser bundle already contains its dependencies, so
// collect their notices recursively as well as esbuild's visible inputs.
export async function writeRendererNotices(inputs) {
  const packages = new Map();
  async function collect(folder) {
    const manifest = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) return;
    packages.set(key, {folder, manifest});
    for (const name of Object.keys(manifest.dependencies || {})) {
      let parent = folder;
      while (true) {
        const dependency = path.join(parent, 'node_modules', name);
        try {
          await access(path.join(dependency, 'package.json'));
          await collect(dependency);
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const next = path.dirname(parent);
          if (next === parent) throw new Error(`Missing dependency notice: ${name}`);
          parent = next;
        }
      }
    }
  }
  for (const input of Object.keys(inputs)) {
    if (!input.includes('node_modules/')) continue;
    let folder = path.dirname(path.resolve(input));
    while (folder !== path.dirname(folder)) {
      try {
        await access(path.join(folder, 'package.json'));
        await collect(folder);
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        folder = path.dirname(folder);
      }
    }
  }
  const sections = [];
  for (const [name, {folder, manifest}] of [...packages].sort()) {
    const files = (await readdir(folder)).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file));
    const licenses = await Promise.all(files.map(file => readFile(path.join(folder, file), 'utf8')));
    if (!files.length && manifest.license === 'MIT') {
      // Some published packages omit LICENSE while declaring MIT in both
      // their manifest and README. Preserve that declaration and author.
      const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
      if (!author) throw new Error(`Missing license author: ${name}`);
      const mit = await readFile('node_modules/fontkit/LICENSE', 'utf8');
      licenses.push('MIT declaration from package metadata.\n' + mit.replace(/^Copyright[^\n]*/m, `Copyright (c) ${author}`));
    }
    if (!licenses.length) throw new Error(`Missing license text: ${name}`);
    if (manifest.name === 'brotli') {
      const decoder = await readFile(path.join(folder, 'dec/decode.js'), 'utf8');
      licenses.push(decoder.slice(0, decoder.indexOf('*/') + 2));
      // text-encoding's bundled notice preserves the full Apache 2.0 terms.
      licenses.push(await readFile('node_modules/text-encoding/LICENSE.md', 'utf8'));
    }
    sections.push(`${name}\nLicense: ${manifest.license || 'See notice below'}\n\n${licenses.join('\n\n')}`);
  }
  await writeFile('apps/flutter/assets/renderer-notices.txt', sections.join('\n\n' + '='.repeat(72) + '\n\n') + '\n');
}
