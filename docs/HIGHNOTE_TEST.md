# Highnote Test runbook

This runbook is for Highnote Test only. Use dummy data. Do not put production or personal data into the Test environment.

## Current state

The deterministic local adapter, fixtures and offline verification are complete. The live Test gate remains open: endpoint activation has not yet reported `ACTIVE`, and no Highnote Test authorisation simulation has been exercised end to end.

## Observed Highnote Test endpoint activation attempt, 13 August 2026

A real Highnote Test endpoint activation POST reached the deployed adapter on Railway at `POST /v1/highnote/collaborative-authorization`. The observed outcome was:

- Highnote reached the endpoint over HTTPS and used the registered route.
- Raw-body HMAC verification passed. The request got past `verifyHighnoteAuthenticity` and into schema parsing, which is only reachable after a valid signature.
- Strict request-schema parsing then failed. The adapter returned HTTP 400 with `INVALID_REQUEST_SCHEMA`.
- Highnote reported `status = ACTIVATION_FAILED`.

This is evidence about the request shape only. It says nothing about the signing secret, the signature header name, the `hex` signature encoding or the freshness window, all of which the request had already cleared. None of those were changed in response.

### Why the shape differed

Highnote's current documentation uses two names for the same point of sale semantics:

- the simulation input uses `pointOfServiceDetails`
- the documented callback example uses `pointOfSaleDetails`, alongside a top level `networkRetrievalReferenceNumber`

The documented callback `pointOfSaleDetails` example carries `panEntryMode`, `pinEntryMode`, `terminalAttendance`, `isCardHolderPresent`, `isCardPresent`, `isRecurring` and `terminalSupportsPartialApproval`. It does not carry `category` or `cardDataInputCapability`.

The adapter had modelled only `pointOfServiceDetails` and rejected everything else, so a request in the documented callback representation could not parse.

### What changed

The adapter now explicitly supports both documented representations while remaining strict:

- `pointOfSaleDetails` is accepted through its own strict schema. `category` and `cardDataInputCapability` are modelled as explicit optional compatibility fields rather than assumed.
- `networkRetrievalReferenceNumber` is accepted as an optional, nullable, bounded string. It is never read as an authority signal or policy input.
- Unknown request fields and unknown point of sale fields still fail closed.
- A request carrying both `pointOfServiceDetails` and `pointOfSaleDetails` is rejected as ambiguous, because the two objects could disagree on `terminalSupportsPartialApproval` and the adapter must not silently pick one reading.
- `getPointOfServiceDetails(request)` reads whichever representation arrived. The parsed request is never rewritten, so evidence binding and the raw-byte hash are unaffected.
- On a schema rejection the adapter logs sanitised diagnostics only: failing field paths, issue codes, expected type categories, unrecognised key names and the Highnote request ID when it can be read safely. Request values, signature material and payment data are never logged.

Authentication, freshness and the HMAC-before-schema ordering were not modified. There is no activation special case: Highnote's activation verification traverses the same authenticated request boundary as normal Collaborative Authorization traffic.

Activation has **not** been confirmed. Do not record activation as passed until a later real activation attempt actually reports `ACTIVE`.

## Second activation attempt after the compatibility patch, 13 August 2026 18:50 and 18:52 GMT+2

Two further activation POSTs reached the deployed adapter after the compatibility patch. Both passed raw-body HMAC verification and both failed strict schema parsing with `INVALID_REQUEST_SCHEMA` and HTTP 400. Highnote again reported `status = ACTIVATION_FAILED` for endpoint `cae_a4872815fc474a47b88b8efd136fe6a2`.

The sanitised diagnostics show a different failure from the one the compatibility patch addressed. Every field of the authorization request was reported missing:

- `__typename` — `invalid_value`
- `id`, `transactionTimestamp`, `avsResponseCode`, `postalCodeResponseCode`, `cvvResponseCode` — `invalid_type`, expected `string`
- `transaction`, `paymentCard`, `transactionAmount`, `settlementAmount`, `requestedAmount`, `surchargeFee`, `merchantDetails` — `invalid_type`, expected `object`

Two facts follow directly. Zod descended into `data.collaborativeAuthorizationRequest` and reported per-field issues, so `data` is an object and `collaborativeAuthorizationRequest` is an object. Every field inside it is absent rather than wrongly typed.

This is **not** a `pointOfServiceDetails` versus `pointOfSaleDetails` mismatch. A well-formed authorisation request in either documented representation would produce at most one or two issues, not one per field. The activation verification POST does not appear to carry a `PaymentCardAuthorizationRequest` at all.

