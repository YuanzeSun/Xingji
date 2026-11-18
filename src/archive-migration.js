import { sameRecords } from './model.js';
import { sameSettings, sharedSettings } from './shared-settings.js';

function transferSettings(settings, github, d1) {
  return sharedSettings({
    ...settings,
    connections: {
      github: { ...github.config, token: github.token },
      d1: { ...d1.config, token: d1.token }
    }
  });
}

export async function copyGitHubToD1(github, d1, destination) {
  const source = await github.read();
  return d1.replace(destination, source.records, transferSettings(source.settings, github, d1));
}

export async function backUpToGitHub(d1, github, firstSnapshot = null) {
  const source = await d1.read();
  await github.verify();
  const destination = firstSnapshot ? { ...firstSnapshot, generation: crypto.randomUUID() } : await github.read();
  const settings = transferSettings(source.settings, github, d1);
  if (!firstSnapshot && destination.initialized && sameRecords(source.records, destination.records) && sameSettings(settings, destination.settings)) return { changed: false, source };
  await github.write(source.records, destination, settings, 'Back up the Xingji archive from Cloudflare D1');
  return { changed: true, source };
}
