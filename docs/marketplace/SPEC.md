# Benana marketplace: spec

Status: decided at product level; open items marked **(verify)**. Owners: product team (Umang, Pratheek, Kathrina).

## 1. Goal

Creators publish finished Minecraft mods from Benana Mod Studio. Players browse, vote, review and install them. Each listing shows how the mod was made (its Entire history) so buyers can judge it without trusting the creator's word alone.

Launch is free. Listings are community-curated. There is no verification gate at launch.

## 2. Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Who can list | Any GitHub-signed-in account with a public source repo |
| 2 | Editing | Yes. Each change is a new version; old versions stay downloadable |
| 3 | Removing | The creator can remove their own listing; the page keeps its history, marked removed |
| 4 | Transcripts | Hidden by default. Only metadata is published unless the creator opts in for the repo |
| 5 | Reports | Hidden after 3 reports, then reviewed by hand |
| 6 | Reviewers | Team only at launch. Users can report, never decide. Creators see report reasons and may reply before a hide |
| 7 | Reviews | Star rating plus short written review. One per account per listing. Creators may reply. Hidden only for rule violations, and the rule is shown |
| 8 | Sign-in | GitHub |
| 9 | Votes | One per account, upvote only. Account must be at least 7 days old |
| 10 | Install warning | One-line notice on every listing |
| 11 | Storage | Supabase Storage for jars, 10 MB limit per jar |
| 12 | Listing cap | 10 listings per account |
| 13 | Traces | Linked to Neatlogs, never copied |
| 14 | Changelog | Every version shows its changelog from `entire graph diff` against the previous version |
| 15 | Code map | Each version stores an `entire graph index --report` code map, labelled "code map", not "verified" |
| 16 | Graph at launch | Changelog and code map only. Search and impact views wait until there are listings to use them |
| 17 | Graph in the Studio | Fixer receives graph search results instead of raw history (product change, separate branch) |
| 18 | Intent matching | Investigate matching dead ends by symbol rather than file (product change, separate branch) |

## 3. Terms

- **Mod:** the project in the Studio, with its own repo and history on the creator's machine.
- **Listing:** one published mod's page. One mod, one listing.
- **Version:** one release inside a listing: a jar, its SHA-256, the commit it was built from, and the checkpoints behind it.

## 4. Data model (Supabase Postgres)

- `profiles` (id = Supabase auth user, github_login, created_at)
- `listings` (id, owner_id, slug, name, summary, source_repo_url, status: `live|hidden|removed`, created_at, updated_at)
- `versions` (id, listing_id, number, jar_path, jar_sha256, jar_bytes, commit_sha, playtest_summary, created_at)
- `version_checkpoints` (version_id, checkpoint_id, public bool) — public rows drive what the listing shows
- `votes` (listing_id, voter_id, created_at; unique on listing + voter)
- `reviews` (id, listing_id, author_id, stars 1–5, body, status: `visible|hidden`, hidden_reason, created_at; unique on listing + author)
- `review_replies` (review_id, author_id, body, created_at)
- `reports` (id, listing_id, reporter_id, category: `safety|spam|copied|personal_data|other`, reason, created_at)
- `moderation_actions` (id, listing_id, actor_id, action, reason, created_at)

Row-level security: anyone can read `live` listings and their visible reviews; only the owner writes to their listing; votes and reports are insert-only for the voter or reporter; `moderation_actions` and reports are readable by the team role only.

Limits enforced in the database: 10 listings per owner, one vote and one review per account per listing, and the account-age rule for votes.

## 5. Publishing flow (Studio → marketplace)

1. Creator signs in with GitHub.
2. Studio checks the mod's source repo is public and reachable. If not, it stops.
3. Studio shows the publish checklist: playtest result (self-reported), changelog, the transcript warning, and the install warning.
4. Creator confirms. Studio uploads the jar and computes its SHA-256.
5. Studio sets `push_sessions` for the repo only if the creator opted in for transcripts (see §7). Otherwise session pushing stays off.
6. Studio writes the version row and the metadata for each checkpoint it includes.

