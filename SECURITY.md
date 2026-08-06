# Security Policy

## Supported Versions

DeepCover is pre-1.0 and moves quickly. Security fixes are only guaranteed for the latest published version on npm.

| Version | Supported |
|---------|-----------|
| Latest  | ✅ |
| Older   | ❌ |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report it privately via [GitHub Security Advisories](https://github.com/anatolykhelmer/deepcover/security/advisories/new), or by emailing **anatoly.khelmer@gmail.com** with:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal repro is ideal)
- Any known mitigations

You should receive an acknowledgement within a few days. We'll work with you to understand and address the issue, and credit you in the fix unless you prefer otherwise.

## Scope Notes

DeepCover's Reasoner phase can optionally call the Anthropic API using a key you provide (`ANTHROPIC_API_KEY` or `reasoner.apiKey`). That key is only ever read from your environment/config and passed to the Anthropic SDK — it is never logged or transmitted elsewhere. If you find a code path that handles API keys or other secrets unsafely, please report it under this policy.
