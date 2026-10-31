# Server-only Databricks integrations

`sql.server.ts` pins the workspace and provides authenticated parameterized bounded Statement Execution API access. `model-hosting.server.ts` verifies actual ready managed model/entity routing before inference; a workspace URL alone is insufficient. SQL and hosting tests use injected transports. No browser credential or unrestricted browser SQL path exists.

[Platform README](../../lib/msl/platform/README.md) contains the full diagram, contracts, verified resources, server variable names, limits, ownership and run/test instructions. [Profiling](../../lib/msl/profiling/README.md) and [newsletter](../../lib/msl/newsletter/README.md) describe workload-specific inference. No external provider fallback.
