---
name: apply-pack
description: Use when copying cursor-guard into another repo, first-launch setup, arctic-animals-web, or "bu ayarları kopyala". Writes pack files without cloning Origin.
---
# Apply Pack
Kaynak: bu workspace’teki dosyalar veya `PACK.md`.
1. Aşağıdakileri yaz (yoksa oluştur). Mevcut uzun `.cursorrules` silme.
2. Skill klasör adı = YAML `name`. `SKILL.md` dışında script yok.
3. MCP sunucusu ekleme.
4. Extra alwaysApply ekleme.
5. Bitince kopyalanan yolları listele.
Dosyalar: `.cursorignore`, `.gitignore`, `.cursor/mcp.json`, `.cursor/permissions.json`, `.cursor/rules/*.mdc`, `.cursor/skills/*/SKILL.md`.
