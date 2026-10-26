# Validation assets

These assets were retrieved from the official GİB technical package links on 2026-10-23. `official-manifest.json` records package URLs and SHA-256 checksums and the exact hashes of bundled files.

- `xsd`: unmodified runtime UBL-TR 1.2.1 schemas for UBL 2.1 Invoice and DespatchAdvice, with their local common schema dependencies, from `UBL-TR1.2.1_Paketi.zip`.
- `schematron/source`: the unmodified GİB main, common and code-list Schematron documents. The package history's latest entry is `20260701`.
- `schematron/compiler`: MIT-licensed ISO Schematron skeleton compiler, pinned to Schematron/schematron commit `77dcd36c53d12ed786c144ece3b2af7694abdc56`. Copyright and license notices remain in each file.
- `schematron/UBL-TR-20260701.xsl`: generated from all main schema rules using include expansion, abstract-rule expansion and ISO SVRL compilation, with no assertions removed. The runtime sets the documented GİB `type` parameter to `efatura` or `earchive`; the latter checks the EARSIVFATURA Invoice profile.

The separate e-Arşiv reporting package `earsiv_paket_v1.1_9.zip` defines reporting/web-service formats. It is recorded as a reference and is not claimed to be implemented by the UBL Invoice validator.

The original OASIS notices embedded in the XSD files are preserved. The GİB Schematron package does not state a separate redistribution license; the package is identified as GİB's published technical validation material, without asserting an additional open-source license or transferring rights.

Provision Java dependencies explicitly with `php scripts/install-edocument-runtime.php` from `backend`. `runtime-manifest.json` pins Saxon-HE 12.10 (MPL-2.0) and XML Resolver 5.3.3 (Apache-2.0) files from Maven Central. JARs are stored under ignored application storage, and the application never downloads them during validation. The source-file Java launcher requires a JDK, version 11 or later. CI uses JDK 21. Validation fails closed if the verified runtime is missing.

XML documents never supply schema or stylesheet paths. The packaged stylesheet runs with external entities, DTDs, external URI resolution and extension execution disabled. Neither XSD nor Schematron validation verifies a certificate chain, electronic signature authenticity, authority acceptance or legal delivery. Sandbox generation uses an explicit unsigned marker and does not fabricate a cryptographic signature.
