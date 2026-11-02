# Connect Google Workspace

This page goes with Connect your company in Settings, under Space. The screen shows one step at a time and links to the matching section here. Your Assistant can run the same steps in chat.

You will finish with Space-wide sign-in with Google, your people matched to their Google accounts, and each person's Mail, Calendar and Files in Vyre with nothing for them to sign in to.

**Who you need.** A Workspace super admin for one step, and someone who can create a Google Cloud project. On a small team that is one person.

**How long.** About 15 minutes, plus up to 24 hours if Google is slow to apply the scopes. It usually takes minutes.

**What stays with you.** Everything lives in your own Google Cloud project and your own Vault. Vyre runs no shared app, so no other company's Space can reach yours.

## Choose what to connect

Choose Mail, Calendar and Files. Each one is separate, and each decides which scopes you allow later. You can change this after you connect.

| You choose | Scopes Vyre asks for |
|---|---|
| Mail | `gmail.modify` |
| Calendar | `calendar`, `meetings.space.readonly` |
| Files | `drive`, `spreadsheets`, `documents` |
| Always | `admin.directory.user.readonly` |

The last scope reads your directory. Vyre uses it to match people and to notice when someone leaves.

## Make the service account and add its key

The service account is what reads each person's data for them, and only for them.

**The fast way.** Press **Open Google Cloud Shell**, paste the script the step shows, and press Enter. It makes a project, turns on the APIs you chose, and makes a service account and key. Your browser downloads `vyre-key.json`.

**By hand.**

1. Create a Google Cloud project named Vyre.
2. Under **APIs and services**, turn on Admin SDK API, plus Gmail API for Mail, Google Calendar API and Google Meet REST API for Calendar, and Google Drive API, Google Docs API and Google Sheets API for Files.
3. Under **IAM and admin**, open **Service accounts**, create one named Vyre, and give it no project role.
4. Open it, choose **Keys**, **Add key**, **Create new key**, **JSON**.

**If Google says key creation is not allowed.** Google blocks service account keys by default on organizations made since May 2024. Someone with the Organization Policy Administrator role opens the policy `iam.disableServiceAccountKeyCreation` for this project only and sets it to Not enforced. Leave the rest of your organization as it is.

Then drop the file on the step, or paste its contents. Vyre puts it in the Vault and checks it at once by signing with it and asking Google. Delete your copy afterwards.

| What the step says | What to do |
|---|---|
| The key is not valid JSON | Paste the whole file, from the first `{` to the last `}` |
| That is not a Google service-account key | You pasted a different kind of file. Make a JSON key for the service account |
| The private key in this file is damaged | Make a new JSON key and paste the whole file |
| Google does not recognise this key | It was deleted or replaced. Make a new JSON key |
| This service account is turned off | Open it in Google Cloud and choose Enable |

## Allow the scopes in Google Admin

A super admin does this. It lets the service account act for your people.

1. Press **Open Google Admin**. You land on **Security**, **Access and data control**, **API controls**, **Domain-wide delegation**.
2. Press **Add new**.
3. Copy the **Client ID** from the step. It is a long number. An email address here does not work.
4. Copy the **scopes** from the step and paste them as one line.
5. Press **Authorize**.
6. Back in Vyre, type the address of a Workspace admin and press **Check**.

Google can take up to 24 hours to apply this, and it usually takes minutes. The step says which scopes are still missing. You can leave and come back; Vyre remembers where you are.

## Make the sign-in app

Sign-in uses a small app in the Google Cloud project you just made. Set it to Internal, so only people in your Workspace can use it and Google asks for no review.

1. In Google Cloud, open **Google Auth Platform**, then **Branding**. Name the app Vyre and save. On the **Audience** page, choose **Internal**.
2. Open **Clients**, then **Create client**. Choose **Web application** and name it Vyre.
3. Under **Authorized redirect URIs**, paste the address the step shows. It ends in `/auth/sso/google/callback`.
4. Press **Create**, then copy the **Client ID** and the **Client secret** into the step.
5. Type your domain, like `yourfirm.com`.

Vyre puts the secret straight into your Vault in a Restricted folder. Neither Assistant nor any agent can read it.

## Try the sign-in

Press **Sign in with Google once**. A new window opens. Choose your work account. When it says to go back to Vyre, go back.

This proves the app works, and it ties your Vyre account to your Google account by Google's permanent id for you, not by your address. The Space owner has to do this before anyone can require sign-in, so the owner can never be locked out.

## Decide if everyone must use it

This is optional. Turn on **Everyone must use it** and passwords stop working for sign-in.

Vyre refuses to turn this on until two things are true: the Space owner has signed in with Google once, and the Space owner has saved a recovery key.

**If Google is ever down**, the Space owner signs in with the recovery key, from **Forgot password** on the sign-in screen. That is the only way around the rule, it works only for the owner, and it is logged.

New people join from their invitation, and the first thing they do is sign in with Google using the address the invitation went to.

## Run the read-only check

Press **Run the check**. Vyre asks Google for a token for each scope you chose and reads one profile. It reads no mail. You get one line, either that every scope is allowed or exactly which is missing.

## Choose who is in

Vyre matches people by email. Then you have three choices for each person.

- **Matched** people are already in the Space. Nothing to do.
- **Invite** the people in your directory who are not in the Space yet. Each invitation is a link you send yourself.
- **Exclude** anyone you want left out. Vyre never touches an excluded person's mail, calendar or files, and the exclusion holds however the directory changes.

Vyre does not take the next step for anyone until you press Connect.

## Connect

The step shows what will happen: how many people, and which of Mail, Calendar and Files. Press **Connect**.

Each person's Inbox and Calendar start filling within minutes. Their Drive appears in their Personal folder the first time they open Files. Nobody signs in to anything.

After this, Vyre checks your directory every six hours. A person deleted or suspended at Google stops, their sessions end, and their next sign-in is refused. If a check looks wrong, say a quarter of your people seem gone at once, Vyre changes nothing and asks you.

**To undo**, press **Disconnect**. Every sync stops at once. What already came in stays with its owner. Sign-in stays as it is.

## What agents can do

An agent reaches a person's mail, calendar or files only when that person asked, and only that person's. It never reaches a teammate's mailbox, even though the service account could. Google limits delegation by scope, not by person, so Vyre is what enforces this, on every call.

Changing the connection or how people sign in always stops for a person with the right role, in every mode, even from a task or an automation. Sending mail as a person follows the same rule as any outward act.

The service account key stays in the Vault. No agent can see it, use it or be given it.

**Connect your company, Access log** shows who reached which mailbox, and for whom.
