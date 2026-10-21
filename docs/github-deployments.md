# GitHub deployments

Open **Actions → Deploy → Run workflow**, select the branch under **Use workflow
from**, and choose the matching **Target**. GitHub's repository write access and
environment permissions authorize the run.

| Target | Branch | Dokploy service | Supabase project | Origin |
| --- | --- | --- | --- | --- |
| Staging | `develop` | Fun → staging → soundspin-staging | `mknqduphywlluihgxysg` | `https://beta.turntune.app` |
| Production | `master` | Fun → production → soundspin | `xmutopoyxizxepkoshon` | `https://turntune.app` |

Each run has one deployment job. It checks the selected commit's CI and migration
results, builds and scans that commit's image, publishes it to GHCR, and deploys
the immutable digest to the selected environment. Production builds its selected
`master` commit in the same way. Keep `develop` as the persistent staging branch.

## Setup

Commit the workflow to the default branch so GitHub offers the
[Run workflow button](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Create GitHub Environments named `staging` and `production`, with deployment
branches restricted to `develop` and `master`, respectively. GitHub applies the
repository's access controls and each environment's configured protection rules.
See [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Configure these values in each GitHub Environment:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `DOKPLOY_API_URL` | Dokploy base URL, with or without `/api` |
| Secret | `DOKPLOY_API_KEY` | Dokploy API key for the existing services |
| Variable | `SUPABASE_PROJECT_REF` | The matching project reference above |
| Variable | `MIGRATION_CHECK_JSON` | The Supabase check identity below |

The workflow normalizes the URL to one `/api` prefix and sends `x-api-key`.
Local operators may use `DOKPLOY_API` as the URL fallback. The existing services
are Compose services; verify API methods against the instance documentation
before changing them. Application endpoints do not apply.

[`deploy/targets.json`](../deploy/targets.json) binds the repository, branches,
existing Fun services, Supabase projects and origins. The job checks those
bindings before deploying. Each target's `additionalOrigins` lists its retained
legacy domain; `APP_ORIGINS` must match. Keep Dokploy automatic deployment disabled.

Set `SOUNDSPIN_PORT=3001` for staging and `3002` for production. These bind only to
`127.0.0.1`; Dokploy itself publishes host port `3000`. The application and Dokploy
domain targets use container port `3000`. Route HTTPS and Socket.IO through the
proxy with WebSockets enabled.

### Migration checks

The existing Supabase integration applies each branch's migrations before the
server is replaced. Its GitHub App identity is ID `330661`, slug `supabase`, owner
`supabase`, with check name `Supabase Preview`. Staging's `MIGRATION_CHECK_JSON` is:

```json
{
  "type": "check_run",
  "name": "Supabase Preview",
  "app": { "id": 330661, "slug": "supabase", "owner": "supabase" },
  "identity": {
    "field": "details_url",
    "value": "https://supabase.com/dashboard/project/mknqduphywlluihgxysg"
  }
}
```

For production, set `identity.value` to
`https://supabase.com/dashboard/project/xmutopoyxizxepkoshon`. Its separate
`/branches` check does not record production migration completion. Missing,
pending, skipped, failed or differently bound checks block deployment.

### Registry and runtime configuration

Actions publishes `ghcr.io/tobiasmaneschijn/turntune` with its `GITHUB_TOKEN` and
`packages: write`. Grant the repository access to its package. Configure Dokploy's
GHCR login once with an account allowed to read that package and a classic token
scoped to `read:packages`; keep that credential in Dokploy. See
[Container Registry access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Keep application secrets in Dokploy. Align the selected Supabase project,
`APP_ORIGIN`, Auth Site URL and exact `/update-password` redirect with that
environment. Set `TRUSTED_PROXY_CIDRS` from the proxy's observed address on the
shared Docker network and recheck after proxy recreation.

Optional source-map uploads use `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_BROWSER_PROJECT`, `SENTRY_SERVER_PROJECT`, and optional `SENTRY_URL` in
GitHub. The image build mounts the token as a BuildKit secret and removes private
source maps from runtime output. See [Observability](observability.md).

## Run a deployment

1. Push the intended changes to `develop` or `master` and wait for **App checks**,
   **Security gates**, and that commit's Supabase migration deployment to succeed.
2. Open **Actions → Deploy → Run workflow**. Select `develop` with `staging`, or
   `master` with `production`, and run it.
3. Wait for the job to finish. Check its summary for the environment, revision,
   immutable image digest and runtime verification results.

The selected existing service uses **Raw Compose** with
[`compose.release.yaml`](../compose.release.yaml), which has no source build step.
The same job builds, scans and deploys the digest; its revision comes from GitHub.
[`compose.yaml`](../compose.yaml) remains available for local source builds.

The job stops the target service and verifies the old process exited before
starting its replacement. Deployments for the same environment run serially.
It waits for Dokploy completion, container health and proxy registration, then
checks:

- `/api/health` and `/api/ready` through the intended HTTPS origin.
- Socket.IO polling and a real WebSocket upgrade.
- Rejection of hostile Origins and missing namespace credentials.
- One active Node instance and running Traefik target port `3000`.

## Recovery

A trigger alone does not establish a completed deployment. If the job fails after
starting the replacement, inspect the deployment, running digest and logs before
retrying; the container may already be running. Fix the reported failure and
rerun **Deploy**. Failed or malformed status responses do not establish process
exit or health, and Compose mutations are sent once.

There is no automatic rollback. A rollback needs a schema-compatible image and
configuration, the same stop-and-verify sequence, and the ingress checks above.
Keep the previous immutable digest available. See
[Production hardening](production-hardening.md#backup-recovery-and-rollback) for
backup and schema recovery, and [Self-hosting](self-hosting.md) for source builds.
