// Local deployment helper: reads an existing Git Credential Manager credential into memory only.
// Never writes or prints the credential, and never starts an interactive sign-in.
import { spawnSync } from 'node:child_process';
const account = process.argv[2];
if (!/^[a-zA-Z0-9-]+$/.test(account || '')) throw new Error('Pass a GitHub account name.');
const credential = spawnSync('git', ['credential-manager', '--no-ui', 'get'], { input: `protocol=https\nhost=github.com\nusername=${account}\n\n`, encoding: 'utf8', env: { ...process.env, GCM_INTERACTIVE: 'never' }, windowsHide: true });
const secret = credential.stdout?.split(/\r?\n/).find(l => l.startsWith('password='))?.slice(9);
if (!secret) { console.log('NO_LOCAL_CREDENTIAL'); process.exit(1); }
const response = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${secret}`, Accept: 'application/vnd.github+json' } });
if (!response.ok) { console.log(`AUTH_STATUS_${response.status}`); process.exit(1); }
const user = await response.json();
console.log(JSON.stringify({ authenticatedAccount: user.login, matchesRequestedAccount: user.login.toLowerCase() === account.toLowerCase(), scopes: response.headers.get('x-oauth-scopes') }));
