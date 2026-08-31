---
title: Privacy Policy
permalink: /privacy/
---

# Privacy Policy for Dispatch

**Effective 31 August 2026.**

Dispatch is an open-source plugin for [Obsidian](https://obsidian.md), published under the
MIT licence by Kai Mysliwiec. This policy explains what data Dispatch touches, where that
data goes, and what the developer can and cannot see.

## The short version

**Dispatch has no server.** There is no account to create, no backend to sign in to, and
no service operated by the developer. Everything Dispatch does happens on your own
computer, against files you already have. The developer receives no data from you of any
kind — not your notes, not your Google data, not usage statistics, not crash reports.

## What Dispatch is

Dispatch renders your Obsidian notes as project boards and launches command-line AI coding
agents from them. It reads and writes the markdown files in your own vault, and it runs
programs you have configured on your own machine. It does not transmit your notes anywhere.

## Google account data

One optional feature connects to Google. When you use Dispatch's meeting-transcript import,
a script running on your computer asks Google for permission to read meeting artifacts from
your Google Drive.

### What we request, and why

| Scope | What it grants | Why Dispatch asks |
| --- | --- | --- |
| `https://www.googleapis.com/auth/drive.meet.readonly` | Read-only access to the Google Drive files created by Google Meet — meeting transcripts and Gemini meeting notes | To find the transcript for a meeting by its title and date, and to download it into your vault |

This is a **read-only** scope, and it is the narrowest scope that covers the task. Dispatch
requests no permission to modify, create or delete anything in your Google Drive, and no
access to Drive files that Google Meet did not create.

### What the script does with it

1. Lists Drive files whose names match the meeting you asked about, by title and date.
2. Exports the matching document as Markdown.
3. Writes that Markdown into a folder inside your own Obsidian vault.

That is the entire flow. The content of your meetings is read from Google and written to
your disk. It is not sent anywhere else, and no copy is retained outside your vault.

### Where your credentials are stored

Your OAuth client ID, client secret and refresh token are stored in a plain file at
`~/.dispatch/google.json` on your own computer — outside your vault, so that they are never
picked up by Obsidian Sync, Google Drive, git, or any other sync mechanism that might carry
your vault to another machine or another person.

These credentials are transmitted only to Google's own OAuth and Drive endpoints, over
HTTPS, to obtain and use an access token. They are sent to no one else.

### What the developer receives

Nothing. The developer operates no server, collects no telemetry, and has no technical means
of accessing your Google account, your Drive files, your meeting content or your vault.

### Limited Use

Dispatch's use and transfer of information received from Google APIs to any other app will
adhere to the [Google API Services User Data
Policy](https://developers.google.com/terms/api-services-user-data-policy), including the
Limited Use requirements.

Concretely, and as a restatement of what the section above already describes: data obtained
through these scopes is used solely to provide the meeting-import feature you invoked. It is
not transferred to anyone, not used for advertising, not used to train any model, and not
read by any human other than you.

## Data Dispatch does not collect

- No analytics, telemetry or usage statistics.
- No crash or error reporting.
- No advertising identifiers, cookies or tracking of any kind.
- No account, email address or personal profile.
- No network requests at all, except the Google Drive calls described above and any made by
  the agent programs you yourself configure and launch.

## Third parties

Dispatch shares your data with no third party, because it sends your data to no one. The
only external service it contacts is Google, on your instruction, using your own
credentials.

Note that Dispatch launches command-line programs you configure — for example Claude Code or
Codex. Those programs are not part of Dispatch and are governed by their own terms and
privacy policies. What they send, and to whom, is between you and their providers.

## Retention and deletion

Because nothing is stored on a server, there is nothing for the developer to delete.

- **Downloaded meeting content** stays in your vault until you delete the files.
- **Your stored credentials** stay in `~/.dispatch/google.json` until you delete that file.
- **Dispatch's access to your Google account** can be revoked at any time at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Revoking
  takes effect immediately; the stored refresh token stops working, and Dispatch will report
  that re-authorisation is needed.

Deleting the plugin removes it entirely; the credential file is separate and should be
deleted by hand if you want it gone.

## Security

Credentials are stored unencrypted in a file in your home directory, protected by your
operating system's own file permissions and by whatever disk encryption you have enabled.
This is the same posture as most command-line developer tooling. Anyone with access to your
user account on your computer can read that file, so treat it as you would an SSH key.

## Children

Dispatch is a developer tool. It is not directed at children and collects no data from
anyone.

## Changes to this policy

Changes are published in this document with a new effective date. Because Dispatch is
open-source, every revision is visible in the project's public history.

## Contact

Kai Mysliwiec — kai@eightnine.de

Project: <https://github.com/kaimys/obsidian-dispatch>
