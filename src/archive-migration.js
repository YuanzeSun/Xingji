import { sameRecords } from './model.js';
import { sameSettings, sharedSettings } from './shared-settings.js';

export async function copyGitHubToD1(github, d1, destination) {
  await github.verify();
  const source = await github.read();
  return d1.replace(destination, source.records, source.settings);
}

export async function clearGitHubArchive(github, snapshot) {
  await github.verify();
  const empty = { ...snapshot, generation: crypto.randomUUID() };
  return github.write([], empty, sharedSettings(), 'Clear Xingji archive before enabling manual D1 backups');
}

export async function backUpToGitHub(d1, github) {
  const source = await d1.read();
  await github.verify();
  const destination = await github.read();
  if (destination.initialized && sameRecords(source.records, destination.records) && sameSettings(source.settings, destination.settings)) return false;
  await github.write(source.records, destination, source.settings, 'Back up the Xingji archive from Cloudflare D1');
  return true;
}
