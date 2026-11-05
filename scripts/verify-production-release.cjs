// Read-only release gate. No deploy, environment mutation or credential output.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const git = (...args) => cp.execFileSync('git', args, { encoding: 'utf8' }).trim();

async function main() {
  const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
  const authPath = path.join(process.env.APPDATA || '', 'com.vercel.cli/Data/auth.json');
  const token = process.env.VERCEL_TOKEN || JSON.parse(fs.readFileSync(authPath, 'utf8')).token;
  const api = async (route) => {
    const response = await fetch(`https://api.vercel.com${route}${route.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(project.orgId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw Error(`Vercel verification HTTP ${response.status}`);
    return response.json();
  };
  const current = await api(`/v9/projects/${encodeURIComponent(project.projectId)}`);
  const branch = git('branch', '--show-current');
  assert.equal(current.link?.productionBranch, branch, 'Current branch must be the configured Vercel Production branch');
  assert.equal(git('config', '--get', 'remote.origin.url'), `https://github.com/${current.link.org}/${current.link.repo}.git`, 'Origin must match the Vercel linked repository');
  const deployment = current.targets?.production;
  const result = { project: current.name, branch, head: git('rev-parse', 'HEAD'), productionSha: deployment?.meta?.githubCommitSha, state: deployment?.readyState, deploymentId: deployment?.id };
  if (process.argv.includes('--deployed')) {
    assert.equal(result.productionSha, result.head, 'Production must match the released commit');
    const details = await api(`/v13/deployments/${encodeURIComponent(deployment.id)}`);
    assert.equal(details.target, 'production'); assert.equal(details.readyState, 'READY');
    result.aliases = details.alias;
    const origin = 'https://qts-job-system.vercel.app';
    result.health = (await fetch(`${origin}/api/extension/auth/health`)).status;
    assert.equal(result.health, 200);
    for (const route of ['answer-library', 'documents']) {
      const response = await fetch(`${origin}/api/extension/apply/${route}`, route === 'answer-library' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {});
      assert.equal(response.status, 401, `${route} must refuse unauthenticated access`);
    }
  }
  console.log(JSON.stringify(result));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
