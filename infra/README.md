# agents.sohopay.xyz CDK

`AgentsSkillsStack` — private S3, CloudFront (OAC), ACM, Route53, and a GitHub OIDC deploy role for `sohopay/skills` `main` and `develop`. Both branches publish the same `agents.sohopay.xyz` objects. If an existing role still trusts `main` only, update the assume-role policy with the AWS CLI in [MANUAL-BOOTSTRAP.md](./MANUAL-BOOTSTRAP.md#5-allow-develop-branch-deploys-aws-cli).

Operator steps (deploy, GitHub secrets, first publish, go-live curls): [MANUAL-BOOTSTRAP.md](./MANUAL-BOOTSTRAP.md).
