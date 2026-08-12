# AGENTS.md — Inntris Highnote Adapter

## Mission

Build a **reference Highnote rail adapter** that demonstrates that Highnote card authorization and Inntris organizational authority can coexist without Inntris replacing Highnote's native payment controls.

The artifact must prove the following:

> Highnote controls its card program, spend rules, velocity controls, balance checks, and payment execution. Inntris independently evaluates the organization's own mandate and produces portable evidence that can be verified outside Highnote, Visa, and Inntris.

The primary output is **not** a new card authorization engine.

The primary output is:

1. a Highnote Test-environment Collaborative Authorization integration;
2. deterministic ALLOW and BLOCK paths;
3. optional pass-through composition with a customer's existing authorization endpoint;
4. a cross-rail Inntris evidence bundle compatible with the same verification model used for x402;
5. offline verification through `inntris-verify`.

This repository is a **reference adapter and sandbox artifact**, not a production card-authorization service.

---

# Repository role

Repository:

```text
Inntris/inntris-highnote-adapter
```

This repo owns only Highnote-specific adapter concerns:

- Highnote Collaborative Authorization request handling;
- Highnote request authenticity/freshness validation;
- Highnote Test-environment integration;
- Highnote request → Inntris action binding;
- ALLOW/BLOCK mapping;
- idempotency/replay handling;
- pass-through proxy composition;
- Highnote-specific fixtures;
- evidence-bundle emission;
- demo/sandbox documentation;
- Highnote-specific threat model.

It must **not** become a second Inntris core.

---

# External repositories

Before implementing shared formats or cryptographic logic, inspect:

```text
Inntris/inntris-x402-policy-adapter
Inntris/inntris-verify
```

Use the current released or pinned implementation as the source of truth for:

- `InntrisActionV1`;
- decision-envelope semantics;
- RFC 8785 / JCS canonicalization;
- SHA-256 hashing conventions;
- Ed25519 signing and verification;
- action binding;
- decision fingerprinting;
- replay/consume-once semantics;
- policy hashes;
- test-vector conventions;
- evidence verification.

Do not invent parallel canonicalization, hashing, decision, or signature formats.

If a shared package is not directly consumable from this repository, pin the exact upstream commit used and keep compatibility code small and explicit.

Do not silently fork shared protocol logic.

---

# Strategic boundary

## Highnote already owns

Do not reproduce:

- card issuance;
- tokenization;
- card network messaging;
- account balances;
- spend rules;
- velocity controls;
- merchant/category controls;
- Highnote's native authorization logic;
- ledger;
- clearing;
- settlement;
- disputes;
- chargebacks;
- refunds;
- financial-account functionality.

If a proposed implementation starts rebuilding these capabilities, stop.

## Inntris owns

Inntris adds:

- organization-scoped policy;
- organization → principal → agent → mandate provenance;
- policy-version binding;
- exact-action binding;
- delegated-authority evaluation;
- an independent ALLOW/BLOCK decision;
- cryptographically signed decision evidence;
- cross-rail evidence representation;
- offline third-party verification.

The key trust-boundary statement is:

> Highnote remains authoritative for what Highnote reports and executes. Inntris is authoritative only for the organizational authority decision and for the integrity of the evidence it signs.

Never claim Inntris independently proves a Highnote or Visa network fact unless a third-party cryptographic proof was actually verified.

---

# Phase 1 scope

Build **Track B first**.

Do not build the full notification-ingestion/lifecycle platform in this repo.

The first artifact is:

```text
Highnote Test environment
        ↓
Collaborative Authorization request
        ↓
Inntris Highnote adapter
        ↓
Inntris organizational decision
        ↓
ALLOW or BLOCK
        ↓
Highnote simulated outcome
        ↓
Inntris evidence bundle
        ↓
inntris-verify
        ↓
offline PASS / FAIL
```

The cross-rail demonstration should intentionally mirror the existing x402 ALLOW/BLOCK fixture pattern.

The target claim is:

> Two materially different payment rails can produce the same organization-scoped Inntris authority evidence and be verified by the same independent verifier.

---

# Phase 1 non-goals

Do not build:

- production Highnote deployment posture;
- a full Highnote transaction synchronizer;
- long-running notification ingestion;
- lifecycle backfill/reconciliation;
- Base anchoring per Highnote event;
- clearing/reversal/refund lifecycle assembly;
- card issuance workflows;
- Highnote spend-rule configuration;
- a Highnote replacement authorization engine;
- a generic enterprise control plane;
- a separate Highnote policy language;
- a new rail identifier named `highnote`.

