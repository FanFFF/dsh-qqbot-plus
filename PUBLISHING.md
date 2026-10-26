# Publishing notes

## 0. Create an npm account (only needed once)

1. Open <https://www.npmjs.com/signup>.
2. Register the username you want to own the scope. For `@yangfan1998/dsh-qqbot-plus`,
   the username must be `yangfan1998` (or you must create/join an npm org named `yangfan1998`).
3. Verify the email address.
4. Enable two-factor authentication (authenticator app) and save the recovery codes.
5. On this machine:

   ```bash
   npm login
   npm whoami
   ```

If the username `yangfan1998` is already taken, you cannot own `@yangfan1998`; pick another
username and rename the package/scope before publishing.

This repository is intentionally **unpublished** and has **no git remote** yet.
The machine's current global git identity belongs to a different GitHub account;
do not commit with it.

## 1. Verify the package

```bash
npm run check
npm pack
```

Install the tarball into a **fresh** DSH profile and verify:

```bash
dsh plugin --profile <test-profile> add ./yangfan1998-dsh-qqbot-plus-0.1.0.tgz
# add "@yangfan1998/dsh-qqbot-plus" to dsh.profile.bundles in the test profile package.json
dsh --profile <test-profile> --dump-config | grep -A3 'id: qqbot-plus'
```

Check that no secrets or personal paths are present:

```bash
git grep -nE 'appSecret|API_KEY|SESSDATA|/Users/'
```

Expected hits are documentation placeholders only.

## 2. Create the GitHub repo with **your** account

Set identity **locally in this repo only** (do not change global config):

```bash
git init -b main
git config user.name  "YOUR_GITHUB_NAME"
git config user.email "YOUR_GITHUB_EMAIL"
git add .
git commit -m "feat: initial dsh-qqbot-plus bundle"
```

Create an empty repository under your GitHub account, then:

```bash
git remote add origin git@github.com:YOUR_ACCOUNT/dsh-qqbot-plus.git
git push -u origin main
```

Add the `dsh-plugin` topic on GitHub so the registry can auto-index it.

## 3. Publish to npm

```bash
npm login
npm publish --access public
```

`@yangfan1998/dsh-qqbot-plus` is scoped. `--access public` is required so the package is
public. If you rename it to another scope, update `package.json`, the two cordis
patches and the README before publishing.

## 4. Submit to the DSH plugin market

- npm URL: `https://www.npmjs.com/package/@yangfan1998/dsh-qqbot-plus`
- or GitHub repo URL
- Add the `dsh-plugin` topic
- Ensure README, LICENSE (MIT), and a scannable source tree are present

The market may run a security scan; this package has no credentials, no
postinstall scripts, and no network calls at import time.

## 5. Known caveats

- `cordis.patch.yml` inserts `im-qqbot`; do not install this bundle into a profile
  that already has `@zaofan/dsh-qqbot` mounted, or you will get a duplicate id.
- The QQ gateway dependency can trigger `ERR_PNPM_IGNORED_BUILDS` for
  `onnxruntime-node` / `protobufjs`; run `pnpm approve-builds --all` in the
  target profile.
- The DSH plugin manager may not auto-append the bundle to
  `dsh.profile.bundles`; add it manually.
