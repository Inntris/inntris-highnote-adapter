# Open questions for Highnote

Ask these before representing the adapter as Highnote Test validated.

1. What exact encoding does `highnote-signature` use: lowercase hex, Base64, or Base64url?
2. Does Highnote require or recommend a maximum age and future clock skew for `extensions.signatureTimestamp`?
3. During signing key rotation, can multiple keys be valid, and is a key identifier sent with each request?
4. Are retries always byte identical, or is only `collaborativeAuthorizationRequest.id` guaranteed to remain stable?
5. Which merchant and category identity fields are present in real Test requests versus simulator requests?
6. Can card, account or product custom metadata be projected into the Collaborative Authorization payload?
7. Is there a documented way to distinguish a simulator request from a network originated Test request?
8. Which decline response code does Highnote recommend when an external organisational approval is required?
9. How should a customer configure stand-in behaviour when Inntris is an enforcement control?
10. Which decline response code does Highnote recommend when the adapter itself fails on an authenticated request, so the failure does not have to reach the stand-in setting as a non-2xx response?
11. What endpoint availability, regional placement, TLS, IP filtering and capacity expectations apply before Live enablement?
12. What is the recommended cutover process when a customer already has the single active Collaborative Authorization endpoint?
13. Can Highnote provide a Test payload corpus for Visa, Mastercard, cross-border, partial approval and missing optional field cases?

Until answered, the reference defaults to explicit configuration, strict schema validation and fail closed handling.

## Observed Highnote Test compatibility behaviour

Recorded 13 August 2026 from a real Highnote Test endpoint activation POST to the deployed adapter.

- Question 1 is partly answered by observation. The activation request passed raw-body HMAC verification with `HIGHNOTE_SIGNATURE_ENCODING=hex`, so the header is lowercase hex for Highnote Test activation traffic. Confirm the same holds for authorisation traffic before treating it as settled.
- Highnote documents two names for the same point of sale object. The simulation input uses `pointOfServiceDetails`; the callback example uses `pointOfSaleDetails` and adds a top level `networkRetrievalReferenceNumber`. The adapter now accepts both explicitly.
- The documented callback `pointOfSaleDetails` example does not include `category` or `cardDataInputCapability`. Those are modelled as optional compatibility fields, not assumed.

New questions raised by this observation:

14. Are `pointOfServiceDetails` and `pointOfSaleDetails` two names for one object, or can a request legitimately carry both? The adapter currently rejects a request carrying both as ambiguous.
15. Which representation does a real Highnote Test authorisation callback use, as opposed to an endpoint activation verification request?
16. Are the descriptive `pointOfSaleDetails` fields always present in a callback, or omitted when not applicable? The adapter accepts them as optional and requires only `terminalSupportsPartialApproval`.
17. Is `networkRetrievalReferenceNumber` the same value as `additionalNetworkData.retrievalReferenceNumber`, and can both appear in one request?

The most urgent question, raised by the second activation attempt on 13 August 2026:

18. **What exact JSON body does Highnote send when activating and verifying a Collaborative Authorization endpoint?** Answered by observation on 13 August 2026: `data.collaborativeAuthorizationRequest` carries a single `ping` key, with a normal `extensions.signatureTimestamp`, HMAC signed like an authorisation request. This is not described on the simulation page. Confirm it is stable and documented rather than incidental.

19. **What value type does `ping` carry, and what response body does Highnote expect for a probe?** The adapter accepts any JSON value for `ping` and answers HTTP 200 with `{"ping":"ok"}`, on the basis that the documented requirement is only that the endpoint can return 2XX. Neither the request value type nor the expected response body is documented.

20. Is the verification probe re-sent periodically after activation, or only during activation? An endpoint that treats it as a one-off would break on a later re-verification.
