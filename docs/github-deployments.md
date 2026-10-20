# GitHub deployments

Use **Actions → Deploy → Run workflow**. Set **Use workflow from**, choose the
matching **Target**, and select **Confirm deployment**. GitHub supplies the
selected commit and the workflow records deployment evidence automatically.

| Environment | Select branch | Dokploy service | Supabase project | Origin |
| --- | --- | --- | --- | --- |
| Staging | `develop` | Fun → staging → soundspin-staging | `mknqduphywlluihgxysg` | `https://beta.turntune.app` |
| Production | `master` | Fun → production → soundspin | `xmutopoyxizxepkoshon` | `https://turntune.app` |

[`deploy/targets.json`](../deploy/targets.json) contains the verified project,
environment and Compose service IDs. The workflow reuses those services and
checks their target configuration before deploying. Each target's
`additionalOrigins` lists its retained legacy domain; `APP_ORIGINS` must match
that list exactly. Keep Dokploy automatic deployment disabled.

Set Dokploy's `SOUNDSPIN_PORT` to `3001` for staging and `3002` for production.
These ports bind only to `127.0.0.1`; Dokploy itself publishes host port `3000`.
The application and all Dokploy domain targets continue to use container port
`3000`.

## Setup

Commit the workflows to the default branch before using GitHub's Run workflow
button. This is required for
[manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Setup does not deploy the application.

Create GitHub Environments named `staging` and `production`. Restrict deployment
branches to exactly `develop` and `master`, respectively, with no tag rules.
GitHub's native manual `workflow_dispatch` permission authorizes deployment.
The **Confirm deployment** checkbox (`confirm_deployment`) is required for both
targets. GitHub requires write access to
[run a workflow manually](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Keep the environment branch restrictions above; see
[GitHub Environment configuration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

Configure these values in each GitHub Environment:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `DOKPLOY_API_URL` | Dokploy base URL, with or without `/api` |
| Secret | `DOKPLOY_API_KEY` | Dokploy API key for the existing services |
| Variable | `SUPABASE_PROJECT_REF` | The environment's project reference from the table above |
| Variable | `MIGRATION_CHECK_JSON` | Observed Supabase check identity, as described below |

The workflow normalizes the API URL to one `/api` prefix and authenticates with
`x-api-key`. Local operators may use `DOKPLOY_API` as the URL fallback. Verify
Compose endpoints against this instance's API documentation; Application
endpoints do not apply. See [Dokploy API documentation](https://docs.dokploy.com/docs/api).

The existing Supabase integration must apply the intended commit's migrations
before deployment. Its observed GitHub App identity is ID `330661`, slug
`supabase`, owner `supabase`, with check name `Supabase Preview`. Staging's
`MIGRATION_CHECK_JSON` is:

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

For production, use the same app binding with `identity.value` set to
`https://supabase.com/dashboard/project/xmutopoyxizxepkoshon`. This is the exact
URL emitted by the successful production migration check. The integration
automatically deploys migrations when `master` updates. Its separate `/branches`
check does not record production completion. Missing, pending, skipped, failed
or differently bound checks block deployment.

GitHub publishes the private `ghcr.io/tobiasmaneschijn/turntune` package using
its automatic `GITHUB_TOKEN` with `packages: write`; no registry secret is needed
in Actions. Grant the repository access to its package. Configure Dokploy's
registry login once for `ghcr.io`, using an account allowed to read that package
and a classic personal access token scoped to `read:packages`. Store that
credential in Dokploy, outside the workflow. See
[GitHub Container Registry authentication and access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

The renamed repository supplies this image path for new releases. Keep existing
deployed image references pinned until a reviewed release replaces them. The
Dokploy service names, Compose volumes and `SOUNDSPIN_*` variables retain their
existing names.

Keep application secrets and runtime settings in Dokploy. Verify the Supabase
project, `APP_ORIGIN`, Auth Site URL and exact `/update-password` redirect for
each environment. Production's `TRUSTED_PROXY_CIDRS` was verified as
`10.0.1.11/32` on 2026-10-19, matching the proxy's observed address on the shared
Docker network. Recheck the address after proxy recreation. The configured
application domains use the HTTPS origins above.

For Sentry, keep DSNs, provider and environment labels in each service's runtime
settings. Optional private source-map uploads use the repository secret
`SENTRY_AUTH_TOKEN` and repository variables `SENTRY_ORG`,
`SENTRY_BROWSER_PROJECT`, `SENTRY_SERVER_PROJECT`, and optional `SENTRY_URL`.
The reusable image workflow mounts the token as a BuildKit secret, uploads maps
before publishing, and removes them from runtime output. The embedded release
revision stays unchanged when the scanned staging digest is promoted. See
[Observability](observability.md) for configuration and verification.

## Deploy staging

1. Push the reviewed changes to `develop`. Wait for **App checks**, **Security
   gates** and that commit's Supabase migration deployment to succeed.
2. Open **Actions → Deploy → Run workflow**. Set **Use workflow from** to
   `develop`, **Target** to `staging`, and select **Confirm deployment**.
3. Run the workflow and wait for **Deploy staging** and ingress verification to
   pass. Review the generated deployment evidence before promotion.

The reusable image workflow builds the selected revision once, scans the image
and publishes it to GHCR. The manifest records its revision, immutable digest,
dependency lock hash and migration inventory. The revision label is supplied by
GitHub; operators do not set `SOUNDSPIN_REVISION`.

The first deployment switches the selected existing Dokploy service from Git
source to **Raw Compose**. [`compose.release.yaml`](../compose.release.yaml)
retains the hardened runtime configuration and requires the exact image digest;
it has no build step. [`compose.yaml`](../compose.yaml) remains the local source
build configuration. This prevents deployment from fetching a moving branch.
Docker documents why [digests identify immutable images](https://docs.docker.com/dhi/explore/security-concepts/digests/).

## Deploy production

1. Complete and review the hosted gates in
   [production hardening](production-hardening.md), including the successful
   staging deployment and its generated evidence.
2. Merge the staged source into `master` without changing its Git tree. Keep
   `develop` as the persistent staging branch. Wait for the selected `master`
   commit's CI and production Supabase migration deployment to succeed.
3. After the matching staging attempt completes, open **Deploy → Run workflow**.
   Set **Use workflow from** to `master`, **Target** to `production`, and select
   **Confirm deployment**. Start a fresh workflow run.
4. Wait for deployment and ingress verification to finish.

Production automatically finds the latest successful manual **Deploy** run from
`develop` whose Git tree equals the selected `master` commit's tree. It downloads
that run's `deployment-evidence` artifact and verifies the staging deployment
job, run ID and current attempt, immutable image reference, image revision,
dependency lock hash, migration inventory and hosted checks. It promotes the
exact verified digest without rebuilding. A merge commit with identical source
is accepted; new source requires another staging deployment.

The original production dispatch must follow the matching staging attempt's
completion. Starting a queued job or rerunning an earlier dispatch does not
establish a later confirmation. The selected staging attempt is checked again
immediately before the active process is stopped. Missing matching staging
evidence blocks production before any service is stopped.

Evidence artifacts are retained for 90 days.
Missing or expired artifacts block promotion. Workflow reruns bind evidence to
the current attempt and replace earlier artifacts.

To retry staging, select **Re-run all jobs**. **Re-run failed jobs** can retain a
build manifest from the previous attempt and is deliberately blocked by the
attempt binding. Review the completed new run before production promotion.
After a new matching staging attempt completes, use a fresh production **Run
workflow** action with **Confirm deployment** selected. **Re-run failed jobs**
preserves the original production dispatch and cannot confirm staging evidence
completed after that dispatch.
GitHub documents the retained actor and source context for
[workflow reruns](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

## Verification and recovery

Every deployment stops the target service and verifies its process has exited
before starting the replacement. It waits for deployment completion, container
health and proxy registration, then checks the intended HTTPS ingress:

- `/api/health` and `/api/ready`.
- Socket.IO polling and a real WebSocket upgrade.
- Rejection of hostile Origins and missing namespace credentials.
- Exactly one active Node instance and the running proxy target port `3000`.

Staging's host loopback binding is `127.0.0.1:3001:3000`; production uses
`127.0.0.1:3002:3000`. Keep WebSockets enabled and prevent direct public backend access.
A triggered deployment is not a completed release.

Empty or malformed Dokploy polling responses are retried briefly; they do not count as
deployment or process-exit evidence. Compose mutations are sent once. If a run
fails after starting the replacement, inspect the deployment and running image
before retrying: the container may already be healthy even though GitHub has
no verified deployment evidence. Fix the reported failure, then start a fresh
staging run or re-run all staging jobs; do not promote the failed run.

The workflow does not apply database migrations, open public ingress or approve
the remaining hosted release gates. Keep public ingress closed until the full
evidence review permits it. Existing dated evidence remains historical evidence
for its recorded revision.

There is no automatic rollback. For recovery, review schema compatibility and
approve a previously verified image digest, then use the same stop, verify,
start and ingress checks. Preserve the failed deployment's evidence and follow
the recovery guidance in [`production-hardening.md`](production-hardening.md).
