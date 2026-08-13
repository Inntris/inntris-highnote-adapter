# Inntris Highnote adapter

## What this is

A reference adapter for Highnote Collaborative Authorization in the Highnote Test environment. It demonstrates that Highnote can remain authoritative for card programme controls and execution while Inntris independently evaluates organisation scoped authority and signs portable evidence.

The adapter implements:

- exact raw body HMAC verification with constant time comparison
- configurable freshness enforcement and exact retry handling
- Highnote card request to `inntris-action-v1` binding with `rail: card` and `provider: highnote`
- pre-warmed mandate evaluation for `ALLOW`, `BLOCK` and `REQUIRE_APPROVAL`
- optional customer endpoint pass-through with deny preserving composition
- signed decisions and deterministic evidence bundles
- offline verification and shared x402 plus card verification vectors
- structured logs, Prometheus metrics, health endpoints, tests and a container build

## What this is not

- not a Highnote partnership
- not Highnote endorsed
- not a replacement for Highnote native controls
- not a production card authorisation service
- not an availability or service level commitment

Highnote Live enablement, a deployed Test transaction, multi-instance replay storage, managed signing, multi-region availability and production load testing are not proven by this repository.

## Architecture

```text
Highnote native controls
  -> Collaborative Authorization
  -> Inntris organisational authority
  -> optional customer authorisation endpoint
  -> deterministic deny preserving composition
  -> Highnote response
  -> asynchronous portable evidence emission
```

Highnote remains authoritative for the transaction facts it reports and for execution. Inntris is authoritative only for its organisational authority decision and the integrity of the evidence it signs.

## Two minute deterministic demo

Requires Node.js 22 or later.

```shell
npm ci
npm run check
npm run demo
npm run verify:evidence
```

The demo prints an Inntris `ALLOW`, `BLOCK`, `REQUIRE_APPROVAL` and exact retry result. The verifier prints each signature, hash, binding and validity check. No Highnote account, API, shared secret or network access is required.

Regenerate all golden vectors:

```shell
npm run fixtures:generate
```

Measure the local decision path:

```shell
npm run benchmark -- 200
```

The committed fixtures use public synthetic test keys only. Never reuse them outside this repository.

## Highnote Test setup

Follow [docs/HIGHNOTE_TEST.md](docs/HIGHNOTE_TEST.md). The Highnote Test simulator uses dummy data and may report merchant name and category without network merchant identifiers. The adapter labels those fallbacks explicitly as name and category references rather than presenting them as network identifiers.

Current public documentation does not state the signature header encoding or a required freshness window. Both are isolated configuration choices and listed in [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) for confirmation with Highnote.

## Evidence and verification

The evidence bundle classifies facts as:

- `self`: an Inntris assertion signed by Inntris
- `observed`: a property of the authenticated payload captured by the adapter
- `reported`: a Highnote supplied fact that Inntris does not independently prove
- `cryptographically_verified`: reserved for an external proof that was actually verified

The evidence pack signs the JCS canonical `manifest.json` and hashes every included file. It is compatible with the pinned `Inntris/inntris-verify` verifier. See [docs/OFFLINE_VERIFICATION.md](docs/OFFLINE_VERIFICATION.md).

## Pass-through composition

If `DOWNSTREAM_AUTHORIZATION_URL` is set, the original body and Highnote signature are forwarded to the customer endpoint. Inntris and downstream outcomes are composed with deny wins semantics. If both supply amount ceilings, the lower ceiling wins. The default downstream failure policy is deny.

Setting `DOWNSTREAM_FAILURE_POLICY=allow_inntris` makes downstream unavailability advisory and weakens enforcement. It does not make a malformed downstream answer advisory: a response the adapter cannot read as an authorisation always denies. See [docs/PASS_THROUGH.md](docs/PASS_THROUGH.md).

## Failure posture

Highnote applies its card product stand-in settings whenever this adapter returns a non-2xx response, so which failures produce a non-2xx status is a policy choice rather than an implementation detail.

Requests that cannot be proven to be fresh, authentic and well formed are rejected with a non-2xx status. There is nothing to decline against, and returning 200 to an unauthenticated caller would be wrong.

Once a request is authenticated and parsed, any later adapter failure is an authorisation outcome. `AUTHORIZATION_FAILURE_POLICY` decides how it reaches Highnote:

- `decline` (default) returns a 2xx `INVALID_TRANSACTION` decline, so a missing mandate, an idempotency conflict or an internal fault cannot be turned into an approval by a stand-in setting
- `stand_in` returns the underlying non-2xx status and hands the outcome to the Highnote card product configuration

Each failure is counted on `authorization_failure_total{code,policy}` and logged with the Highnote request ID.

## Runtime configuration

Copy `.env.example` into the secret and configuration system used by your deployment. Do not commit a populated environment file.

The process serves:

- `POST /v1/highnote/collaborative-authorization`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

The mandate snapshot is loaded and validated before the server listens. Runtime signing material is read from configuration for this reference implementation. A production design must replace that with managed key custody.

## Documentation

- [Highnote protocol notes](docs/HIGHNOTE_PROTOCOL.md)
- [Highnote Test runbook](docs/HIGHNOTE_TEST.md)
- [Open questions for Highnote](docs/OPEN_QUESTIONS.md)
- [Highnote outreach brief](docs/HIGHNOTE_OUTREACH_BRIEF.md)
- [Upstream compatibility](docs/UPSTREAM_COMPATIBILITY.md)
- [Offline verification](docs/OFFLINE_VERIFICATION.md)
- [Production readiness boundary](docs/PRODUCTION_READINESS.md)
- [Threat model](THREAT_MODEL.md)
- [Security policy](SECURITY.md)

## Licence

Apache 2.0. See [LICENSE](LICENSE).
