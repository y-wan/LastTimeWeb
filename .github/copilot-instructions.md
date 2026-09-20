# Repository instructions

## Application versioning

- Treat `package.json` as the source of truth for the application version.
- Increment the version whenever production application code, runtime configuration, or shipped assets change in a way users can observe.
- Use a patch increment for fixes and small backward-compatible behavior or UI changes, a minor increment for substantial backward-compatible features, and a major increment for incompatible data or behavior changes.
- Documentation-only, test-only, CI-only, and development-tooling changes do not require a version increment.
- Keep `package-lock.json` synchronized with `package.json`, and update any tests or documentation that assert a specific version.
