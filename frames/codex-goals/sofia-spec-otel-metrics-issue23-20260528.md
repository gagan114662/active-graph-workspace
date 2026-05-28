# Sofia spec — activegraph issue #23: OpenTelemetryMetrics (first customer feature)

**Spec owner:** Sofia. **Status:** READY — the 5 open design questions are locked below, so the
5-agent chain can fire on operator go-ahead. **Issue:** Matt Van Horn, `yoheinakajima/activegraph#23`.

## Goal
Add `OpenTelemetryMetrics` as a third implementation of the existing `Metrics` Protocol
(`activegraph/observability/metrics.py`), alongside `NoOpMetrics` (default) and `PrometheusMetrics`.
Drop-in, lazy-imported, behind a new `[opentelemetry]` extra. Zero behavior change unless a user
explicitly constructs it.

## Hard constraints (from the existing Protocol — do NOT change)
- The Protocol is exactly three methods, all **best-effort, non-throwing**, tolerating unknown names:
  `counter(name, tags: dict[str,str], value=1.0)`, `histogram(name, tags, value)`, `gauge(name, tags, value)`.
- Mirror `PrometheusMetrics`' shape: lazy instrument cache keyed by `(name, sorted(tag_keys))`, a
  static `available()` returning False when the SDK isn't installed, lazy `_require_client()`-style import.
- The standard metric table in `metrics.py` is the source of truth; conformance tests pin it.

## The 5 locked decisions

**Q1 — Gauge mapping.** OTel has no plain "set gauge" in older SDKs. **Decision:** use OTel's
**synchronous `Gauge`** (added in the OTel metrics spec; present in current `opentelemetry-sdk`). If
the installed SDK lacks a sync Gauge, fall back to an **ObservableGauge** backed by a per-`(name,tags)`
last-value dict that the callback reads. `gauge()` records the value (sync) or updates the last-value
store (observable). Never raise.

**Q2 — Histogram bucket strategy.** **Decision:** v1 uses the **SDK default explicit-bucket
aggregation** — do NOT hard-code per-metric boundaries in the implementation. Bucket tuning belongs to
the user's MeterProvider `View` config, not the library. Document that users wanting custom buckets
register a `View` on the meter name. (Keeps the impl thin + matches "cardinality discipline is the
caller's job".)

**Q3 — Scope: traces too, or metrics-only? (the flagged question).** **Decision: METRICS-ONLY for v1.**
The Protocol is `Metrics`; conflating tracing into this class breaks single-responsibility and the
Protocol contract. Spans/traces are a separate future `OpenTelemetryTracing` (own issue). Rationale:
keeps #23 reviewable + shippable, and a user wiring OTel metrics rarely wants this class to also
hijack their tracer. State this explicitly in the docstring + docs.

**Q4 — Naming.** **Decision:** pass activegraph metric names through **unchanged** (underscored, as in
the standard table) — same names across NoOp/Prometheus/OTel for cross-backend consistency. Map `tags`
→ OTel **attributes** verbatim. Do NOT rewrite to OTel dotted convention (would break dashboards that
already key on the Prometheus names + the conformance table).

**Q5 — Conformance test shape.** **Decision:** mirror `tests/test_observability_metrics.py`. The OTel
conformance test (gated to skip when the SDK isn't installed) must assert: (a) `OpenTelemetryMetrics`
is a `Metrics` (runtime_checkable `isinstance`); (b) every row in the standard metric table records
without raising; (c) using an **in-memory metric reader** (`InMemoryMetricReader`), recorded points
appear with the right instrument type + attributes; (d) unknown metric names + unknown tag keys are
tolerated; (e) `available()` is False when the import is forced to fail.

## Scope (files)
- NEW `activegraph/observability/otel.py` — `OpenTelemetryMetrics` (+ `available()`, lazy import).
- `pyproject.toml` — new `[opentelemetry]` extra: `opentelemetry-api`, `opentelemetry-sdk`.
- `observability/__init__.py` — export `OpenTelemetryMetrics` (lazy, like prometheus).
- NEW `tests/test_observability_otel.py` — conformance test per Q5 (skip if SDK absent).
- Docs: `observability` reference page — add OTelMetrics + the Q2 View note + the Q3 metrics-only note.

## 5-agent chain (fire on operator go-ahead; ~$10–30, gated by Sentinel + fail-closed review)
1. **Sofia** → this spec (DONE).
2. **Maya** → implement `otel.py` + extra + export, mirroring `PrometheusMetrics`.
3. **Quinn** → adversarial tests: SDK-absent path, sync-Gauge-absent fallback, unknown names/tags,
   in-memory-reader point assertions, isinstance(Metrics).
4. **Maya** → fix anything Quinn breaks.
5. **Sam** → docs (reference page + the [opentelemetry] extra in install docs + a usage snippet).

## Definition of done
`OpenTelemetryMetrics` passes the conformance test with `opentelemetry-sdk` installed; the package
still imports + all existing tests pass with it ABSENT (lazy import, `available()` False); Rowan PASS;
Sentinel ALLOW; lands as a PR to `gagan114662/activegraph` (then upstream to `yoheinakajima/activegraph#23`).
This is the factory's first *customer-filed* feature — a different evidence class than synthetic gauntlets.
