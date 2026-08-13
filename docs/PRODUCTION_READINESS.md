# Production readiness boundary

## Current classification

Production shaped Highnote Test reference adapter. Not production ready and not a production card authorisation service.

## Implemented and locally verified

- exact body HMAC verification and constant time comparison
- explicit freshness checks
- strict documented request and response schemas
- organisation, principal, agent, mandate and policy binding from a pre-warmed snapshot
- ALLOW, BLOCK and REQUIRE_APPROVAL behaviour
- explicit declines rather than stand-in delegation for failures after authentication
- deny preserving pass-through composition with availability failures separated from protocol violations
- bounded exact retry coalescing and altered payload rejection within one process
- signed decisions and evidence
- deterministic allow, block, replay, approval and tamper vectors
- offline verification with the pinned upstream verifier
- local latency measurement
- health, metrics, structured safe logging, container and public CI
- zero known npm audit vulnerabilities at the recorded release check

## Unproven or intentionally deferred

- a request from an actual Highnote Test endpoint
- Highnote signature encoding and freshness guidance
- Highnote Live enablement or endorsement
- production stand-in configuration
- persistent multi-instance idempotency and replay state
- asynchronously refreshed production mandate storage
- managed or hardware backed signing custody and rotation
- durable evidence queue and object storage
- multi-zone or multi-region deployment
- deployed p99 latency, capacity and availability
- recovery objectives and tested disaster recovery
- DDoS posture and external penetration testing
- reconciliation against Highnote lifecycle events
- an active customer pass-through endpoint

## Why the boundary matters

An in-memory idempotency map is correct for deterministic Test retries in one process, but it does not survive restarts or coordinate replicas. A file evidence sink is useful for the reference artifact, but it is not a durable production queue. Environment supplied signing seeds are not a substitute for managed key custody. A single local benchmark does not establish a service level.

Highnote Live also requires Highnote team enablement. No repository change can replace that operational approval or the need to test the actual deployed endpoint.

## Next production track

Do not silently fold this work into the reference adapter. Treat it as a separately reviewed production programme:

1. confirm protocol questions and complete the Highnote Test runbook
2. agree fail-open or fail-closed and Highnote stand-in posture with the customer and Highnote
3. add shared durable idempotency with atomic same-ID payload conflict detection
4. add asynchronously refreshed tenant scoped mandate storage
5. move signing to managed custody with published key rotation and revocation
6. add a durable evidence queue, immutable storage and recovery monitoring
7. deploy across the agreed failure domains and run load, fault and recovery tests
8. complete security review, penetration testing, operational runbooks and on-call ownership
9. obtain Highnote Live enablement and execute controlled cutover

Until those gates are evidenced, use only the Highnote Test description in external communication.
