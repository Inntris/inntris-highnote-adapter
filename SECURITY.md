# Security policy

## Reporting

Do not open a public issue for a suspected vulnerability or exposed credential. Contact the Inntris security owner through the private channel listed in the Inntris organisation profile and include the affected commit, impact, reproduction steps and whether any secret may have been exposed.

Do not include real Highnote endpoint secrets, signing seeds, card data, API keys or customer payloads in a report, fixture, pull request or chat.

## Supported scope

The current repository is a Highnote Test reference artifact. Security fixes apply to the latest default branch. No production availability or incident response commitment is made by this repository.

## Handling rules

- Use only dummy Highnote Test data.
- Store endpoint secrets and signing material in an approved secret manager.
- Publish only the derived Inntris public key.
- Rotate any secret that may have entered logs, shell history, chat, source control or synced storage.
- Pin the public verification key outside the evidence pack.
- Never enable secret-backed CI for untrusted pull request code.
