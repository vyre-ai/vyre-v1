# Connect Microsoft 365

This page goes with Connect your company in Settings, under Space. The screen shows one step at a time and links to the matching section here. Your Assistant can run the same steps in chat.

You will finish with Space-wide sign-in with Microsoft, your people matched to their accounts, and each person's Mail, Calendar and Files in Vyre with nothing for them to sign in to.

**Who you need.** Someone who can register apps and grant admin consent (Global Administrator, or Application Administrator with Privileged Role Administrator), and an Exchange Administrator for one step. On a small team that is one person.

**How long.** About 15 minutes, plus up to 2 hours for Exchange to apply the mailbox limit to a running app.

**What stays with you.** One app, registered in your own tenant, used only by your Space. Vyre runs no shared app, so no other company's Space can reach yours.

## Choose what to connect

Choose Mail, Calendar and Files. Each one is separate, and each decides what you grant later. You can change this after you connect.

| You choose | Granted in Entra | Assigned in Exchange, limited to your members |
|---|---|---|
| Mail | | `Application Mail.ReadWrite`, `Application Mail.Send` |
| Calendar | `OnlineMeetingRecording.Read.All`, `OnlineMeetingTranscript.Read.All` | `Application Calendars.ReadWrite` |
| Files | `Files.ReadWrite.All` | |
| Always | `User.Read.All` | |

Mail and Calendars are not granted in Entra on purpose. Granted there, an app reaches every mailbox in your tenant, and nothing in Exchange can narrow it. Assigned in Exchange, Microsoft itself refuses any mailbox outside the group you name.

## Register the app and add it

**The fast way.** You need an Azure subscription, because Azure Cloud Shell runs on one. Press **Open Azure Cloud Shell**, choose Bash, paste the script the step shows, and press Enter. It registers one app for your tenant, grants nothing yet, and makes a certificate. Copy the line that starts with `{`.

**By hand, with no Azure subscription.**

1. In the Microsoft Entra admin center, open **App registrations**, then **New registration**.
2. Name it Vyre. Choose **Accounts in this organizational directory only**.
3. Under **Redirect URI**, choose **Web** and paste the address the step shows. It ends in `/auth/sso/microsoft/callback`.
4. Press **Register**. Copy the **Application (client) ID** and the **Directory (tenant) ID** from the Overview page.
5. Open **API permissions**, **Add a permission**, **Microsoft Graph**, **Application permissions**, and add each permission from the Entra column above for what you chose. Under **Delegated permissions**, add `openid`, `email` and `profile`.
6. Open **Certificates and secrets**, **New client secret**. Copy its **Value**, not its ID. Microsoft shows it once.

Paste what the script printed, or the three values. Vyre puts them in the Vault and checks them at once by signing in to your tenant.

Microsoft recommends certificates, which is what the script makes. A secret lasts at most 24 months, so Vyre reminds you to rotate it at 20.

| What the step says | What to do |
|---|---|
| Microsoft did not accept the client secret | Paste the secret's Value, not its ID, or make a new one |
| That application is not in this tenant | Check the tenant ID, and that you copied the Application (client) ID |
| Microsoft has no such tenant | Copy the Directory (tenant) ID from the Overview page |
| Microsoft did not accept the certificate | Run the script again and paste what it prints |

## Grant admin consent

Press **Open the consent page** and sign in as an admin. The page lists what you chose. Press **Accept**. Back in Vyre, press **Check**.

## Limit the app to your members' mailboxes

Skip this if you chose neither Mail nor Calendar.

An Exchange Administrator opens Exchange Online PowerShell, runs `Connect-ExchangeOnline -Device`, and pastes the snippet the step shows. It works from any computer. Azure Cloud Shell works too, but Connect-ExchangeOnline is sometimes refused there; use your own PowerShell if it is.

The snippet makes a mail-enabled security group of your included members, and assigns the mail and calendar roles to the app against that group alone.

The last two lines test it: the first member should say InScope True, and someone not included should say False. Press **I ran it**.

Exchange takes between 30 minutes and 2 hours to apply this to a running app. The test lines show the result straight away.

**Files has no such limit.** `Files.ReadWrite.All` reaches every drive in your tenant, and Microsoft offers per-person limits only through a grant for each person. Vyre enforces the person on every call, as it does everywhere, but for Files that is the only enforcement. If you need Microsoft to enforce it too, leave Files off.

## Turn on sign-in

The app you registered also does sign-in. Press **Turn on sign-in** and type your domain, like `yourfirm.com`. If you registered the app by hand, your client secret is already in the Vault.

## Try the sign-in

Press **Sign in with Microsoft once**. A new window opens. Choose your work account. When it says to go back to Vyre, go back.

This proves the app works, and it ties your Vyre account to your Microsoft account by your tenant and Microsoft's permanent id for you, not by your address. The Space owner has to do this before anyone can require sign-in, so the owner can never be locked out.

It also matches you to that Microsoft account, so your own mail, calendar and files come in. Everyone else is matched the same way the first time they sign in with Microsoft, or by the address their invitation went to. An address already matched to someone else stays theirs.

## Decide if everyone must use it

This is optional. Turn on **Everyone must use it** and passwords stop working for sign-in.

Vyre refuses to turn this on until two things are true: the Space owner has signed in with Microsoft once, and the Space owner has saved a recovery key.

**If Microsoft is ever down**, the Space owner signs in with the recovery key, from **Forgot password** on the sign-in screen. That is the only way around the rule, it works only for the owner, and it is logged.

New people join from their invitation, and the first thing they do is sign in with Microsoft using the address the invitation went to.

## Run the read-only check

Press **Run the check**. Vyre reads your organization's name and whether one included mailbox answers. It reads no mail. You get one line, either that it works or exactly what is missing.

If Mail or Calendar was consented in Entra, the check says so. Remove it there, or the limit in Exchange does nothing.

## Choose who is in

Vyre matches people by email. Then you have three choices for each person.

- **Matched** people are already in the Space. Nothing to do.
- **Invite** the people in your directory who are not in the Space yet. Each invitation is a link you send yourself.
- **Exclude** anyone you want left out. Vyre never touches an excluded person's mail, calendar or files, and the exclusion holds however the directory changes.

Vyre does not take the next step for anyone until you press Connect.

## Connect

The step shows what will happen: how many people, and which of Mail, Calendar and Files. Press **Connect**.

Each person's Inbox and Calendar start filling within minutes. Their OneDrive appears in their Personal folder the first time they open Files. Nobody signs in to anything.

After this, Vyre checks your directory every six hours. A person deleted or turned off in Entra stops, their sessions end, and their next sign-in is refused. If a check looks wrong, say a quarter of your people seem gone at once, Vyre changes nothing and asks you.

**To undo**, press **Disconnect**. Every sync stops at once. What already came in stays with its owner. Sign-in stays as it is.

## What agents can do

An agent reaches a person's mail, calendar or files only when that person asked, and only that person's. It never reaches a teammate's mailbox, even though the app could.

Changing the connection or how people sign in always stops for a person with the right role, in every mode, even from a task or an automation. Sending mail as a person follows the same rule as any outward act.

The app's certificate or secret stays in the Vault. No agent can see it, use it or be given it.

**Connect your company, Access log** shows who reached which mailbox, and for whom.
