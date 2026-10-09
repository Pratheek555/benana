# GitHub integration design

Benana stores GitHub identity state in D1. The browser receives an opaque `HttpOnly`, `SameSite=Lax` session cookie. The cookie contains a random value whose SHA-256 hash is the D1 lookup key. Production cookies use `Secure`; local HTTP is accepted only on a loopback origin.

D1 is the authority because repository selections, session revocation, OAuth replay prevention, and concurrent token refresh need server-side coordination. A signed cookie could authenticate a browser, but it could not revoke one session or atomically consume an OAuth transaction. GitHub access and refresh tokens use AES-256-GCM with `TOKEN_ENCRYPTION_KEY` before D1 stores them.

OAuth transactions last ten minutes. Each transaction stores a hash of `state`, a hash of a separate browser cookie, and an encrypted PKCE verifier. The callback deletes and returns the matching row before exchanging the code. A missing browser cookie, expired row, wrong state, or replay fails before GitHub receives a token request.

Repository selection is a list of stable numeric GitHub repository IDs. Every save refreshes the repositories available through the user's installations, keeps repositories where the App is installed and the user can write, validates the complete requested set, then replaces the user's D1 rows in one batch. This multiple-selection design keeps one active repository in the route while the sidebar gives fast access to every saved repository.

Issue reads require a saved selection and repeat the current App and user access check. The API resolves owner and name from the fresh GitHub result rather than route input. It filters pull requests from each GitHub issues page and preserves the next page when a full upstream page contains pull requests.

The existing fixture workspace remains at `/demo/repositories/:repositoryId`. Live routes do not adapt GitHub issues into demo attempts, priorities, acceptance criteria, checkpoints, forks, or exports.
