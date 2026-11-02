// The one paste that does the provider's side. Each prints plain errors, holds nothing of Vyre's, and says what to bring back. Nothing here runs on the server; the admin runs it in their own shell, under their own account.
export interface Data { mail: boolean; calendar: boolean; files: boolean }
const GOOGLE_APIS = { base: ["admin.googleapis.com"], mail: ["gmail.googleapis.com"], calendar: ["calendar-json.googleapis.com", "meet.googleapis.com"], files: ["drive.googleapis.com", "docs.googleapis.com", "sheets.googleapis.com"] };

export function googleScript(d: Data): string {
  const apis = [...GOOGLE_APIS.base, ...(d.mail ? GOOGLE_APIS.mail : []), ...(d.calendar ? GOOGLE_APIS.calendar : []), ...(d.files ? GOOGLE_APIS.files : [])];
  return [
    "# Paste into Google Cloud Shell. It makes a project for Vyre, turns on the APIs, and makes a service account with a key.",
    "set -u",
    'PROJECT="vyre-$(date +%s)"',
    'gcloud projects create "$PROJECT" --name="Vyre" || { echo "Google refused the new project. Ask for the Project Creator role, then run this again."; exit 1; }',
    'gcloud config set project "$PROJECT"',
    `gcloud services enable ${apis.join(" ")} || { echo "Google refused to turn on the APIs. Check you can administer project $PROJECT."; exit 1; }`,
    'gcloud iam service-accounts create vyre --display-name="Vyre"',
    'ACCOUNT="vyre@$PROJECT.iam.gserviceaccount.com"',
    "sleep 10",
    'if gcloud iam service-accounts keys create vyre-key.json --iam-account="$ACCOUNT" 2>key-error.txt; then',
    '  cloudshell download vyre-key.json || cat vyre-key.json',
    '  echo "Done. Drop vyre-key.json into Vyre, then delete it: rm vyre-key.json"',
    "else",
    '  if grep -q "not allowed" key-error.txt; then',
    '    echo "Your organization blocks service account keys. That is the default for organizations made since May 2024."',
    '    echo "Someone with the Organization Policy Administrator role opens this page and sets the rule to Not enforced for this project only:"',
    '    echo "https://console.cloud.google.com/iam-admin/orgpolicies/iam-disableServiceAccountKeyCreation?project=$PROJECT"',
    '    echo "Then run: gcloud iam service-accounts keys create vyre-key.json --iam-account=$ACCOUNT && cloudshell download vyre-key.json"',
    "  else cat key-error.txt; fi",
    "fi",
  ].join("\n");
}

export function microsoftScript(d: Data, redirect: string | undefined, permissions: readonly string[]): string {
  return [
    "# Paste into Azure Cloud Shell (Bash). It registers one app for Vyre in your tenant, for sign-in and for data, with a certificate.",
    "# You need the Application Administrator and Privileged Role Administrator roles, or Global Administrator.",
    "set -u",
    `APP=$(az ad app create --display-name "Vyre" --sign-in-audience AzureADMyOrg${redirect ? ` --web-redirect-uris "${redirect}"` : ""} --query appId -o tsv) || { echo "Microsoft refused the new app. Check your role."; exit 1; }`,
    'az ad sp create --id "$APP" >/dev/null',
    "GRAPH=00000003-0000-0000-c000-000000000000",
    `for NAME in ${permissions.join(" ")}; do`,
    '  ID=$(az ad sp show --id "$GRAPH" --query "appRoles[?value==\'$NAME\'].id" -o tsv)',
    '  az ad app permission add --id "$APP" --api "$GRAPH" --api-permissions "$ID=Role" 2>/dev/null',
    "done",
    "for NAME in openid email profile; do",
    '  ID=$(az ad sp show --id "$GRAPH" --query "oauth2PermissionScopes[?value==\'$NAME\'].id" -o tsv)',
    '  az ad app permission add --id "$APP" --api "$GRAPH" --api-permissions "$ID=Scope" 2>/dev/null',
    "done",
    'FILE=$(az ad app credential reset --id "$APP" --create-cert --display-name Vyre --years 2 --append --query fileWithCertAndPrivateKey -o tsv)',
    'PRINT=$(openssl x509 -in "$FILE" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)',
    'SECRET=$(az ad app credential reset --id "$APP" --display-name "Vyre sign-in" --years 2 --append --query password -o tsv)',
    'TENANT=$(az account show --query tenantId -o tsv)',
    `python3 - "$FILE" "$APP" "$TENANT" "$PRINT" "$SECRET" <<'PY'`,
    "import json, re, sys",
    "pem = open(sys.argv[1]).read()",
    "key = pem[pem.index('-----BEGIN PRIV'):pem.rindex('KEY-----') + 8]",
    "print(json.dumps({'clientId': sys.argv[2], 'tenantId': sys.argv[3], 'thumbprint': sys.argv[4], 'private_key': key, 'clientSecret': sys.argv[5]}))",
    "PY",
    'rm -f "$FILE"',
    'echo "Copy the line that starts with { into Vyre. It holds the private key: clear this shell afterwards."',
    ...(d.mail || d.calendar ? ['echo "Vyre gives you the next paste for Exchange. Mail and calendars are not granted here on purpose."'] : []),
  ].join("\n");
}
