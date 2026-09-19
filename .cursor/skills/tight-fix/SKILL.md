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
