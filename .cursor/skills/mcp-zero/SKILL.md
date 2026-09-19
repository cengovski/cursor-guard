---
name: mcp-zero
description: Use when the user mentions MCP, tool schema, token, kota, GitHub MCP, Figma, disable tools. Keep MCP off; prefer CLI.
---
# MCP Zero
- Varsayılan: MCP çağırma. Yeni sunucu ekleme.
- GitHub/PR → `gh` veya `origin`. Filesystem MCP yok (workspace açık).
- Açık tool varsa sadece adı geçen; keşif turu yok.
- Sonuç: özet, ham JSON/log/screenshot yok. 2 başarısız çağrı → dur.
- Proje şablonu: `.cursor/mcp.json` boş obje; allowlist boş.
