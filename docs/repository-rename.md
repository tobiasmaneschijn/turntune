# Repository and integration names

On 2026-10-19, the existing private GitHub repository was renamed to
[`tobiasmaneschijn/turntune`](https://github.com/tobiasmaneschijn/turntune).
Its repository identity and visibility were preserved.

The existing deployment and database connections were verified after the rename:

| Environment | Branch | Dokploy Compose service | Supabase project | Working directory |
| --- | --- | --- | --- | --- |
| Staging | `develop` | Fun / staging / soundspin-staging | SoundSpin Staging | `.` |
| Production | `master` | Fun / production / soundspin | SoundSpin | `.` |

Both Dokploy services retain their existing IDs, raw Compose configuration,
domains, environment settings, and pinned images. Only their repository metadata
was updated. Automatic deployment remains disabled; no deployment was triggered
by the rename. The current release workflows deploy a prebuilt image through the
existing raw Compose services; see [GitHub deployments](github-deployments.md).

Both Supabase integrations followed the renamed repository automatically using
the same GitHub repository ID. Their `master`/`develop` mappings and working
directory `.` were verified. No project, database, migration history, or Auth
configuration was reset.

Use `https://github.com/tobiasmaneschijn/turntune.git` for new clones and active
remotes. Existing private backups retain their original metadata. Renaming the
repository does not remove historical Git objects, pull requests, or artifacts;
the separate [publication review](open-source-publication.md) covers that work.

## Internal names and service releases

Keep Compose service/volume names, environment variables, Supabase project
references, buckets, database/RPC identifiers, and browser storage keys stable.
They identify existing data and services and are independent of the product or
repository name. Keep existing deployed image digests until a reviewed release
replaces them. New image builds derive their package path from the renamed
GitHub repository.

The rename does not change application domains. Domain changes require their
own review of proxy routing, allowed origins, Auth redirects, and provider
callbacks. Continue using the existing migration, CI, staging, and manual
deployment gates before replacing either running service.
