# Fixtures

All fixture identities, endpoint signatures, signing keys, card references and transaction references are synthetic. The test signing seed is public test material and must never be reused outside this repository.

Run `npm run fixtures:generate` to reproduce the allow, block, approval, replay and tamper cases. The generated `allow/evidence-pack.zip` can be checked with the pinned `inntris-verify` release as documented in `docs/OFFLINE_VERIFICATION.md`.
