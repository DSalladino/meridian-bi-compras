# Deploy: HTTPS e backup

## HTTPS

O servidor Node fala HTTP e deve ficar atrás de um proxy TLS. Duas opções prontas:

| Arquivo | Quando usar |
| --- | --- |
| [`Caddyfile`](Caddyfile) | Caddy com certificado automático (mais simples) |
| [`nginx.conf`](nginx.conf) | Nginx com certificado já emitido (certbot/ACME) |

Depois de ativar o TLS:

```bash
MERIDIAN_PUBLIC_URL=https://bi.suaempresa.com
MERIDIAN_SECURE_COOKIE=1
MERIDIAN_TRUST_PROXY=1
```

- `MERIDIAN_PUBLIC_URL` também é usado para montar o `redirect_uri` do SSO.
- Sem `MERIDIAN_SECURE_COOKIE=1` o cookie de sessão viaja sem `Secure`; em HTTP
  local isso é aceitável, em produção não.
- O proxy deve preservar `Host`, `X-Forwarded-Proto` e `X-Forwarded-For`.

Em Docker, o proxy precisa estar na mesma rede do serviço `app` e usar
`reverse_proxy app:4173` (Caddy) ou `proxy_pass http://app:4173` (Nginx).

## Backup

```bash
DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/meridian ./scripts/backup.sh
```

O script grava:

- `meridian.dump` (pg_dump custom, quando `DATABASE_URL` e `pg_dump` existem);
- `arquivos.tar.gz` com `data/`, `config/` e `logs/`;
- checksums SHA-256 e `manifest.txt`.

Agendamento diário sugerido:

```cron
30 2 * * * cd /opt/meridian && DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/meridian ./scripts/backup.sh >> /var/log/meridian-backup.log 2>&1
```

Retenção local padrão: 14 dias (`BACKUP_KEEP_DAYS`). Replique o diretório para
storage externo (S3, Blob, NAS) e teste a restauração trimestralmente:

```bash
# PostgreSQL
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" meridian.dump
# Arquivos
tar -xzf arquivos.tar.gz -C /caminho/da/instalacao
```

O backup contém dados de negócio e `config/usuarios.json`: trate o diretório como
material sensível e restrinja o acesso.
