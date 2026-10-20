# Keystone ERP

Keystone ERP, şirket operasyonları için tasarlanan modüler bir monolittir. Depoda Laravel API `backend/`, web istemcisi ise `frontend/` altında bulunur.

## Gereksinimler

- PHP 8.4 ve Composer
- Node.js 22 ve npm
- Docker Compose

## Yerel geliştirme

Windows'ta `dev.bat` komutu PostgreSQL, Redis, Mailpit ve MinIO'yu başlatır; ardından API, Reverb, kuyruk, zamanlayıcı ve frontend işlemlerini ayrı pencerelerde açar. API `http://localhost:8000`, Vite 5173 portundadır. Mailpit arayüzü `http://localhost:8025`, MinIO konsolu `http://localhost:9001` adresindedir.

Yalnızca altyapıyı başlatmak için `docker compose up -d` komutunu çalıştırın. PostgreSQL veritabanı `keystone`, kullanıcı `keystone`, parola `keystone` değerlerini kullanır. İlk başlatmada init betiği `keystone_test` veritabanını oluşturur ve `pg_trgm` ile `pgcrypto` eklentilerini açar.

## Mühendislik

[Mühendislik Kuralları](docs/ENGINEERING-RULES.md), [Mimari](docs/ARCHITECTURE.md) ve [Yol Haritası](docs/ROADMAP.md) belgelerini okuyun. Güncel teslim durumu [İlerleme](docs/PROGRESS.md) dosyasında, mimari kararlar `docs/adr/` altında tutulur.

API temel yolu `/api/v1`'dir. Başarılı yanıtlar `data`, hatalar `errors` zarfını kullanır. Üretilen OpenAPI şeması ve frontend API türleri commit edilmez; backend bağımlılıkları kurulduktan sonra `npm run gen:api` çalıştırın.
