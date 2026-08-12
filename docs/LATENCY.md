# Latency measurements

Measured locally on 12 August 2026 on the development Windows workstation using 200 sequential deterministic requests and no downstream endpoint:

| Metric  |   Result |
| ------- | -------: |
| p50     |  5.70 ms |
| p95     |  6.77 ms |
| p99     |  7.01 ms |
| maximum | 31.35 ms |

Command:

```shell
npm run benchmark -- 200
```

This measures local policy evaluation, decision signing and evidence bundle construction. It excludes internet transit, TLS termination, deployed platform scheduling, downstream customer latency and asynchronous evidence persistence.

Highnote documents a 2 second response window. These local measurements are not a production service level objective or a deployed availability claim. A deployed Highnote Test measurement is still required.