## 6. Entire integration

We use the CLI and only read metadata by default.

- **Metadata:** `entire checkpoint explain <id> --json`. It returns branch, files touched, session count, sessions, tasks and strategy, with no transcript bytes.
- **Changelog:** `entire graph commit <rev>` or `entire graph diff --base <v1> --head <v2>` between versions. Shows added, removed and signature-changed symbols with dependent counts.
- **Transcripts:** `checkpoint explain --transcript` is used only when the creator has opted in for that repo, or in an open report case with the creator notified (§7).
- **Code graph (entire-graph v0.4.0):** full semantic analysis for Java, which is what our plugins are written in. Relations include CALLS, IMPORTS, EXTENDS, IMPLEMENTS, OVERRIDES, READS_FIELD and WRITES_FIELD. Each version gets its own code map:
  - `entire graph index --head --report GRAPH_REPORT.md` writes a report that renders the same bytes for the same commit. The report is hashed and stored with the version, so the code map can be checked.
  - `entire graph diff --base <v1> --head <v2>` gives the changelog, with dependent counts on signature changes.
  - `entire graph search --query "..."` gives remixers the relevant code and its covering test.
  - `entire graph impact --symbol <name>` gives reviewers the blast radius of a change before they read any code.
  - The plugin reports `no_egress=true`, so the same analysis runs offline in a buyer's environment.
  **(verify)** that the report is byte-identical on two machines for the same commit.
- **Provenance per version:** the checkpoints reachable from the version's commit form that version's history. Only checkpoints linked to published versions are shown.

## 7. Transcript and privacy rules

- Default: transcripts are not published. `push_sessions` stays off for the repo.
- Opt-in: the creator turns on session pushing for the repo at publish time, with a warning that transcripts become visible to anyone who can read the checkpoint remote.
- Publishing a version never pushes transcripts for checkpoints outside that version.
- A separate checkpoint remote (`configure --checkpoint-remote`) may be used so private work and published work stay apart. **(verify)** that publishing can push only the checkpoints for public versions.
- Moderators read metadata first. A transcript is read only inside an open report case, and the creator is notified when that happens.

## 8. Safety

- Every version stores a SHA-256 of its jar. Buyers can check the file they download matches the listed hash.
- Every listing shows the install warning and a required link to the source repo.
- Reports hide a listing after 3 reports pending review. The creator sees the category and reason and may reply before a hide.
- Hidden listings keep their history, so reviewers and remixers can still see what happened.

## 9. Moderation

- Roles live in our database (`moderators` table, team only at launch). Entire doesn't handle moderation.
- Hide decisions, reinstatements and removals are written to `moderation_actions` with a reason.
- Reviews are hidden only for rule violations: spam, harassment, personal data, or copied content. The rule is shown on the page.

## 10. Open items (verify before build)

1. Session pushing can be turned off after publish without losing local history. (The flag exists; toggling after publish is untested.)
2. Publishing can push only the checkpoints for public versions. (Untested. Depends on how checkpoints are stored as refs.)
3. A moderator can read one checkpoint remote without access to the whole repo. (`repo grant` exists; untested.)
4. `graph index --report` produces byte-identical reports on two machines for the same commit. (Same machine, two runs: identical. Two machines: untested.)
5. Redaction of secrets in transcripts is thorough enough to publish opt-in transcripts. (Not verified.)

## 11. Graph decisions

- The changelog is required for every version. It is computed from `entire graph diff` against the previous version's commit.
- The code map is stored with each version and labelled "code map". It is not a verification badge.
- Search and impact views are not part of launch.
- Fixer context and symbol-level intent matching are Studio and intent-graph changes. They are tracked here but built on separate branches.

## 12. Not in launch

Payments, verification sandbox, paid listings, team organizations, and mobile.
