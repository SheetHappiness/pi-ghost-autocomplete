# Publishing v0.1

The GitHub repository remains `SheetHappiness/pi-ghost-autocomplete`.
The npm parent is `pi-autocomplete`; the unscoped `pi-ghost-autocomplete` name
belongs to a different author and must not be used for this release.

1. Wait for every native CI job and `package-set` to succeed on the same commit.
   Each runner tests its own binary, real-model inference and Pi installation.
2. Download and extract that run's `release-candidate` artifact. It contains
   the parent plus Windows x64, Linux x64/glibc, Linux ARM64/glibc and macOS
   ARM64 packages, all with the same version.
3. Sign in to the npm account that owns `@sheethappiness` using `npm login`.
   First publication requires the appropriate npm account/2FA authorization.
4. From the matching source checkout, validate without publishing:

   ```powershell
   node scripts/release.mjs path/to/release-candidate
   ```

5. Publish the verified archives:

   ```powershell
   node scripts/release.mjs path/to/release-candidate --publish
   ```

The release script checks that every required archive is present, versions and
platform declarations match, and licenses/native payloads exist before making
any writes. It publishes native dependencies first and the parent last, always
to the public npm registry with public access. An interrupted publish can be
retried: already published versions are skipped only when SHA-512 integrity
matches the local archive. A conflicting immutable version stops the release.

Finally use an isolated Pi profile to run `pi install npm:pi-autocomplete@0.1.0`
against the public registry. Confirm extension discovery, native package
resolution and model startup without a development binary override. The fixture
registry smoke test in CI verifies dependency selection and install/remove;
it does not claim that npm publication has happened.

Do not upload model weights, user sessions, npm credentials or local toolchains.
Model preparation still starts at interactive Pi startup and verifies pinned
weight hashes before native loading. Installation itself does not download weights.
