# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in `aluvia-cli`, please report it responsibly.

**Do NOT create public GitHub issues for security vulnerabilities.**

### How to Report

Email **security@aluvia.io** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Any suggested fixes (optional)

### What to Expect

- **Response time:** We will acknowledge your report within 48 hours.
- **Updates:** We will keep you informed of our progress.
- **Disclosure:** We will coordinate with you on public disclosure timing.
- **Credit:** We will credit you in the security advisory (unless you prefer anonymity).

### Scope

This policy applies to:

- The `aluvia-cli` npm package
- Code in this repository

For vulnerabilities in the Aluvia API or web services, please contact security@aluvia.io directly.

## Security Best Practices

When using `aluvia-cli`:

1. **Never commit API keys** — persist them with `aluvia auth <key>`
2. **Never print API keys** — CLI JSON must not echo secrets
3. **Keep dependencies updated** — run `npm audit` regularly
