# Runtime integration contracts

Benana treats every integration as optional. A missing tool, disabled repository, malformed response, timeout, or API error appears as an explicit unavailable state. Benana does not turn those cases into an empty successful result.

The development environment check on 2026-10-10 found Codex on `PATH`. It did not find the Entire or Claude executables. Both `NEATLOGS_API_KEY` and `NEATLOGS_PROJECT_ID` were unset. The automated tests cover those adapters with provider-shaped responses, but this environment did not run live Entire, Claude, or Neatlogs requests.

## Entire

Benana runs `entire version --json` to detect the CLI and `entire status --json` to determine whether the open repository is enabled. Checkpoints and sessions remain available when Entire Graph is absent. Graph availability is reported separately.

The overview reads `entire checkpoint list --json --no-pager` and `entire sessions list --json`. Context uses `entire graph search --repo <path> --profile full --query <text> --format json --top-k 5 --max-context-bytes 12000`. The graph view uses `entire graph snapshot --repo <path> --format ndjson --worktree`.

The snapshot parser follows Entire Graph's `1.x` NDJSON record contract. It reads `record_type` values `file`, `external`, `symbol`, and `relation`. Relations use `from_id`, `to_id`, and `type`; symbols use `id`, `qualified_name`, and `file_path`. Header records provide schema and provider metadata and are not rendered as graph nodes. Unknown records are ignored rather than invented as generic results.

Graph search results retain the raw ranked record, ranking reason, source path, and summary. Checkpoint or session JSON that cannot be parsed is unavailable, with the command error attached.

## Neatlogs

Set `NEATLOGS_API_KEY` and `NEATLOGS_PROJECT_ID`. Set `NEATLOGS_REGION=eu` for the EU API. Benana reads `GET /api/v1/public/traces`, filters by the exact agent session identifier, then reads `GET /api/v1/public/traces/{traceId}/spans` for each match.

Trace summaries and spans are live evidence from Neatlogs. Benana does not install ingestion hooks or upload telemetry. Install the Neatlogs Claude Code plugin or Codex hooks separately. A run without a provider session identifier cannot be correlated. A span retrieval failure remains visible on the trace instead of appearing as an empty span list.

Requests are bounded by the integration client timeout. Authentication failures, transport errors, invalid JSON, and server errors appear in the integration status or evidence response.

## Agent providers

New Codex runs use `codex exec --json` in the attempt worktree. Attached Codex sessions use `codex exec resume <session-id> -`. Claude runs use stream JSON and attached sessions pass `--resume <session-id>`. Claude receives Bash along with file and Benana MCP tools so the resumed workflow can reproduce failures and run the configured checks.

Benana normalizes provider usage as `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, and `costUsd`. Command, file, MCP, and Claude tool events increment visible steps. Failed tool results remain evidence but do not by themselves replace the provider's terminal process result.
