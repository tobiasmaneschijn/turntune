# GitHub deployments

Use **Actions → Deploy → Run workflow**. GitHub supplies the selected commit;
there is no revision field to copy from a terminal.

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
This private repository's plan does not support environment required reviewers.
Production uses GitHub's native manual `workflow_dispatch` authorization: a
maintainer with write access starts **Deploy** and selects `confirm_production`
after reviewing the staging evidence. The maintainer may be the release PR's
author. GitHub requires write access to
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

## Deploy staging

1. Push the reviewed changes to `develop`. Wait for **App checks**, **Security
   gates** and that commit's Supabase migration deployment to succeed.
2. Open **Actions → Deploy → Run workflow** and select branch `develop` and
   environment `staging`.
3. Set `release_evidence` to an issue or pull request URL in this repository
   recording the operator's approval and applicable release evidence. Run the
   workflow.
4. Wait for **Deploy staging** to pass, review its evidence and retain the run
   URL for production.

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

1. Open the release PR into `master` and link the successful staging run in its
   description. Complete and review the hosted gates in
   [`SECURITY_RELEASE_STATUS.md`](../SECURITY_RELEASE_STATUS.md) and
   [`production-hardening.md`](production-hardening.md). Record the evidence,
   operator and GO decision in that PR. A solo maintainer can review and deploy
   their own release.
2. Merge the release PR into `master`. Keep `develop` as the persistent staging
   branch; do not delete it after promotion. Wait for the exact merge commit's
   CI and production Supabase migration deployment to succeed.
3. After the merge and latest successful staging attempt, open **Deploy → Run
   workflow**, select `master` and environment `production`, and select
   `confirm_production` after reviewing the evidence. Set `release_evidence` to
   the merged release PR URL and `staging_run` to the successful staging
   deployment's GitHub run URL.
4. Wait for deployment and ingress verification to finish.

Production downloads the staging run's `deployment-evidence` artifact and
promotes its exact digest. It verifies the successful manual staging workflow,
deployment job, run ID and attempt, image revision, migration inventory and
hosted checks. The production commit's Git tree must equal the staged commit's
tree. A merge commit with identical source is accepted; new source requires
another staging deployment. Production does not rebuild the image.

The workflow verifies the merged release PR, its staging link and the native
production dispatch actor's current write access. The original dispatch must
postdate the merge and latest successful staging attempt; starting a queued job
or rerunning it does not supply a new authorization. The selected staging
attempt is checked again immediately before the active process is stopped.

Unresolved changes-requested reviews from trusted collaborators still block
release. A later approval or native dismissal can resolve them. A second
reviewer is optional; the operator remains responsible for the full hosted
release checklist. See [GitHub PR reviews](https://docs.github.com/en/pull-requests/reference/pull-request-reviews).

Evidence artifacts are retained for 90 days.
Missing or expired artifacts block promotion. Workflow reruns bind evidence to
the current attempt and replace earlier artifacts.

To retry staging, select **Re-run all jobs**. **Re-run failed jobs** can retain a
build manifest from the previous attempt and is deliberately blocked by the
attempt binding. Review the completed new run before production promotion.
After any new staging attempt, use a fresh production **Run workflow** action
with confirmation. **Re-run failed jobs** preserves the original production
dispatch and cannot authorize staging evidence completed after that dispatch.
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

The workflow does not apply database migrations, open public ingress or approve
the remaining hosted release gates. Keep public ingress closed until the full
evidence review permits it. Existing dated evidence remains historical evidence
for its recorded revision.

There is no automatic rollback. For recovery, review schema compatibility and
approve a previously verified image digest, then use the same stop, verify,
start and ingress checks. Preserve the failed deployment's evidence and follow
the recovery guidance in [`production-hardening.md`](production-hardening.md).
