#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AgentsSkillsStack } from "../lib/agents-skills-stack";

/**
 * agents.sohopay.xyz — S3 + CloudFront skills CDN.
 *
 * ACM for CloudFront must be in us-east-1. Hosted zone sohopay.xyz is looked up
 * in the same account as the marketing site.
 *
 * If this account already has token.actions.githubusercontent.com (backend /
 * site stacks often do), pass the existing provider ARN:
 *
 *   npx cdk deploy -c sohopay:githubOidcProviderArn=arn:aws:iam::<account>:oidc-provider/token.actions.githubusercontent.com
 */
const app = new cdk.App();

new AgentsSkillsStack(app, "AgentsSkillsStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  domainName: "agents.sohopay.xyz",
  hostedZoneName: "sohopay.xyz",
  githubOidcProviderArn: app.node.tryGetContext(
    "sohopay:githubOidcProviderArn",
  ) as string | undefined,
});
