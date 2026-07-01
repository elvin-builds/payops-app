cat > docs/security.md <<'EOF'

Security Notes
Current security controls
Secrets are loaded from environment variables.
.env is ignored by Git and should not be committed.
Public examples are stored in .env.example.
Containers should use non-root users where supported.
Services should expose only required ports.
GitHub Actions includes a baseline Trivy filesystem scan.
Local development

Never commit real credentials, production tokens or cloud access keys.

Use .env.example for placeholder values only.

Production recommendations
Use managed secret storage such as Azure Key Vault, HashiCorp Vault or Kubernetes Secrets integrated with external secret management.
Restrict network exposure for databases and message brokers.
Enable TLS for external traffic.
Add image scanning and dependency scanning gates.
Add centralized logging and metrics.
Add backup and restore validation for PostgreSQL.
