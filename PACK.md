# PACK

Diğer agent’a yapıştır. Origin clone gerekmez.

===== .cursorignore =====
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

===== .gitignore =====
node_modules/
dist/
build/
.next/
coverage/
*.log
*.sql
*.sqlite
*.dump
.env
.env.*
!.env.example
.DS_Store

===== .cursor/mcp.json =====
{
  "mcpServers": {}
}

===== .cursor/permissions.json =====
{
  "mcpAllowlist": []
}

===== .cursor/rules/01-cheap-default.mdc =====
---
description: Cheap Pro defaults
alwaysApply: true
---
En küçük patch. Diff üret, dosyayı baştan yazma.
Ignore/build/generated okuma. İstenmeyen dosyaya dokunma.
Dep/refactor/yeni feature yok (istenmedikçe). Belirsizse sor.
Kısa cevap. MCP çağırma; terminal/gh/dosya yeterse onu kullan.

===== .cursor/rules/02-frontend.mdc =====
---
description: UI and component conventions
globs: "**/*.{tsx,jsx,vue,css}"
alwaysApply: false
---
Mevcut pattern. Küçük komponent. Bir section = bir iş.
Mobil + desktop. Gerçek copy; lorem yok.

===== .cursor/rules/03-api.mdc =====
---
description: API route and server handler conventions
globs: "**/api/**"
alwaysApply: false
---
Doğrula → işle → net status/body.
Client’a secret/stack sızdırma.

===== .cursor/rules/04-test.mdc =====
---
description: Test yazımı veya test dosyası düzenlenirken kullan
alwaysApply: false
---
Vitest. Davranış testi; implementation mock şişirme.
Sadece değişen davranış. Full suite yok (istenmedikçe).

===== .cursor/skills/apply-pack/SKILL.md =====
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

===== .cursor/skills/cheap-agent/SKILL.md =====
---
name: cheap-agent
description: Use for any coding task, feature, bugfix, refactor, or agent run. Enforces cheap Cursor Pro workflow, Composer-first, tight context, no expensive models unless asked.
---
# Cheap Agent (Pro)
## Model
- Composer 2.5, Fast OFF.
- Claude/GPT/Gemini/Opus/Fable/Grok Fast/Composer Fast yok (kullanıcı adını söylemeden).
- Belirsizse 1–3 soru. Uzun explore yok.
## Context
- Sadece gereken dosya. @file + hedefli search.
- Okuma: node_modules, dist, build, .next, coverage, lock, dump, generated.
- MCP çağırma. Terminal/gh/workspace yeterse onu kullan. Tool sonucunu özetle.
- Kısa cevap. Diff; full-file rewrite yok.
## Workflow
1. 3 satır: hedef + dosyalar.
2. 3+ dosya veya bulanık spec → kısa plan (istendiyse bekle).
3. En küçük değişiklik.
4. Test varsa sadece ilgili test.
5. Özet: değişen dosyalar, nasıl test, dokunulmayan.
## Stop
- İstenen iş bitince dur. Drive-by yok.
- Aynı hata 2 deneme → dur, kök neden 5 satır; yeni patch yok.
- Yeni konu = yeni chat.

===== .cursor/skills/mcp-zero/SKILL.md =====
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

===== .cursor/skills/plan-then-build/SKILL.md =====
---
name: plan-then-build
description: Use when the user wants a feature, migration, multi-file change, or says plan, tasarla, implement et, feature ekle. Plan first, then implement with a cheap model.
---
# Plan Then Build
1. Eksik kısıt: max 3 soru.
2. Numaralı plan: dosyalar, adımlar, risk, kapsam dışı.
3. "Önce plan" veya 3+ dosya → onay bekle, kod yazma.
4. Composer 2.5; bir adım.
5. Adım sonu: ne değişti + sonraki.
6. Feature bitince sohbeti şişirme; yeni chat.

===== .cursor/skills/setup-cursor-pro/SKILL.md =====
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

===== .cursor/skills/tight-fix/SKILL.md =====
---
name: tight-fix
description: Use for bug, error, stack trace, broken test, lint error, type error, or "şunu düzelt". Minimal patch only.
---
# Tight Fix
1. Hata/testten üret. Sadece kırılan dosya + doğrudan caller.
2. En küçük patch. Komşu refactor yok.
3. Harness varsa tek odaklı test; full suite yok.
4. 2 denemede kapanmazsa dur; kök neden 5 satır.
5. Cevap: neden, patch, nasıl doğrula.
