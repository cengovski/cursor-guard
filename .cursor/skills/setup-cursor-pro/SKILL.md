---
name: setup-cursor-pro
description: Use when the user says Cursor kurulumu, ignore, rules, kota, Pro setup, optimize editor. Creates lean ignore and one short always-on rule.
---
# Setup Cursor Pro
Sadece eksikse oluştur. Extra alwaysApply yok. Skill gövdesini rule’a kopyalama.
A) `.cursorignore`
node_modules/
dist/
build/
.next/
coverage/
*.log
*.lock
.env
.env.*
!.env.example
B) `.cursor/mcp.json` → `{"mcpServers":{}}`
C) `.cursor/permissions.json` → `{"mcpAllowlist":[]}`
D) `.cursor/rules/01-cheap-default.mdc`
---
description: Cheap Pro defaults
alwaysApply: true
---
En küçük patch. Diff üret, dosyayı baştan yazma.
Ignore/build/generated okuma. İstenmeyen dosyaya dokunma.
Dep/refactor/yeni feature yok (istenmedikçe). Belirsizse sor.
Kısa cevap. MCP çağırma; terminal/gh/dosya yeterse onu kullan.
