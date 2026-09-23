import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface AgentsSkillsStackProps extends cdk.StackProps {
  domainName: string;
  hostedZoneName: string;
  /** Import an existing GitHub OIDC provider instead of creating a second one. */
  githubOidcProviderArn?: string;
}

/**
 * Private S3 + CloudFront + Route53 for https://agents.sohopay.xyz/skills/v1/.
 * Content is published by sohopay/skills `.github/workflows/deploy.yml`.
 */
export class AgentsSkillsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentsSkillsStackProps) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.hostedZoneName,
    });

    const bucket = new s3.Bucket(this, "Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const cachePolicy = new cloudfront.CachePolicy(this, "CachePolicy", {
      comment: "300s default to match S3 Cache-Control on skill markdown",
      defaultTtl: Duration.seconds(300),
      maxTtl: Duration.seconds(300),
      minTtl: Duration.seconds(0),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "ResponseHeaders",
      {
        comment: "CORS + nosniff for agent fetchers and /install curl",
        corsBehavior: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: ["*"],
          accessControlAllowMethods: ["GET", "HEAD", "OPTIONS"],
          accessControlAllowOrigins: ["*"],
          originOverride: true,
        },
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
        },
        customHeadersBehavior: {
          customHeaders: [
            {
              header: "Cross-Origin-Resource-Policy",
              value: "cross-origin",
              override: true,
            },
          ],
        },
      },
    );

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "SohoPay agent skills CDN",
      domainNames: [props.domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy,
        responseHeadersPolicy,
        compress: true,
      },
    });

    new route53.ARecord(this, "AliasA", {
      zone: hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, "AliasAaaa", {
      zone: hostedZone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    const githubProvider = props.githubOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "GitHubOidcProvider",
          props.githubOidcProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
          url: "https://token.actions.githubusercontent.com",
          clientIds: ["sts.amazonaws.com"],
        });

    const deployRole = new iam.Role(this, "GitHubDeployRole", {
      roleName: "SohoPaySkillsGitHubDeployRole",
      description:
        "Assumed by GitHub Actions via OIDC to publish sohopay/skills to the agents CDN (main only)",
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(
        githubProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub":
              "repo:sohopay/skills:ref:refs/heads/main",
          },
        },
      ),
    });

    bucket.grantReadWrite(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );

    new cdk.CfnOutput(this, "AgentsSkillsBucket", {
      value: bucket.bucketName,
      description: "Set GitHub secret AGENTS_SKILLS_BUCKET",
    });
    new cdk.CfnOutput(this, "AgentsSkillsDistributionId", {
      value: distribution.distributionId,
      description: "Set GitHub secret AGENTS_SKILLS_CF_ID",
    });
    new cdk.CfnOutput(this, "AgentsSkillsDeployRoleArn", {
      value: deployRole.roleArn,
      description: "Set GitHub secret AWS_DEPLOY_ROLE_ARN",
    });
    new cdk.CfnOutput(this, "AgentsSkillsUrl", {
      value: `https://${props.domainName}/skills/v1/`,
    });
  }
}