Highnote remains:

```text
rail = "card"
provider = "highnote"
```

---

# Required architecture

## Request flow

The Highnote Collaborative Authorization flow must be represented accurately:

```text
Highnote native checks
        ↓
Collaborative Authorization request
        ↓
Inntris adapter
        ↓
evaluate organization mandate
        ↓
optional downstream customer authorization logic
        ↓
compose decision
        ↓
Highnote
```

Inntris is not conceptually placed before Highnote's own built-in authorization checks.

---

# Pass-through proxy mode

Treat pass-through mode as a first-class capability.

Reason:

Highnote allows only one active Collaborative Authorization endpoint. A serious customer may already use that endpoint for its own business logic.

Inntris must therefore be able to wrap, rather than displace, the customer's existing endpoint.

Reference composition:

```text
Highnote
   ↓
Inntris adapter
   ├── Inntris organizational mandate decision
   └── customer's existing authorization endpoint
             ↓
      deterministic composition
             ↓
          Highnote
```

Composition rules:

1. **DENY always wins.**
2. Inntris must never broaden the customer's existing decision.
3. If both sides return an authorized amount, the lower amount wins.
4. A malformed downstream response must not silently become an allow.
5. A downstream timeout must follow an explicitly documented fail policy.
6. Idempotent retries of the same Highnote request must return a consistent logical result.

Implement composition as a pure, independently tested function.

---

# Hot-path design

Collaborative Authorization is a latency-sensitive path.

Design the hot path so it does not require:

- Base RPC;
- blockchain reads;
- PostgreSQL reads;
- non-essential Redis reads;
- remote policy fetching;
- synchronous evidence anchoring;
- any outbound HTTP call other than the optional customer pass-through endpoint.

Expected hot path:

```text
receive request
→ validate structure
→ validate request authenticity
→ validate freshness
→ resolve pre-warmed mandate/policy snapshot
→ construct canonical Inntris action
→ evaluate
→ sign decision
→ optionally call downstream customer endpoint
→ compose result
→ return Highnote response
→ enqueue non-critical persistence/evidence work
```

Do not put slow evidence work before the response.

For demo/testing, measure latency and print:

- p50;
- p95;
- p99;
- maximum.

Do not claim a production SLO.

---

# Deployment boundary

The adapter must be deployable independently from the Inntris core API.

Design assumptions:

```text
region: US-East preferred for Highnote authorization path
deployment: isolated service
state: minimal on hot path
```

Do not hard-code Railway-specific assumptions into application logic.

Deployment configuration must remain provider-agnostic.

The README must explicitly say:

> This repository demonstrates the integration in Highnote's Test environment. It is not a production card-authorization availability commitment.

---

# Highnote request verification

Before implementation, verify from current Highnote documentation:

1. exact signing/HMAC construction for Collaborative Authorization requests;
2. location and meaning of `signatureTimestamp`;
3. freshness window requirements;
4. whether request retries reuse the same `collaborativeAuthorizationRequest.id`;
5. exact response schema;
6. timeout behaviour;
7. stand-in behaviour;
8. whether all required card/entity identifiers needed for mandate lookup are present in the request;
9. whether Highnote custom metadata is present in the request or requires a separate API call.

Do not guess any of these.

If public documentation is ambiguous, isolate the uncertainty behind a small interface and document it in `docs/OPEN_QUESTIONS.md`.

---

# Mandate lookup

The hot path must resolve:

```text
organization
principal
agent
mandate
policy version
approver / approval state
Highnote entity reference
```

without requiring a live Highnote API call.

Use a pre-warmed snapshot or deterministic in-memory fixture for Phase 1.

The adapter should be designed so production could refresh this snapshot asynchronously.

Do not fetch Highnote metadata synchronously inside the authorization request unless unavoidable and explicitly justified.

---

# Highnote → Inntris action binding

Map Highnote into the existing card rail.

Do not add:

```text
rail = "highnote"
```

Use:

```text
rail = "card"
provider = "highnote"
```

Bind, where available:

- Highnote collaborative authorization request id;
- Highnote transaction id;
- payment-card reference;
- merchant identifier;
- merchant category;
- amount;
- currency;
- network;
- organization;
- principal;
- agent;
- purpose;
- mandate id;
- policy hash/version.

Hash sensitive credential/card references rather than storing secrets or PAN-like values.

Never log:

