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
