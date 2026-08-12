# Threat model

## Scope and trust boundaries

Highnote is trusted for the request it signs and for card execution. Inntris is trusted for its organisation scoped mandate decision and the evidence it signs. A configured customer endpoint is a separate trust domain. The public internet, request sender before HMAC verification, deployment platform, dependency supply chain and evidence transport are untrusted.

| Threat                             | Mitigation in this reference                                                                                                     | Residual risk                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Forged Highnote request            | HMAC SHA-256 over exact raw bytes, strict signature decoding, constant time comparison, no policy evaluation before verification | Header encoding must be confirmed with Highnote; shared secret compromise defeats this control          |
| Stale signed request               | Configured age and future skew checks on `signatureTimestamp`                                                                    | Public docs do not prescribe the window; clock health is operational                                    |
| Exact replay                       | Highnote request ID plus canonical payload hash returns one stable logical result                                                | State is process local and lost on restart                                                              |
| Same ID with altered payload       | Payload hash conflict returns 409                                                                                                | Multi-instance coordination is not implemented                                                          |
| Policy snapshot staleness          | Snapshot is loaded and schema validated before listen; validity and version are checked                                          | There is no production refresh or revocation feed                                                       |
| Wrong organisation or agent        | Mandate determines organisation, principal and agent; evaluation exact binds those fields                                        | Incorrect snapshot provisioning remains possible                                                        |
| Cross-tenant mandate confusion     | Card references are unique in the snapshot and map to one mandate                                                                | Production tenant isolation and storage controls are deferred                                           |
| Compromised customer endpoint      | Deny wins composition, exact transaction ID and currency validation                                                              | A compromised endpoint can cause declines or approve its own side; it sees the forwarded signed payload |
| Customer endpoint timeout          | Short bounded timeout and explicit deny or advisory policy                                                                       | Deny can cause card declines; advisory weakens customer control                                         |
| Adapter outage                     | Highnote stand-in semantics are documented                                                                                       | Actual stand-in behaviour is external configuration and unverified here                                 |
| Accidental fail open               | Default downstream policy is deny and advisory mode requires an explicit setting                                                 | Highnote stand-in may still be configured to approve                                                    |
| Evidence tampering                 | JCS hashes, Ed25519 decision and bundle signatures, signed file manifest, deterministic tamper tests                             | A verifier that does not pin the public key proves internal consistency only                            |
| Signer compromise                  | Key ID, registry, fingerprint and revocation status are represented                                                              | Reference seed comes from environment configuration; managed custody and rotation are deferred          |
| Dependency compromise              | Exact versions, lock file, audit gate, minimal runtime image and pinned CI actions                                               | Registry or build infrastructure compromise remains possible; no reproducible build attestation yet     |
| Secret logging                     | Body and sensitive headers are redacted; success logs contain identifiers, hashes and verdict only                               | Platform level access logs and downstream systems need separate review                                  |
| Request flood or denial of service | Body size limit, strict parsing, bounded in-memory replay entries and fast local decision path                                   | No production edge rate limit, WAF, capacity test or DDoS validation                                    |
| Schema drift                       | Strict documented schemas fail closed and deterministic tests pin behaviour                                                      | Additive Highnote changes can cause declines until reviewed                                             |
| Malicious partial approval         | Same currency validation, lowest ceiling wins, terminal capability enforced                                                      | Merchant and network behaviour after partial approval remains outside Inntris                           |
| Evidence emission failure          | Work runs after the Highnote response and emits a failure metric and log                                                         | File output is not a durable queue and evidence can be lost                                             |

## Security invariants

1. Do not evaluate or forward an unauthenticated request.
2. Do not turn a block into an allow during composition.
3. Do not return a partial amount above any approved ceiling.
4. Do not claim that signed captured evidence independently proves a Highnote or card network fact.
5. Do not perform a live metadata lookup in the authorisation hot path.
6. Do not log secrets or raw payment payloads.
7. Do not treat an unpinned embedded public key as external trust.

## Production review triggers

Any shared replay store, mandate database, managed signer, external queue, customer endpoint, Highnote Live activation or change to fail-open behaviour requires a fresh threat model and deployment review.
