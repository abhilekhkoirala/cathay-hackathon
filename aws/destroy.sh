#!/usr/bin/env bash
# Deletes everything deploy.sh created (site, API, table, CloudFront). The SES identities you
# verified are left alone — remove them with: aws sesv2 delete-email-identity --email-identity <addr>
set -euo pipefail

STACK_NAME="${STACK_NAME:-aurelia-air}"
REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION"

command -v aws >/dev/null || { echo "AWS CLI not found" >&2; exit 1; }
command -v sam >/dev/null || { echo "SAM CLI not found" >&2; exit 1; }

printf "This permanently deletes stack '%s' in %s. Type the stack name to continue: " "$STACK_NAME" "$REGION"
read -r ANSWER
[ "$ANSWER" = "$STACK_NAME" ] || { echo "Cancelled."; exit 1; }

BUCKET="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text 2>/dev/null || true)"
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo "Emptying s3://$BUCKET (CloudFormation can't delete a bucket that still has files)..."
  aws s3 rm "s3://$BUCKET" --recursive --only-show-errors
fi

sam delete --stack-name "$STACK_NAME" --region "$REGION" --no-prompts
echo "Done. (SAM's shared 'aws-sam-cli-managed-default' bootstrap stack is kept; it costs nothing.)"
