# Bootstrap the SohoPay skills CDN

One-time operator steps. After this, a push to `main` or `develop` (or **Deploy agent skills** `workflow_dispatch` on either branch) publishes `https://agents.sohopay.xyz/skills/v1/`. Both branches write the same objects; the last successful deploy wins.

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

The OIDC trust on `SohoPaySkillsGitHubDeployRole` allows only:

- `repo:sohopay/skills:ref:refs/heads/main`
- `repo:sohopay/skills:ref:refs/heads/develop`

If the live role was created when trust was `main` only, update it with the AWS CLI in [Allow `develop` branch deploys](#5-allow-develop-branch-deploys-aws-cli) before the first `develop` publish. Do not run that CLI update and a later `cdk deploy` with a different trust shape; the stack in `lib/agents-skills-stack.ts` is the source of truth.

Until the secrets exist, `.github/workflows/deploy.yml` preflight skips publish (validate still runs). After they exist, a failed sync **fails** the job.

## 3. First publish

Run **Deploy agent skills** (`workflow_dispatch`) on `main` or `develop`, or merge to either branch. The workflow:

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

## 5. Allow `develop` branch deploys (AWS CLI)

Required once if the role already exists with `main`-only trust. This is the only AWS change: `iam:UpdateAssumeRolePolicy` on `SohoPaySkillsGitHubDeployRole`. S3, CloudFront, Route53, ACM, the GitHub OIDC provider, and GitHub Actions secrets stay as they are.

Use credentials for the account that owns the skills stack (`iam:GetRole` and `iam:UpdateAssumeRolePolicy` on that role).

```bash
ROLE_NAME=SohoPaySkillsGitHubDeployRole

aws iam get-role --role-name "$ROLE_NAME" \
  --query 'Role.AssumeRolePolicyDocument' --output json > /tmp/skills-deploy-trust-before.json

OIDC_PROVIDER_ARN="$(aws iam get-role --role-name "$ROLE_NAME" \
  --query 'Role.AssumeRolePolicyDocument.Statement[0].Principal.Federated' --output text)"

cat > /tmp/skills-deploy-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_PROVIDER_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "ForAnyValue:StringEquals": {
          "token.actions.githubusercontent.com:sub": [
            "repo:sohopay/skills:ref:refs/heads/main",
            "repo:sohopay/skills:ref:refs/heads/develop"
          ]
        }
      }
    }
  ]
}
EOF

aws iam update-assume-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-document file:///tmp/skills-deploy-trust.json

aws iam update-role \
  --role-name "$ROLE_NAME" \
  --description "Assumed by GitHub Actions via OIDC to publish sohopay/skills to the agents CDN (main and develop)"

aws iam get-role --role-name "$ROLE_NAME" \
  --query 'Role.AssumeRolePolicyDocument' --output json
```

If the live policy has more than one `Statement`, merge by hand: add the `develop` subject on the GitHub OIDC statement only.

Confirm `refs/heads/develop` is listed under `ForAnyValue:StringEquals` → `token.actions.githubusercontent.com:sub`. Then dispatch **Deploy agent skills** on `develop` (or push to `develop`) and re-run the go-live curls in section 4.
