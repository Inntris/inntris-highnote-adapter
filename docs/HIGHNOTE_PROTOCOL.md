# Highnote protocol notes

These notes were checked against current public Highnote documentation on 12 August 2026:

- [Collaborative Authorization](https://docs.highnote.com/docs/issuing/spend-controls/collaborative-authorization)
- [Simulate Collaborative Authorization](https://docs.highnote.com/docs/issuing/spend-controls/sim-collaborative-authorization)

## Confirmed from public documentation

- Highnote performs balance, spend and velocity controls before invoking Collaborative Authorization.
- Highnote sends an HTTPS POST with a JSON body.
- `highnote-signature` is an HMAC SHA-256 over the request body.
- Signature comparison must use a constant time comparison.
- `extensions.signatureTimestamp` is a Unix timestamp in milliseconds and should be used for freshness checks.
- `collaborativeAuthorizationRequest.id` is the idempotency key and is reused for a retry.
- The endpoint has up to 2 seconds to return a 2xx response.
- A timeout or non-2xx response triggers the card product stand-in settings.
- Only one Collaborative Authorization endpoint can be active at a time.
- Highnote Test activation is self-service. Highnote Live enablement requires the Highnote team.
- Point of sale details, additional network data and cashback are omitted when not applicable.
- A partial authorised amount cannot exceed the requested amount and must use the same currency.
- The documented Test simulator can omit `merchantId` and `categoryCode`, and its example has a null preliminary response code.
- Point of sale semantics appear under two documented names: `pointOfServiceDetails` in the simulation input and `pointOfSaleDetails` in the callback example, which also carries a top level `networkRetrievalReferenceNumber`.

## Implemented interpretation

The service verifies the HMAC against the exact received bytes before schema parsing. It never recreates JSON before signature verification.

Both documented point of sale representations are accepted through their own strict schemas, and `getPointOfServiceDetails` reads whichever one arrived. The parsed request is never rewritten, so evidence binding and the raw-byte hash are unaffected. A request carrying both representations is rejected as ambiguous rather than resolved by precedence. Unknown fields still fail closed in both.

Real requests bind to the network merchant identifier and category code when present. For documented Test simulator requests, the adapter uses `name:<merchant name>` and `category:<Highnote category>` references. The evidence records the source type. These fallbacks are not presented as Visa, Mastercard or Highnote merchant identifiers.

The default freshness policy accepts a request up to 300 seconds old and up to 30 seconds in the future. Those values are an Inntris defensive policy, not a documented Highnote requirement.

## Public documentation gaps

The public page does not specify:

- whether the HMAC header is hex, Base64 or Base64url encoded
- a mandatory freshness window
- a signed key identifier in the request header
- whether custom card or account metadata is included in Collaborative Authorization payloads
- all differences between simulated and real Test payloads

These uncertainties are isolated through configuration and pre-warmed mandate mapping. They must be confirmed in Highnote Test before the integration can satisfy the Phase 1 live Test gate.
