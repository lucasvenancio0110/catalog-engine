# M7D3 — Retained Stage Diagnostic

Status: **Operational diagnostic only**  
Scope: read-only diagnosis of the retained M7D3 production canary fixture after `sync_stage_count_mismatch`.

This diagnostic does not change the M7 sync contract or advance the roadmap slice.

## Purpose

The trusted-main M7D3 canary retained an isolated fixture after the private stage seal failed safely with `sync_stage_count_mismatch`. The diagnostic identifies which persisted count dimension disagrees with the seal contract while preserving the failed evidence.

It reports only bounded operational evidence:

- opaque tenant/import/source identities;
- job status/phase and safe error code;
- stage state and safety outcome;
- expected/stored observation counts;
- expected/stored event counts;
- staged category count;
- expected detail count;
- foreign-key finding count;
- inferred mismatch dimensions.

## Safety boundary

The diagnostic is read-only.

It must not:

- mutate control-plane or tenant D1 state;
- enqueue, retry, purge or inspect Queue message payloads;
- delete the retained fixture;
- emit supplier URLs, raw provider payloads or credentials;
- relax `sync_stage_count_mismatch` or any M7 safety gate.

A successful diagnostic is evidence for the next M7D3 hotfix only. M7D3 remains below **PRODUCTION GREEN** until the exact corrected trusted-main SHA passes deployment, Queue consumer activation and the privileged incremental scan-stage canary.
