# ADR 0003: Tek depo ve masaüstü istemci ayrımı

- Durum: Kabul edildi
- Tarih: 2026-10-21

## Bağlam

Web istemcisi ve sunucu tarafı API aynı ürün sözleşmesini paylaşırken masaüstü istemcisi ayrı dağıtım ihtiyaçlarına sahiptir.

## Karar

Backend ve frontend tek monorepo içinde tutulur. Masaüstü istemcisi aynı ürün ve API sözleşmelerini kullanan ayrı bir istemci olarak geliştirilir; sunucu iş kuralları masaüstü katmanına taşınmaz.

## Sonuçlar

Paylaşılan OpenAPI sözleşmesi istemciler arasında uyumu destekler. Masaüstü dağıtım ve yerel çalışma kararları ayrı ADR'lerle belgelenebilir.
