# Security Policy

rill-ext publishes the extensions a rill host mounts: HTTP clients, filesystem
and object-store access, shell execution, database and vector-store clients,
LLM provider SDKs, and mail and calendar integrations. An extension is the point
where a machine-generated script meets a real credential and a real side effect,
so credential handling, request construction, and path and command boundaries
are first-class concerns rather than a subcategory of bugs.

This policy describes what counts as a vulnerability, how to report one, and
what to expect afterwards.

## Supported versions

Only the latest published release of each extension is supported. Fixes land
there, and there are no backports to earlier releases.

Reproduce on the current release before reporting. If you cannot upgrade, say so
in the report and give the version you tested.

Current versions are on each package's npm page and in
[CHANGELOG.md](CHANGELOG.md).

This policy covers every package published from this repository, listed in
[CLAUDE.md](CLAUDE.md). The rill runtime itself, the agent framework, the CLI
tools, and the config library are separate repositories with their own policies.

## Reporting a vulnerability

Report privately through GitHub, on the
[Security tab](https://github.com/rcrsr/rill-ext/security/advisories/new) of
this repository. That opens a private advisory visible only to you and the
maintainers.

Do not open a public issue for a vulnerability in a published release.

Include:

- The extension and version you tested, and whether you reproduced it on the
  current release
- A minimal reproduction: the smallest host configuration and rill script that
  shows the behaviour
- What a host embedding the extension loses as a result, stated concretely
- Any provider account, endpoint, or configuration the reproduction depends on

**Do not exercise a reproduction against a third party's live service or
account.** Use a local server, a mock, or your own tenant.

## What to expect

| Stage | Target |
|-------|--------|
| Acknowledgement | 5 days |
| Initial assessment | 14 days |
| Fix or mitigation plan for a confirmed report | 30 days |

rill-ext is maintained by a small team, so these are targets rather than
guarantees. If a report goes quiet past acknowledgement, a nudge on the advisory
thread is welcome.

On a confirmed report, the maintainers publish a GitHub Security Advisory,
release a patched version, and credit you by name or handle unless you ask
otherwise.

## Threat model

The host chooses which extensions to mount and supplies their credentials. The
script, which the host did not write and which a language model may have
generated from untrusted input, chooses what to call and with what arguments.
An extension therefore treats every argument reaching a host function as
attacker-controlled.

### In scope

- **Credential disclosure.** An API key, token, or connection string reaching a
  return value, an error message, an emitted event, or a log line that the
  script or a downstream model can read.
- **Boundary escape.** A path argument reaching outside a configured sandbox
  root, a mount escaping its configured prefix, or an object key escaping its
  bucket scope.
- **Command and query injection.** A script argument altering the structure of a
  spawned command, a SQL statement, or a provider request rather than being
  carried as data.
- **Server-side request forgery.** A script argument steering an outbound
  request to a host or scheme the configuration did not authorize, including
  through redirects, and including reaching a cloud metadata endpoint.
- **Enforcement bypass.** Any allowlist, capability gate, or validator defeated
  by a different argument shape, an encoding, an unhandled type, or an unlisted
  default. A default that fails open is a defect in this class.
- **Resource exhaustion.** A script that wedges the host by escaping a
  documented timeout, response-size limit, or concurrency bound.
- **Disposal defects.** An extension continuing to act on a live credential or
  an open handle after `dispose()`.
- **Supply chain.** Anything in a published package's contents or in the release
  pipeline that lets a third party alter what consumers install.

### Out of scope

- **A host mounting a destructive capability and a script calling it.** rill's
  capability model puts that choice with the host. `exec` running a command the
  host authorized is the model working.
- **A script doing something the host authorized but did not intend.** Narrow
  what you mount, or constrain it in configuration.
- **Anything requiring the attacker to control the host embed or its
  configuration.** That is already full control.
- **A vulnerability in a vendor SDK or a provider's service**, unless this
  repository's use of it is what makes it reachable. Report those upstream, and
  tell us so the dependency range can move.
- **Prompt injection reaching a language model through an extension's return
  value.** What the host does with a model response is the host's design.
- **Findings from a scanner with no demonstrated impact on a host embed.**

If you are unsure which side a finding falls on, report it. A borderline report
that turns out to be by-design costs less than an unreported bypass.

## Hardening guidance for hosts

An extension's guarantees end at what you configure. Three practices carry the
most weight:

- **Scope the credential, not just the extension.** Give each extension a token
  with the narrowest provider-side scope the script needs. The extension cannot
  grant less authority than the credential carries.
- **Configure the allowlists.** Sandbox roots, permitted hosts, allowed
  calendars and buckets are opt-in. An extension mounted without them is
  authorized for everything its credential can reach.
- **Treat script-chosen strings as untrusted input.** Paths, keys, URLs, and
  identifiers come from the script author. Validate them against your own policy
  before they reach a host function, not after.

See the per-extension documentation under `packages/ext/*/docs/` for the
configuration surface these decisions run through.
