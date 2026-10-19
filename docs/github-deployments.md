# GitHub deployments

Use **Actions → Deploy → Run workflow**. GitHub supplies the selected commit;
there is no revision field to copy from a terminal.

| Environment | Select branch | Dokploy service | Supabase project | Origin |
| --- | --- | --- | --- | --- |
| Staging | `develop` | Fun → staging → soundspin-staging | `mknqduphywlluihgxysg` | `https://beta.soundspin.tobiasmaneschijn.com` |
| Production | `master` | Fun → production → soundspin | `xmutopoyxizxepkoshon` | `https://soundspin.tobiasmaneschijn.com` |

[`deploy/targets.json`](../deploy/targets.json) contains the verified project,
environment and Compose service IDs. The workflow reuses those services and
checks their target configuration before deploying. Keep Dokploy automatic
deployment disabled.

## Setup

Commit the workflows to the default branch before using GitHub's Run workflow
button. This is required for
[manual workflows](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Setup does not deploy the application.

Create GitHub Environments named `staging` and `production`. Restrict deployment
branches to exactly `develop` and `master`, respectively, with no tag rules.
This private repository's plan does not support environment required reviewers.
Production instead requires a native GitHub PR approval, checked through the
API before deployment. Another collaborator with write access must approve the
release PR's final head and include the staging run URL in the approval text;
self-approval cannot satisfy the gate. Keep the manual
Deploy action after that review and merge. See
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

For production, use the same app binding and the exact details URL emitted by
that project's integration. The initially observed production URL was
`https://supabase.com/dashboard/project/xmutopoyxizxepkoshon/branches`, but its
check was **skipped**. That result cannot authorize deployment. Correct the
production integration and confirm a successful migration deployment for the
intended `master` commit; update the exact identity binding if its URL changes.
Missing, pending, skipped, failed or differently bound checks block deployment.

GitHub publishes the private `ghcr.io/tobiasmaneschijn/soundspin` package using
its automatic `GITHUB_TOKEN` with `packages: write`; no registry secret is needed
in Actions. Grant the repository access to its package. Configure Dokploy's
registry login once for `ghcr.io`, using an account allowed to read that package
and a classic personal access token scoped to `read:packages`. Store that
credential in Dokploy, outside the workflow. See
[GitHub Container Registry authentication and access](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

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
   reviewer and GO decision in that PR. Another collaborator with write access
   must approve the final PR head after reviewing the linked staging evidence
   and include that exact staging run URL in the native **Approve** review text.
   After any staging rerun, wait for its latest attempt to succeed and obtain a
   fresh approval naming the same run URL.
2. Merge the approved PR into `master`. Wait for that exact merge commit's CI
   and production Supabase migration deployment to succeed. New commits need
   another approval; dismissed approvals or requested changes block release.
3. Run **Deploy** on `master` with environment `production`, the evidence URL
   and `staging_run` set to the successful staging deployment's GitHub run URL.
   Use the merged release PR URL for `release_evidence`.
4. Wait for deployment and ingress verification to finish.

Production downloads the staging run's `deployment-evidence` artifact and
promotes its exact digest. It verifies the successful manual staging workflow,
deployment job, run ID and attempt, image revision, migration inventory and
hosted checks. The production commit's Git tree must equal the staged commit's
tree. A merge commit with identical source is accepted; new source requires
another staging deployment. Production does not rebuild the image.

The workflow verifies that the release PR merged into this repository's `master`
at the selected commit and links the selected staging run. It checks the latest
substantive reviews, approval of the final PR head, the exact staging run link in
the approving review text and the reviewer's current repository permission.
Editing the PR description after approval cannot substitute different staging
evidence. The reviewer must still assess the full hosted release checklist;
linking a run does not complete those gates. An evidence URL or a solo operator's comment cannot
replace another collaborator's approval. This uses
[native GitHub PR reviews](https://docs.github.com/en/pull-requests/reference/pull-request-reviews).

Evidence artifacts are retained for 90 days.
Missing or expired artifacts block promotion. Workflow reruns bind evidence to
the current attempt and replace earlier artifacts.

To retry staging, select **Re-run all jobs**. **Re-run failed jobs** can retain a
build manifest from the previous attempt and is deliberately blocked by the
attempt binding. Review the completed new run before production promotion.

## Verification and recovery

Every deployment stops the target service and verifies its process has exited
before starting the replacement. It waits for deployment completion, container
health and proxy registration, then checks the intended HTTPS ingress:

- `/api/health` and `/api/ready`.
- Socket.IO polling and a real WebSocket upgrade.
- Rejection of hostile Origins and missing namespace credentials.
- Exactly one active Node instance and the running proxy target port `3000`.

Staging's host loopback binding remains `3001:3000`; production uses
`3000:3000`. Keep WebSockets enabled and prevent direct public backend access.
A triggered deployment is not a completed release.

The workflow does not apply database migrations, open public ingress or approve
the remaining hosted release gates. Keep public ingress closed until the full
evidence review permits it. Existing dated evidence remains historical evidence
for its recorded revision.

There is no automatic rollback. For recovery, review schema compatibility and
approve a previously verified image digest, then use the same stop, verify,
start and ingress checks. Preserve the failed deployment's evidence and follow
the recovery guidance in [`production-hardening.md`](production-hardening.md).
