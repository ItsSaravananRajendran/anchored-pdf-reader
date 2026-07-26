# Security Policy

## Threat model

This is a **single-user self-hosted application**. It is intended to run on a
trusted network (your laptop, a Tailscale network, behind your reverse
proxy). It is **not** designed for public exposure.

- **No authentication.** Anyone who can reach the server can use it.
- **Arbitrary URL download.** The `/api/pdf/load` endpoint will fetch any
  HTTP(S) URL the user supplies. On a trusted network this is fine; on a
  public network this is an open SSRF.
- **No request-body sanitization for LLM output.** Assistant messages are
  rendered as HTML via `dangerouslySetInnerHTML` after going through marked +
  KaTeX. A malicious PDF could embed content that, when extracted, becomes a
  prompt injection. Don't expose this to untrusted users.

If you need to expose this app publicly, **put it behind an authenticating
reverse proxy** (Caddy, nginx with auth_request, Cloudflare Access, etc.).

## Reporting a vulnerability

Email the maintainer directly. Do **not** file a public GitHub issue for
security-sensitive bugs.

Include:
- A short description
- Reproduction steps (or a proof-of-concept)
- Impact assessment

## Supported versions

Only the latest commit on `main` receives security fixes. There are no
backported security branches.

## Dependencies

We pin Python deps in `pyproject.toml` and Node deps in `package-lock.json`.
Run `npm audit` and `pip-audit` periodically to check for known CVEs.