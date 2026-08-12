# Upstream compatibility

Verified on 12 August 2026.

| Upstream                              | Pinned commit                              | Used contract                                                                                                                       |
| ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Inntris/inntris-x402-policy-adapter` | `a3e28e155ffeb205d551ba8c4a97f7fbb812cfee` | action schema, decision schema, reason codes, JCS hashing, Ed25519 signing, fingerprinting, key registry and verification behaviour |
| `Inntris/inntris-verify`              | `f3e85242f8170fe96ca89d53b0442bcb37a5d92c` | JCS manifest, SHA-256 file inventory, Ed25519 manifest signature and pinned public key verification                                 |

The upstream decision packages are not published to npm. This repository therefore contains a small compatibility implementation derived from the pinned public source rather than an unpublished package dependency. `fixtures/x402/upstream` contains the pinned upstream golden action, decision and key registry. CI runs those vectors through the same verifier used for the Highnote card vector.

Important boundaries:

- `inntris-action-v1` uses the existing card rail. Highnote is identified in `extensions.provider`; it is not a new rail.
- The action and decision schema are strict discriminated unions for x402 and card.
- JCS uses `canonicalize` version `3.0.0`, matching the pinned upstream implementation.
- Decision and bundle signatures use Ed25519 through `tweetnacl` version `1.0.3`.
- The Highnote evidence bundle is marked `proposed-until-upstream-adoption`. This repository does not claim that the Highnote specific evidence schema has already been adopted upstream.

Before changing any shared field, canonicalisation rule, signature input or reason code, rerun both rail vectors and compare against the pinned upstream source.
