# Bootstrap the SohoPay skills CDN

One-time operator steps. After this, push to `main` (or **Deploy agent skills** `workflow_dispatch`) publishes `https://agents.sohopay.xyz/skills/v1/`.

Requires AWS credentials in the **same account that owns the `sohopay.xyz` hosted zone** (the marketing site account). CloudFront ACM must stay in `us-east-1`.

## 1. Deploy the stack

From this directory (`skills/infra`):

```bash
npm install
npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/us-east-1   # once per account/region
npx cdk deploy
```

`cdk.json` already imports the account GitHub OIDC provider (`sohopay:githubOidcProviderArn`). Override only if that ARN is wrong:

```bash
npx cdk deploy -c sohopay:githubOidcProviderArn=arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com
```

`HostedZone.fromLookup` needs live AWS credentials at synth time. Confirm DNS for `sohopay.xyz` is in this account before deploy.

Copy these stack outputs:

| Output | GitHub secret |
|--------|----------------|
| `AgentsSkillsDeployRoleArn` | `AWS_DEPLOY_ROLE_ARN` |
| `AgentsSkillsBucket` | `AGENTS_SKILLS_BUCKET` |
| `AgentsSkillsDistributionId` | `AGENTS_SKILLS_CF_ID` |

`AgentsSkillsUrl` should be `https://agents.sohopay.xyz/skills/v1/`.

## 2. Set GitHub secrets

On `sohopay/skills` → Settings → Secrets and variables → Actions, create the three secrets above. Do **not** reuse the backend ECS deploy role.

The OIDC trust on `SohoPaySkillsGitHubDeployRole` is `repo:sohopay/skills:ref:refs/heads/main` only.

Until the secrets exist, `.github/workflows/deploy.yml` preflight skips publish (validate still runs). After they exist, a failed sync **fails** the job.

## 3. First publish

Run **Deploy agent skills** (`workflow_dispatch`) on `main`, or merge to `main`. The workflow:

- syncs `.well-known/` to `s3://$BUCKET/.well-known/`
- syncs skill markdown to `s3://$BUCKET/skills/v1/` as `text/markdown; charset=utf-8` with `Cache-Control: public,max-age=300`
- puts `llms-full.txt` at `s3://$BUCKET/skills/v1/llms-full.txt`
- invalidates `/skills/v1/*` and `/.well-known/agent-skills/*`

Confirm Route53: `agents.sohopay.xyz` is an A/AAAA alias to the new CloudFront distribution.

## 4. Go-live checks

```bash
curl -fsSL -D- -o /dev/null https://agents.sohopay.xyz/skills/v1/setup.md
curl -fsSL -D- -o /dev/null https://agents.sohopay.xyz/skills/v1/setup-staging.md
curl -fsSL https://agents.sohopay.xyz/.well-known/agent-skills/index.json
```

Pass: HTTP 200, `content-type` markdown or JSON (not HTML), body non-empty, CORS `Access-Control-Allow-Origin: *`. Then from the skills repo root:

```bash
AGENTS_SKILLS_BASE_URL=https://agents.sohopay.xyz bash scripts/verify-bootstrap.sh
```

`sohopay-site` `/install` already curls this CDN first. No app-code change is required once the hostname answers.
