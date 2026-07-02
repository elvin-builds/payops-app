# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | ✅ Yes             |
| < 1.0   | ❌ No              |

## Reporting a Vulnerability

If you discover a security vulnerability in PayOps, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the details to the repository owner via:
- GitHub: [@elvin-builds](https://github.com/elvin-builds)
- LinkedIn: [Elvin Hagverdiyev](https://www.linkedin.com/in/elvin-hagverdiyev/)

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Fix or mitigation:** depends on severity, but prioritized

## Security Best Practices for Deployment

If you're deploying PayOps or using it as a reference:

### Secrets Management
- **Never** commit `.env` files or secrets to version control
- Use a secrets manager (Azure Key Vault, AWS Secrets Manager, HashiCorp Vault) in production
- Rotate JWT secrets and database passwords regularly
- The `docker-compose.yml` requires a `.env` file — see `.env.example` for required variables

### Authentication
- Change the default JWT secret before any deployment
- Use strong, unique passwords (not `payops123`)
- Enable HTTPS/TLS in production (via Ingress controller or reverse proxy)
- Set appropriate JWT expiry times

### Network Security
- Do not expose database ports (5432) or RabbitMQ ports (5672, 15672) publicly
- Use Kubernetes NetworkPolicies to restrict inter-service traffic
- Enable Redis authentication in production

### Container Security
- Run containers as non-root users
- Scan images with Trivy or similar tools (already in CI pipeline)
- Use multi-stage Dockerfiles to minimize attack surface
- Pin base image versions (already done: `postgres:16-alpine`, `redis:7-alpine`)

### Database
- Use separate database credentials per service in production
- Enable SSL/TLS for PostgreSQL connections
- Regular backups with encryption at rest

### Monitoring
- Enable audit logging for authentication events
- Monitor for unusual transaction patterns
- Set up alerts for failed health checks

## Known Security Considerations

This is a **portfolio/educational project**. The following are known limitations:

- Default test credentials are seeded in `database/init.sql` (dev only)
- No rate limiting on auth endpoints (planned)
- No input validation library (recommended: Joi or Zod)
- Single shared database for all services (no per-service isolation)
- No TLS/HTTPS configured for local development

For production use, address all of the above before deploying.
