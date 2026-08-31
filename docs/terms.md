---
title: Terms of Service
permalink: /terms/
---

# Terms of Service for Dispatch

**Effective 31 August 2026.**

These terms cover Dispatch, an open-source plugin for [Obsidian](https://obsidian.md) and
its accompanying scripts, published by Kai Mysliwiec at
<https://github.com/kaimys/obsidian-dispatch>.

By installing or using Dispatch, you agree to these terms. If you do not agree, do not
install it.

## 1. What Dispatch is, and what it is not

Dispatch is **software you run on your own computer**. It is not a hosted service. There is
no account, no subscription, no server operated by the developer, and no data of yours held
anywhere by the developer.

Dispatch is provided free of charge under the [MIT
licence](https://github.com/kaimys/obsidian-dispatch/blob/main/LICENSE). Those licence terms
govern your rights to use, copy, modify and redistribute the software; these terms cover
your use of it.

## 2. Your responsibilities

- **Your Google account.** If you enable the meeting-import feature, you authorise Dispatch
  to read meeting artifacts from your own Google Drive using your own credentials. You are
  responsible for keeping those credentials secure, for having the right to access the
  content you import, and for complying with [Google's Terms of
  Service](https://policies.google.com/terms).
- **Your recordings.** Recording and transcribing meetings is regulated in many
  jurisdictions and often requires the consent of the participants. Dispatch imports
  transcripts that Google Meet has already produced; obtaining consent to produce them is
  yours to handle, not Dispatch's.
- **Your data.** Dispatch writes to the markdown files in your vault, including moving
  cards, rewriting frontmatter and adding downloaded content. Keep backups. Use version
  control. The developer cannot recover anything for you.
- **Your commands.** See section 3.

## 3. Dispatch launches programs you configure

This is the central thing to understand before using Dispatch.

Dispatch's "chips" and board automations **execute command-line programs on your computer**
using command templates that you supply in your own device-local configuration. Dispatch
does not ship, endorse or vet those programs; it starts them, passes them the arguments you
configured, and observes that they ran.

You are solely responsible for what you configure Dispatch to run and for everything those
programs do — including any file they change, any command they execute, any cost they incur
and any data they transmit. AI coding agents in particular act with your permissions and can
modify or delete your files.

Dispatch is designed so that commands and filesystem paths live only in device-local
configuration and never in synced notes, precisely so that a shared note cannot cause someone
else's machine to run something. Do not defeat that boundary.

## 4. Third-party services

Dispatch interoperates with services operated by others — Google, GitHub, Anthropic, OpenAI
and whatever else you point it at. Those services are governed by their own terms and
policies. The developer is not a party to your relationship with them, is not responsible
for their availability, and cannot help you with their accounts.

## 5. No warranty

Dispatch is provided **"as is", without warranty of any kind**, express or implied,
including but not limited to the warranties of merchantability, fitness for a particular
purpose and non-infringement.

The developer does not warrant that Dispatch will be uninterrupted, error-free, compatible
with any particular version of Obsidian or of any third-party service, or that it will
preserve your data. It is a hobby project maintained at the developer's discretion.

## 6. Limitation of liability

To the fullest extent permitted by applicable law, the developer shall not be liable for any
claim, damages or other liability — whether in contract, tort or otherwise — arising from or
in connection with Dispatch or its use, including any loss of data, loss of work, corruption
of files, or costs incurred by programs Dispatch launched.

Nothing in these terms excludes or limits liability for intent or gross negligence, for
injury to life, body or health, or any other liability that cannot be excluded under
mandatory applicable law.

## 7. Availability and changes to the software

The developer may change, break, or stop developing Dispatch at any time, without notice and
without obligation. Because it is open-source and MIT-licensed, you may always continue to
use, fork and maintain the version you have.

## 8. Changes to these terms

These terms may be revised. Revisions are published in this document with a new effective
date, and every revision is visible in the project's public history. Continued use after a
change constitutes acceptance of it.

## 9. Governing law

These terms are governed by the law of the Federal Republic of Germany, excluding its
conflict-of-law rules and excluding the UN Convention on Contracts for the International Sale
of Goods. Where you are a consumer, this choice of law does not deprive you of the protection
of mandatory provisions of the law of your country of habitual residence.

## 10. Severability

If any provision of these terms is found unenforceable, the remaining provisions stay in
full effect.

## Contact

Kai Mysliwiec — kai@eightnine.de

Project: <https://github.com/kaimys/obsidian-dispatch>
