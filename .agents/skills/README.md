# Repository UI skills

The UI skills are checked into this repository for coding agents.

| Skill | Version | Upstream commit |
| --- | --- | --- |
| [no-slop-ui](https://github.com/LeoStehlik/no-slop-ui) | 0.3.0 | `3c8f9e5ef5ca18f5632f7b9ad8f95e2d68188bcf` |
| [Impeccable](https://github.com/pbakaus/impeccable) | 4.5.0 | `778c8a7b71ccd5bfe3ca6ac68c15d9d872d0f87d` |

Use `/impeccable distill` to simplify an interface. The distill workflow lives in
`impeccable/reference/distill.md`.

Impeccable includes its upstream references, agent definitions, and launcher.
The launcher downloads its pinned engine on first use, verifies the release
checksum, and caches it outside the repository. This requires network access and
a writable user cache. To initialize the engine from the repository root:

```sh
.agents/skills/impeccable/scripts/impeccable engine-probe
```

To validate no-slop-ui:

```sh
python3 .agents/skills/no-slop-ui/scripts/validate_skill_repo.py
```

Upstream licenses and Impeccable's attribution notice are included in their
respective skill directories. Trailing whitespace in three Impeccable reference
files was removed to pass Git whitespace checks. To update, replace each skill's files from an
upstream commit and update the version and commit above.
