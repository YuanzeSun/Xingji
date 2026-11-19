import { sameRecords } from './model.js';
import { sameSettings, sharedSettings, wasUnlinked } from './shared-settings.js';

function transferSettings(settings, github, d1) {
  return sharedSettings({
    ...settings,
    connections: {
      github: { ...github.config, token: github.token },
      d1: { ...d1.config, token: d1.token }
    }
  });
}

export async function bindArchivePair(github, d1, source, previews) {
  // The source can have newer tickets, but another device may also have linked it since the preview.
  let githubSnapshot = source === 'github' ? await github.read() : previews.githubSnapshot;
  const d1Snapshot = source === 'd1' ? await d1.read() : previews.d1Snapshot;
  assertLinkTargets(github, d1, githubSnapshot, d1Snapshot);
  if (hasCloudLink(github, d1, githubSnapshot, d1Snapshot)) return publishCloudLink(github, d1);

  if (source === 'github') {
    let target = d1Snapshot;
    for (let attempt = 0; attempt < 3; attempt++) {
      const settings = sharedSettings({ ...githubSnapshot.settings, connections: undefined });
      // Keep D1 standalone until GitHub commits the exact revision copied here.
      target = await d1.replace(target, githubSnapshot.records, settings);
      try {
        await github.write(githubSnapshot.records, githubSnapshot, transferSettings(settings, github, d1),
          'Store linked archive connections');
      } catch (error) {
        if (![409, 422].includes(error.status)) throw error;
        const latest = await github.read();
        if (attempt === 2 || latest.head === githubSnapshot.head || latest.generation !== githubSnapshot.generation ||
            latest.settings.connections?.d1 || (wasUnlinked(latest) && !wasUnlinked(githubSnapshot))) {
          throw new Error('GitHub 票库已有变化，请重新核对后绑定。');
        }
        await github.assertDescendant(githubSnapshot.head, latest.head);
        githubSnapshot = latest;
        continue;
      }
      return publishD1Link(github, d1, target);
    }
  }
  const settings = transferSettings(d1Snapshot.settings, github, d1);
  await github.write(d1Snapshot.records, { ...githubSnapshot, generation: crypto.randomUUID() }, settings,
    'Back up the Xingji archive from Cloudflare D1');
  return publishCloudLink(github, d1, { d1Snapshot, newBinding: true });
}

export async function backUpToGitHub(d1, github) {
  const source = await d1.read();
  await github.verify();
  const destination = await github.read();
  assertActiveCloudLink(github, d1, destination, source);
  const settings = transferSettings(source.settings, github, d1);
  const changed = !destination.initialized || !sameRecords(source.records, destination.records) || !sameSettings(settings, destination.settings);
  if (changed) await github.write(source.records, destination, settings, 'Back up the Xingji archive from Cloudflare D1');
  return { changed, sourceHead: source.head, generation: source.generation };
}

export function sameGitHubAccount(left, right) {
  return left?.id && left.id === right?.id && left.branch === right.branch;
}

export function sameD1Account(left, right) {
  return left?.id && left.id === right?.id && left.url === right.url;
}

export function pairedD1(snapshot, github) {
  const linked = snapshot?.settings?.connections;
  return sameGitHubAccount(linked?.github, github) ? linked.d1 : null;
}

export function pairedGitHub(snapshot, d1) {
  const linked = snapshot?.settings?.connections;
  return sameD1Account(linked?.d1, d1) ? linked.github : null;
}

export function assertLinkTargets(github, d1, repo, archive) {
  if (repo.settings.connections?.d1 && !sameD1Account(pairedD1(repo, github.config), d1.config)) {
    throw new Error('此 GitHub 仓库已关联另一份 D1 票库，请通过重置解除原关联。');
  }
  if (archive.settings.connections?.github && !sameGitHubAccount(pairedGitHub(archive, d1.config), github.config)) {
    throw new Error('此 D1 票库已关联另一个 GitHub 仓库，请通过重置解除原关联。');
  }
}

export function hasCloudLink(github, d1, repo, archive) {
  return sameD1Account(pairedD1(repo, github.config), d1.config) ||
    sameGitHubAccount(pairedGitHub(archive, d1.config), github.config);
}

function assertActiveCloudLink(github, d1, repo, archive) {
  assertLinkTargets(github, d1, repo, archive);
  if (wasUnlinked(repo) || wasUnlinked(archive)) throw new Error('仓库关联已解除，请重新登录后再绑定。');
}

export async function publishCloudLink(github, d1, { githubSnapshot, d1Snapshot, newBinding = false } = {}) {
  await github.verify();
  const [repo, archive] = await Promise.all([githubSnapshot ?? github.read(), d1Snapshot ?? d1.read()]);
  if (newBinding) assertLinkTargets(github, d1, repo, archive);
  else assertActiveCloudLink(github, d1, repo, archive);
  const githubSettings = transferSettings(repo.settings, github, d1);
  if (!sameSettings(githubSettings, repo.settings)) {
    await github.write(repo.records, repo, githubSettings, 'Store linked archive connections');
  }
  return publishD1Link(github, d1, archive);
}

async function publishD1Link(github, d1, archive) {
  const settings = transferSettings(archive.settings, github, d1);
  if (sameSettings(settings, archive.settings)) return archive;
  const head = await d1.write(archive.records, archive, settings);
  return { ...archive, head, settings };
}