What the first diagnostic run could not distinguish: whether `collaborativeAuthorizationRequest` was empty or carried entirely different keys. Zod emits `unrecognized_keys` only after every per-field issue, at index 15 of 16, and the summary was capped at 10. The reordering described below makes those key names survive truncation, so the next attempt will show what Highnote actually sends.

Do not widen the schema to make this parse. The schema is not known to be wrong here; the payload is not known to be an authorisation request. Confirm the activation verification payload shape with Highnote before changing validation.

## Prepare the adapter

1. Deploy the container to an HTTPS endpoint in the region chosen for the Test exercise.
2. Mount or supply the mandate snapshot. Replace `card_simulator_001` with the actual Highnote Test payment card ID.
3. Keep the documented simulator fallback policy for `HIGHNOTE_PLATFORM` and `GENERAL_SERVICES`, or replace it with the exact dummy merchant values used in the exercise.
4. Store the Highnote endpoint signing secret and the Inntris test signing seed in the deployment secret manager.
5. Set `PUBLIC_ADAPTER_URL` to the exact public endpoint.
6. Keep `DOWNSTREAM_FAILURE_POLICY=deny` and `AUTHORIZATION_FAILURE_POLICY=decline` unless the exercise explicitly tests advisory or stand-in behaviour.
7. Confirm `/health/ready` returns 200 and `/metrics` is collected only through the intended operations path.

## Configure Highnote Test

Use the current [Highnote simulation guide](https://docs.highnote.com/docs/issuing/spend-controls/sim-collaborative-authorization).

1. Enable Collaborative Authorization in the Highnote Test dashboard.
2. Register the adapter HTTPS endpoint.
3. Capture the endpoint signing secret directly into the deployment secret manager. Do not paste it into Git, chat or a ticket.
4. Confirm the signature header encoding with Highnote and set `HIGHNOTE_SIGNATURE_ENCODING` accordingly.
5. Activate the endpoint. Remember that activation deactivates any currently active endpoint.

## Exercise ALLOW

Simulate an authorisation for the mapped Test card with:

- amount: USD 50.00
- merchant name: `HIGHNOTE_PLATFORM`
- category: `GENERAL_SERVICES`
- partial approval support: true

Expected adapter result:

- HTTP 200
- response code `APPROVED`
- signed Inntris verdict `ALLOW`
- evidence emitted after the response

## Exercise BLOCK

Repeat with USD 250.00. The example policy ceiling is USD 100.00.

Expected adapter result:

- HTTP 200
- response code `EXCEEDS_LIMIT`
- signed Inntris verdict `BLOCK`
- Highnote native checks are not reimplemented

## Exercise an unmapped card

Simulate an authorisation for a Test card that is deliberately absent from the mandate snapshot.

Expected adapter result:

- HTTP 200
- response code `INVALID_TRANSACTION`
- `authorization_failure_total{code="MANDATE_NOT_FOUND",policy="decline"}` incremented
- no signed decision, because no organisational authority was established

This confirms that a provisioning gap becomes a visible decline rather than a non-2xx response handed to the Highnote stand-in setting.

## Verify the resulting evidence

1. Copy the emitted bundle and generated pack to a machine without Highnote credentials.
2. Pin the published public key rather than trusting only the key embedded in the pack.
3. Run the TypeScript verifier and the pinned `inntris-verify` verifier.
4. Change the amount, merchant, policy hash, action hash, Highnote reference and signature in separate copies. Every changed bundle must fail.

## Evidence to record

Record no secrets. Preserve:

- UTC timestamp
- deployed adapter commit SHA
- Highnote Test request ID and transaction ID
- response code
- Inntris decision ID, action hash and verdict
- observed end to end latency
- evidence pack hash
- verifier commit SHA and output
- configured stand-in posture as an operator attestation

## Completion checklist

- [x] Highnote Test request reached the deployed adapter (activation POST, 13 August 2026)
- [x] HMAC encoding confirmed from an observed request: the activation POST passed hex HMAC verification
- [ ] Highnote Test endpoint status reported `ACTIVE`
- [ ] ALLOW simulation passed
- [ ] BLOCK simulation passed
- [ ] unmapped card returned a 2xx decline rather than a non-2xx stand-in delegation
- [ ] exact retry returned the same logical result
- [ ] deployed latency recorded
- [ ] evidence verified offline with a pinned public key
- [ ] no credentials or payment data entered Git, logs or fixtures

Do not mark Phase 1 complete until every applicable item is checked with evidence.