- API keys;
- shared secrets;
- target keys;
- card secrets;
- raw payment credentials;
- full PAN data;
- private signing keys.

---

# Decision semantics

Map Inntris outcomes into the Highnote authorization contract.

Required Phase 1 cases:

## ALLOW

```text
Highnote native checks pass
→ Inntris mandate is valid
→ policy allows exact action
→ adapter returns approved response
→ signed Inntris decision emitted
```

## BLOCK

```text
Highnote native checks pass
→ transaction violates organization mandate/policy
→ adapter returns decline
→ no Inntris fallback allow
→ signed Inntris BLOCK decision emitted
```

## REQUIRE_APPROVAL

A card authorization request cannot wait for a human approval workflow.

For Phase 1:

```text
REQUIRE_APPROVAL
→ decline current attempt
→ retain evidence that approval was required
```

A future retry after human approval must be treated as a new current policy evaluation, not as reuse of the old decision.

---

# Idempotency and replay

Treat:

```text
collaborativeAuthorizationRequest.id
```

as a stable request identity if current docs confirm this behaviour.

Requirements:

- duplicate delivery of the same logical request must not create multiple independent decisions;
- a retry must return the original logical result when safe;
- a different request may not reuse a consumed decision;
- freshness validation must reject stale requests;
- replay attempts must be surfaced in logs/metrics.

Add explicit fixtures for:

- exact retry;
- stale retry;
- altered payload with same request id;
- duplicate request after final response;
- mismatched amount;
- mismatched merchant.

---

# Evidence model

Do not silently mutate `InntrisDecisionV1` into a mutable payment-lifecycle object.

The decision remains immutable.

Use a separate wrapper concept:

```text
InntrisEvidenceBundleV1
```

The bundle contains:

```text
authority decision
+
execution reference
+
external observations
+
attestation metadata
+
verification material
```

The precise canonical schema may currently live upstream. Do not independently redefine shared schema semantics in this repository.

If upstream has not yet introduced `InntrisEvidenceBundleV1`, implement the adapter behind a small compatibility interface and add fixtures that clearly identify the proposed fields.

---

# Attestation classes

External execution evidence must declare how each fact is known.

Minimum semantic classes:

```text
self
cryptographically_verified
reported
observed
```

Meanings:

## `self`

Inntris itself asserted and signed the fact.

## `cryptographically_verified`

Inntris verified a third-party cryptographic assertion against an explicit trust root.

## `reported`

An external provider reported the fact. Inntris preserves the report and proves the captured evidence has not changed, but does not independently prove the underlying event.

## `observed`

Inntris directly observed an external state or response but is not the authoritative issuer of that fact.

Example:

```text
Inntris decision:              self
Highnote request payload:      reported
Captured payload integrity:    self
Verified third-party proof:    cryptographically_verified
```

Never display:

```text
✓ Highnote settlement verified
```

unless the adapter actually verifies an authoritative third-party settlement proof.

Prefer wording such as:

```text
Highnote authorization reference — as reported by Highnote
Captured payload integrity — verified
```

---

# Evidence bundle minimum contents

A Phase 1 bundle should be able to carry:

```text
organization id
principal id
agent id
mandate id
policy hash/version
decision id
ALLOW/BLOCK verdict
decision timestamp
exact action hash
rail = card
provider = highnote
Highnote collaborative request id
Highnote transaction/reference ids if present
amount/currency
merchant reference
Highnote source payload hash
attestation class
Inntris signature
Inntris public-key identifier
```

The bundle must not contain payment secrets.

---

# Offline verification

The resulting bundle must be verifiable without:

- a Highnote account;
- a Highnote API call;
- a Highnote shared secret;
- an Inntris API call;
- network connectivity.

Expected user experience:

```text
copy evidence bundle to another machine
disconnect internet
run inntris-verify
receive deterministic PASS or FAIL
```

The verifier must explicitly distinguish:

```text
what Inntris proves
what Inntris only preserves
what remains a Highnote/Visa claim
```

---

# Fixtures

Create at minimum:

```text
fixtures/
├── allow/
│   ├── request.json
│   ├── policy.json
│   ├── response.json
│   └── evidence.json
│
├── block/
│   ├── request.json
│   ├── policy.json
│   ├── response.json
│   └── evidence.json
│
├── replay/
│   ├── duplicate-request.json
│   ├── stale-request.json
│   └── altered-payload-same-id.json
│
└── tamper/
    ├── changed-amount.json
    ├── changed-merchant.json
    ├── changed-policy-hash.json
    └── changed-highnote-reference.json
```

