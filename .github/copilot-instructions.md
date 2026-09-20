# Repository instructions

## Application versioning

- Treat `package.json` as the source of truth for the application version.
- Increment the version whenever production application code, runtime configuration, or shipped assets change in a way users can observe.
- Use a patch increment for fixes and small backward-compatible behavior or UI changes, a minor increment for substantial backward-compatible features, and a major increment for incompatible data or behavior changes.
- Documentation-only, test-only, CI-only, and development-tooling changes do not require a version increment.
- Keep `package-lock.json` synchronized with `package.json`, and update any tests or documentation that assert a specific version.

## Release automation

- When incrementing the application version, add `.github/release-notes/<version>.md` with concise user-facing highlights and any migration or compatibility notes.
- A successful `main` deployment by the **Azure Static Web Apps deploy** workflow automatically releases an untagged `package.json` version.
- Do not create application tags or GitHub releases manually during normal development. Use the **Release** workflow's manual dispatch only to recover a version whose automatic release failed.
- Release recovery must target the exact version in `package.json` and the current `main` commit.

## Documentation maintenance

- When user-visible behavior, installation or update flows, synchronization behavior, deployment entry points, or screenshot states change, review and update both `README.md` and `README.zh-CN.md`.
- Keep the English and Simplified Chinese README files structurally aligned and equivalent in meaning.
- When screenshots or hero images are affected, update their reproducible generation scripts and the corresponding assets together.
- Remove guidance that is outdated or duplicates another section instead of preserving historical instructions in the main README files.
- Internal refactoring that does not change user-visible behavior does not require a README update.
