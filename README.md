# cursor-guard

Cursor Pro kota paketi. Tek always-on rule, boş MCP, Composer-first skills.

## Diğer agent — ilk mesaj

`PACK.md` içeriğini olduğu gibi yapıştır. Origin/token gerekmez.

Kısa yol:

```text
/apply-pack
PACK.md’deki dosyaları bu workspace’e yaz.
Mevcut uzun .cursorrules silme. MCP ekleme.
Bitince kopyalanan yolları listele.
```

## Bu repoda ne var

| Path | Rol |
|---|---|
| `.cursorignore` | Index/token keser |
| `.gitignore` | Git gürültüsü |
| `.cursor/mcp.json` | `mcpServers: {}` |
| `.cursor/permissions.json` | Boş allowlist |
| `.cursor/rules/01-cheap-default.mdc` | Tek `alwaysApply` |
| `.cursor/rules/02–04` | glob / description |
| `.cursor/skills/*` | cheap-agent, tight-fix, plan-then-build, setup-cursor-pro, mcp-zero, apply-pack |

## Model (istemci)

Composer 2.5, Fast kapalı. Auto/Opus/Claude pinleme. Bu dosyadan ayarlanmaz.

## Klon (opsiyonel, WSL)

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
origin repo clone dzengo/cursor-guard
```

Browse: https://cursor.com/codebase/dzengo/cursor-guard
