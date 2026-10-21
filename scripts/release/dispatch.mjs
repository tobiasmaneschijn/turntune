import { verifyStagingRun } from './promotion.mjs';

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`);
  return Number.isFinite(time) && new Date(time).toISOString() === canonical ? time : NaN;
}

/** GitHub authorizes manual dispatches; bind the confirmation to this run. */
export async function verifyDeploymentDispatch({ github, repository, sha, environment, eventName, confirmed, runId, runAttempt }) {
  if (eventName !== 'workflow_dispatch' || confirmed !== 'true') throw new Error('Start Deploy manually and select Confirm deployment.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')
    || !['staging', 'production'].includes(environment)
    || !/^[1-9]\d*$/.test(String(runId ?? '')) || !Number.isSafeInteger(Number(runId))
    || !/^[1-9]\d*$/.test(String(runAttempt ?? '')) || !Number.isSafeInteger(Number(runAttempt))) {
    throw new Error('Deployment requires its repository, revision, target, and GitHub run identity.');
  }
  const [owner, repo] = repository.split('/');
  const { data: run } = await github.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', { owner, repo, run_id: Number(runId) });
  // GitHub can associate PRs with manual runs; the event and run identity establish dispatch provenance.
  if (run?.id !== Number(runId) || run.run_attempt !== Number(runAttempt)
    || run.event !== 'workflow_dispatch' || run.head_branch !== (environment === 'production' ? 'master' : 'develop')
    || run.head_sha !== sha || run.path !== '.github/workflows/deploy.yml'
    || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase()
    || run.head_repository?.full_name?.toLowerCase() !== repository.toLowerCase()
    || run.status !== 'in_progress' || run.conclusion !== null || !Number.isFinite(timestamp(run.created_at))) {
    throw new Error('Deployment requires the active manual Deploy run for the selected branch and revision.');
  }
  return { type: 'workflow_dispatch', url: `https://github.com/${repository}/actions/runs/${run.id}`,
    runId: run.id, runAttempt: run.run_attempt, dispatchedAt: run.created_at, confirmed: true };
}

/** Rerunning or queuing production cannot approve staging completed later. */
export async function verifyStagingForDispatch({ github, repository, stagingRunUrl, dispatch }) {
  const staging = await verifyStagingRun({ github, repository, stagingRunUrl });
  const completedAt = timestamp(staging.updated_at);
  const dispatchedAt = timestamp(dispatch.dispatchedAt);
  if (!Number.isFinite(completedAt) || !Number.isFinite(dispatchedAt) || completedAt > dispatchedAt) {
    throw new Error('Start a new Deploy workflow after the selected staging deployment succeeds.');
  }
  return { ...dispatch, stagingRunUrl, stagingRunId: staging.id, stagingRunAttempt: staging.run_attempt, stagingVerifiedAt: staging.updated_at };
}
