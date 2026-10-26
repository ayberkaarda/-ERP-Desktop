# ADR 0001: Modüler monolit

- Durum: Kabul edildi
- Tarih: 2026-10-21

## Bağlam

Keystone ERP, tutarlı işlemlere ve sade yerel geliştirmeye ihtiyaç duyar; aynı zamanda iş alanlarının birbirinden bağımsız sınırlar içinde gelişmesi gerekir.

## Karar

Sistem tek uygulama ve dağıtım birimi olarak modüler monolit biçiminde kurulur. Ortak yetenekler `Core` içinde, iş kuralları ise kendi modüllerinde tutulur. Modüller arası erişim yalnızca `Contracts` üzerinden yapılır.

## Sonuçlar

Tek dağıtım ve işlem sınırları başlangıçta operasyonu sadeleştirir. Modül sınırları korunmazsa iç bağımlılıklar zamanla artar; doğrudan modül içi erişim yasaktır.
