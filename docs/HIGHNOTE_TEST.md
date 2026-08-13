# Highnote Test runbook

This runbook is for Highnote Test only. Use dummy data. Do not put production or personal data into the Test environment.

## Current state

The deterministic local adapter, fixtures and offline verification are complete. A request from Highnote Test has not yet been observed in this repository. That live Test gate remains open until the steps below are executed and recorded.

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

- [ ] Highnote Test request reached the deployed adapter
- [ ] HMAC encoding confirmed from an observed request or Highnote guidance
- [ ] ALLOW simulation passed
- [ ] BLOCK simulation passed
- [ ] unmapped card returned a 2xx decline rather than a non-2xx stand-in delegation
- [ ] exact retry returned the same logical result
- [ ] deployed latency recorded
- [ ] evidence verified offline with a pinned public key
- [ ] no credentials or payment data entered Git, logs or fixtures

Do not mark Phase 1 complete until every applicable item is checked with evidence.
