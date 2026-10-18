# agents.sohopay.xyz CDK

`AgentsSkillsStack` — private S3, CloudFront (OAC), ACM, Route53, and a GitHub OIDC deploy role for `sohopay/skills` `develop`. Only `develop` publishes `agents.sohopay.xyz`. If the live role still trusts `main`, update the assume-role policy with the AWS CLI in [MANUAL-BOOTSTRAP.md](./MANUAL-BOOTSTRAP.md#5-restrict-oidc-trust-to-develop-aws-cli).

Operator steps (deploy, GitHub secrets, first publish, go-live curls): [MANUAL-BOOTSTRAP.md](./MANUAL-BOOTSTRAP.md).
