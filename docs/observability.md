# Observability

turntune reports errors and structured logs through an application-owned adapter.
Server traces and metrics use OpenTelemetry. Provider SDK imports stay inside the
observability implementation so changing the backend does not require changing
feature code.

## Runtime configuration

Set these values on the existing Dokploy Compose service, or in the process
environment for direct Node hosting. The Compose files pass them to the server.

| Setting | Behavior |
| --- | --- |
| `OBSERVABILITY_PROVIDER` | `console` by default; `sentry` enables remote errors, logs and sampled server traces; `none` disables application reporting and performance export. |
| `OBSERVABILITY_ENVIRONMENT` | Environment label. Use `staging` on staging and `production` on production. |
| `SENTRY_DSN` | Server project's HTTPS DSN when using Sentry. |
| `SENTRY_BROWSER_DSN` | Browser project's HTTPS DSN. This value is public and is supplied through `/api/config`. |
| `OBSERVABILITY_TRACES_SAMPLE_RATE` | Server trace sample rate from `0` to `1`; default `0.1`. Use `0` to disable sampling. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional server-only OTLP HTTP base URL, for example `https://collector.example`. Exporters append `/v1/traces` and `/v1/metrics`. No collector is provisioned by turntune. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional comma-separated exporter `key=value` headers. Treat authorization values as server secrets. |

Provider, DSNs, environment and sampling settings are runtime configuration. The
same image can run in staging and production without a rebuild. Restart the
service after changing its environment, following the existing stop, verify exit,
start procedure. Existing health, readiness and deployment gates still apply.

The release is the Git revision embedded in `dist-server/build-release.json`.
Docker also records `BUILD_REVISION` and the OCI revision label. The manual
release workflow supplies the build revision. Source builds use
`SOUNDSPIN_REVISION`; direct builds can set `BUILD_REVISION` before `npm run build`.
Local builds without a revision use `unknown`. Do not override the revision at
deployment: production promotes the original staging image, including its release
identity, even when the production merge commit has a different SHA.

## Enable Sentry

1. Use the existing [turntune-browser](https://turntune.sentry.io/settings/projects/turntune-browser/)
   and [turntune-server](https://turntune.sentry.io/settings/projects/turntune-server/)
   projects in the `turntune` organization (Germany region). Keep their DSNs separate.
2. Set `OBSERVABILITY_PROVIDER=sentry`, the two DSNs and the environment label in
   each service's restricted runtime configuration.
3. Configure the optional private source-map upload below before building a
   release. Without an upload token, builds still succeed and remove source maps;
   Sentry stack traces will refer to the compiled code.
4. Deploy to staging using the existing manual workflow. Trigger a controlled
   failure in staging and verify its project, environment, release, operation and
   original source location in Sentry. Check that secrets and user content are
   absent. Remove any temporary failure trigger before release.
5. Configure alerts in Sentry for new errors and sustained failure rates. Set
   retention, ingestion quotas and access controls for both projects.

Browser reports are sent directly to the browser project's ingestion endpoint.
Ad blockers and offline clients can prevent delivery. Browser reporting remains
best effort and does not block startup or playback.

### Private source maps

The build emits browser hidden source maps and server source maps containing the
original source. `scripts/observability/prepare-build.mjs` then injects Debug IDs,
optionally uploads both artifact sets, and removes every `.map` from `dist` and
`dist-server`. Maps are removed on an upload failure too, and that build fails.
The runtime image contains neither source maps nor the upload token.

Configure repository-level GitHub settings for the reusable image workflow:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `SENTRY_AUTH_TOKEN` | Build-only Sentry token allowed to upload source maps for the two projects. |
| Variable | `SENTRY_ORG` | `turntune` |
| Variable | `SENTRY_BROWSER_PROJECT` | `turntune-browser` |
| Variable | `SENTRY_SERVER_PROJECT` | `turntune-server` |
| Variable | `SENTRY_URL` | Optional HTTPS API base for a regional or self-hosted Sentry installation. Leave blank for the CLI default. |

The image workflow passes the token as a BuildKit secret. Organization, project
and API URL are nonsecret build arguments. Keep the upload token out of `.env`,
`VITE_*`, Docker build arguments and runtime settings. A configured token requires
both projects, the organization and a full build revision; incomplete upload
configuration fails the build.

For an independent Docker build, supply the token from a restricted file through
`--secret id=sentry_auth_token,src=/restricted/sentry-token`, and pass the four
nonsecret settings through `--build-arg`. Also set
`--build-arg SENTRY_UPLOAD_ENABLED=true` when enabling upload; this invalidates a
cached build that previously had no upload token and requires the mounted secret.
Use the same build revision for the
image and source-map upload. The supplied source Compose configuration does not
mount a Sentry token automatically. For direct Node builds, the script also
accepts a build-only `SENTRY_AUTH_TOKEN_FILE` or `SENTRY_AUTH_TOKEN` environment
variable, together with the nonsecret settings and `BUILD_REVISION`.

Debug IDs connect events to the uploaded artifacts, while the embedded release
ties errors and logs to the immutable image. Upload completes before the image
can be published or deployed. Production promotion reuses that image and its
already uploaded maps; it does not rebuild or upload a second artifact set.

See Sentry's [source-map troubleshooting guide](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/troubleshooting_js/)
for checking artifact Debug IDs and using `sentry-cli sourcemaps explain` on an
event that did not resolve to its original source.

## Logs, traces and metrics

Application logs use stable event and operation names with bounded numeric
context. Server logs are structured JSON on stdout so the hosting platform or a
log collector can retain and query them independently of Sentry. Existing
security events retain their separate bounded stream.

OpenTelemetry instruments the server's explicit application operations and
runtime measurements. Sentry receives sampled server traces when its adapter is
enabled. Configure the optional OTLP endpoint and headers to send traces and
metrics to an existing collector or compatible backend; metrics require that
endpoint. Export credentials never reach the
browser. Sampling controls trace volume; metrics use bounded labels rather than
account, room or request identifiers. Browser performance monitoring and session
replay are not enabled.

Monitoring is best effort. Capture and export failures do not change request
results, saving, playback or readiness. Shutdown attempts a bounded flush.

## Privacy and feature code

Use the shared `telemetry.captureError` and `telemetry.log` entrypoints. Provide a
stable operation such as `room.save`, plus only the allowed context fields.
Do not pass request bodies, messages, track metadata, account data, URLs, cookies,
tokens or provider responses. Expected input and authorization failures are not
incidents. Report an exception at the boundary responsible for handling it;
duplicate captures of the same exception are suppressed.

The shared privacy filter replaces arbitrary error messages with the operation,
retains code locations and allowlisted context, and limits event volume. Final
Sentry event and log filters also constrain SDK enrichment. Automatic request
capture, breadcrumbs, user identity, session replay and arbitrary SDK context are
disabled. Keep these rules when adding instrumentation or replacing an adapter.
A fixed unspecified IP prevents Sentry's ingestion layer from inferring a
location. Affected-user counts are not meaningful because user identity is withheld.

## Switch providers

To stop Sentry error and log delivery, select `console` or `none` and restart the
existing service. To move traces and metrics, change the OTLP endpoint and
headers. For another error-reporting service, implement the shared adapter
contract and select it in the server and browser bootstrap modules. Feature code
continues to use the same entrypoints.

Source-map tooling is isolated in the build script. Replace that upload step for
another provider while preserving the embedded release, private maps and cleanup
checks. Alerts, dashboards, retention policies and historical incidents require
separate migration in the destination service.