The fixtures must be deterministic.

No current timestamps in committed golden vectors unless fixed.

No random IDs in golden vectors.

---

# Required tests

At minimum:

### Request handling

- valid Highnote request accepted;
- invalid authenticity rejected;
- stale signature timestamp rejected;
- malformed request rejected;
- missing required identity rejected.

### Policy

- valid mandate → ALLOW;
- amount above organizational limit → BLOCK;
- unapproved merchant → BLOCK;
- expired mandate → BLOCK;
- wrong agent → BLOCK;
- policy version mismatch → BLOCK;
- REQUIRE_APPROVAL → decline current card attempt.

### Pass-through

- Inntris ALLOW + downstream ALLOW → ALLOW;
- Inntris BLOCK + downstream ALLOW → BLOCK;
- Inntris ALLOW + downstream BLOCK → BLOCK;
- both return amount ceilings → lower amount wins;
- malformed downstream response → fail according to explicit policy;
- downstream timeout → explicit configured behaviour.

### Replay/idempotency

- same request id + same payload → stable logical result;
- same request id + altered payload → reject;
- stale replay → reject.

### Evidence

- original bundle verifies;
- changed amount fails;
- changed merchant fails;
- changed action hash fails;
- changed policy hash fails;
- changed Highnote reference fails;
- changed signature fails;
- offline verification succeeds with no network.

### Cross-rail compatibility

Where practical, run at least one x402 golden vector and one Highnote golden vector through the same verifier contract.

---

# Metrics and logs

Expose or log:

```text
requests_total{result}
decision_latency_ms
highnote_request_verification_total{result}
policy_decision_total{verdict}
replay_attempt_total
downstream_proxy_total{result}
downstream_latency_ms
evidence_emit_total{result}
```

Structured logs should include:

- request id;
- decision id;
- action hash;
- verdict;
- latency;
- replay/freshness outcome;
- downstream outcome.

Do not log secrets.

---

# Threat model

Create `THREAT_MODEL.md`.

Cover at least:

1. forged Highnote request;
2. stale signed request;
3. replay;
4. same request id with altered payload;
5. policy snapshot staleness;
6. wrong organization/agent binding;
7. downstream customer endpoint compromise;
8. downstream endpoint timeout;
9. adapter outage;
10. fail-open / fail-closed configuration;
11. evidence tampering;
12. signer compromise;
13. dependency compromise;
14. accidental logging of payment secrets;
15. request flood / denial of service;
16. cross-tenant mandate confusion.

State mitigations and residual risk.

---

# Stand-in posture

Do not hide Highnote stand-in semantics.

Document:

- fail-open makes Inntris advisory;
- fail-closed can turn an Inntris outage into card declines.

For the reference artifact, recommend fail-closed when Inntris is represented as an enforcement control.

Do not claim this recommendation is appropriate for every production customer.

Production availability design is outside Phase 1.

---

# README requirements

The README must contain:

## What this is

A reference adapter for Highnote Collaborative Authorization in the Highnote Test environment.

## What this is not

- not a Highnote partnership;
- not Highnote-endorsed;
- not a replacement for Highnote's native controls;
- not a production card-authorization service;
- not an availability/SLA commitment.

## Architecture

Show:

```text
Highnote native controls
→ Collaborative Authorization
→ Inntris organizational authority
→ optional customer authorization
→ deterministic composition
→ Highnote
→ portable Inntris evidence
→ offline verifier
```

## Demo

One command path for:

```text
ALLOW
BLOCK
offline verify
```

## Trust boundary

Clearly state:

> Highnote remains authoritative for Highnote transaction facts. Inntris proves its own organizational decision and the integrity of external evidence captured into the bundle.

Do not use Highnote branding in a way that implies endorsement.

---

# Security and GitHub hygiene

Before adding any workflow that handles secrets:

- do not use untrusted PR code with privileged secrets;
- avoid unsafe `pull_request_target` patterns;
- pin third-party GitHub Actions by full commit SHA where practical;
- use least-privilege workflow permissions;
- do not expose Highnote Test credentials to forked PRs;
- separate secret-backed integration tests from ordinary PR CI.

Public CI must still run all deterministic fixture/unit tests without secrets.

Secret-backed Highnote Test runs should be explicitly gated.

---

# Implementation order

Execute in this order.

## Step 1 — repository scaffold

Add:

```text
package.json
tsconfig.json
eslint config
formatter config
src/
test/
fixtures/
docs/
THREAT_MODEL.md
```

Prefer TypeScript unless an upstream constraint requires otherwise.

## Step 2 — inspect upstream Inntris contracts

Inspect current:

```text
Inntris/inntris-x402-policy-adapter
Inntris/inntris-verify
```

Document the pinned commit/tag in:

```text
docs/UPSTREAM_COMPATIBILITY.md
```

## Step 3 — Highnote request schemas

Implement strict request/response schemas from current Highnote documentation.

No guessed optional fields.

## Step 4 — authenticity/freshness verification

Implement request verification exactly to documented Highnote semantics.

Add deterministic tests.

## Step 5 — Highnote card → Inntris action adapter

Produce canonical `rail = card`, `provider = highnote` action bindings.

## Step 6 — mandate snapshot

Implement deterministic in-memory/pre-warmed mandate lookup for Test/demo.

No live DB requirement.

## Step 7 — ALLOW

Implement one valid test transaction path.

## Step 8 — BLOCK

Implement one transaction that Highnote native controls can otherwise process but organizational policy rejects.

This is the key demo case.

## Step 9 — idempotency/replay

Implement exact retry, stale request, and altered-payload rejection.

## Step 10 — pass-through proxy

Implement downstream customer endpoint composition with DENY-wins semantics.

## Step 11 — evidence bundle

Emit portable Inntris evidence with explicit attestation classes.

## Step 12 — verifier compatibility

Make the bundle verifiable with `inntris-verify`.

No Highnote credentials required for verification.

## Step 13 — sandbox integration

Register the endpoint in Highnote Test and exercise simulated ALLOW and BLOCK authorization paths.

Record exact setup steps in:

```text
docs/HIGHNOTE_TEST.md
```

## Step 14 — latency measurement

Benchmark the local and deployed Test path.

Report measurements as measurements, not guarantees.

## Step 15 — CI and security review

Run:

- formatting;
- lint;
- typecheck;
- unit tests;
- deterministic integration tests;
- dependency audit;
- secret scanning where available.

Review GitHub workflow threat boundaries before adding secret-backed Highnote Test automation.

---

# Definition of done

Phase 1 is complete only when all of the following are true:

1. A Highnote Test Collaborative Authorization request can reach the adapter.
2. A valid organizational mandate produces ALLOW.
3. A transaction that violates organizational policy produces BLOCK.
4. The adapter does not reproduce Highnote spend/velocity/card controls.
5. Replay/freshness/idempotency behaviour is explicitly tested.
6. Pass-through composition is implemented and deny-preserving.
7. Both ALLOW and BLOCK produce deterministic evidence bundles.
8. The bundle distinguishes Inntris assertions from Highnote-reported facts.
9. The evidence bundle verifies offline with no Highnote or Inntris API access.
10. Tampering with protected evidence produces FAIL.
11. The README does not imply partnership or endorsement.
12. The repository states clearly that the implementation is a Highnote Test/reference artifact, not a production SLA.
13. The same verifier contract can accept both an existing x402 evidence fixture and the Highnote evidence fixture.

The final demo should be understandable in under two minutes:

```text
Highnote Test transaction
        ↓
Inntris ALLOW / BLOCK
        ↓
evidence bundle
        ↓
offline verifier
        ↓
PASS / FAIL
```

---

# Deferred work — do not start without explicit instruction

The following belong to a later Track A / production phase:

- webhook notification ingestor;
- immutable raw-event landing store;
- event gap detection;
- GraphQL backfill;
- replay-trigger tooling;
- organization/agent/mandate registry backed by production storage;
- Highnote custom-metadata synchronization;
- generic lifecycle assembler;
- authorization → clearing → reversal → adjustment → refund state machine;
- signed append-only transaction lifecycle chain;
- lifecycle terminal-state semantics;
- lifecycle Merkle batching;
- Base anchoring;
- production US-East multi-AZ deployment;
- production p99 SLO;
- production availability SLO;
- on-call;
- circuit breaking;
- production load testing;
- production DDoS posture.

Do not expand Phase 1 into these areas unless required to make the reference artifact technically correct.

---

# Final design principle

If a design decision makes Inntris more like Highnote, it is probably wrong.

The adapter exists to demonstrate the part Highnote should not need to own:

> **organization-scoped authority and portable evidence across payment rails, independently verifiable outside the execution provider.**

Preserve that boundary in code, schemas, tests, documentation, and naming.
