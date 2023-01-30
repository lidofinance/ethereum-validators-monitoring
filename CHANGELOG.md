## [4.2.2](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.2.1...4.2.2) (2023-01-30)


### Bug Fixes

* get balance diff in rewards query ([#125](https://github.com/lidofinance/ethereum-validators-monitoring/issues/125)) ([222ff20](https://github.com/lidofinance/ethereum-validators-monitoring/commit/222ff2065ccaf31e39a107f4c383318f02c27261))



## [4.2.1](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.2.0...4.2.1) (2023-01-30)


### Bug Fixes

* average chain rewards metric ([#123](https://github.com/lidofinance/ethereum-validators-monitoring/issues/123)) ([c8035ae](https://github.com/lidofinance/ethereum-validators-monitoring/commit/c8035ae93aecbf7828bb8d75265d636b2c37ce71))
* keys registry processing ([#119](https://github.com/lidofinance/ethereum-validators-monitoring/issues/119)) ([257ef29](https://github.com/lidofinance/ethereum-validators-monitoring/commit/257ef2935f7c25642545a53aaa1a7a46cd7d6b37))
* long loops ([#120](https://github.com/lidofinance/ethereum-validators-monitoring/issues/120)) ([8f11298](https://github.com/lidofinance/ethereum-validators-monitoring/commit/8f112983e7955f14c2f8bec46c5ce4001edfb7bb))
* remove outdated metrics ([#118](https://github.com/lidofinance/ethereum-validators-monitoring/issues/118)) ([398cf16](https://github.com/lidofinance/ethereum-validators-monitoring/commit/398cf16ea4fa4f65764dd530b6ac417680254f71))


### Reverts

* Revert "fix: long loops" (#121) ([4f8fbaf](https://github.com/lidofinance/ethereum-validators-monitoring/commit/4f8fbaf37a465c4fba8947e424fc041d85f2710e)), closes [#121](https://github.com/lidofinance/ethereum-validators-monitoring/issues/121)



# [4.2.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.1.2...4.2.0) (2023-01-23)


### Bug Fixes

* att participation rate ([#114](https://github.com/lidofinance/ethereum-validators-monitoring/issues/114)) ([10e928c](https://github.com/lidofinance/ethereum-validators-monitoring/commit/10e928c1b0c5f01412f236c8f643e44cb19a5340))
* attestation and proposal rewards calculation error ([#110](https://github.com/lidofinance/ethereum-validators-monitoring/issues/110)) ([140a3f2](https://github.com/lidofinance/ethereum-validators-monitoring/commit/140a3f20c8a917059df76cf49d198c0ae0b694c3))
* event loop lag ([#115](https://github.com/lidofinance/ethereum-validators-monitoring/issues/115)) ([0135d0e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/0135d0edec5e5254fd094b1fb48e2310c860678d))
* optional `high-reward-validators` task ([#113](https://github.com/lidofinance/ethereum-validators-monitoring/issues/113)) ([b275062](https://github.com/lidofinance/ethereum-validators-monitoring/commit/b275062b67806a206a3e738737121873edb4bfc3))
* remove unnecessary use of BigNumber ([#111](https://github.com/lidofinance/ethereum-validators-monitoring/issues/111)) ([917c0b4](https://github.com/lidofinance/ethereum-validators-monitoring/commit/917c0b4e6f50c3ff22b8f75fc4f505111161d424))


### Features

* speed up writing to DB ([#106](https://github.com/lidofinance/ethereum-validators-monitoring/issues/106)) ([5f46711](https://github.com/lidofinance/ethereum-validators-monitoring/commit/5f46711f2feaaf2978e33d68d47dc81b8163f4b8))
* use BigNumber ([#108](https://github.com/lidofinance/ethereum-validators-monitoring/issues/108)) ([325ab92](https://github.com/lidofinance/ethereum-validators-monitoring/commit/325ab92cb2cc082f2525280215b2ffbb39615ea5))



## [4.1.2](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.1.1...4.1.2) (2023-01-10)


### Bug Fixes

* `getEpochDataToProcess` condition ([#103](https://github.com/lidofinance/ethereum-validators-monitoring/issues/103)) ([18971c5](https://github.com/lidofinance/ethereum-validators-monitoring/commit/18971c53b995c5c37e21bae28277f910a5bdabcd))



## [4.1.1](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.1.0...4.1.1) (2023-01-10)


### Bug Fixes

* add async notation for api request callbacks ([#100](https://github.com/lidofinance/ethereum-validators-monitoring/issues/100)) ([74a946e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/74a946ec593d1cbbdd56cf53387defef04051eb6))



# [4.1.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.0.3...4.1.0) (2023-01-10)


### Features

* Develop ([#96](https://github.com/lidofinance/ethereum-validators-monitoring/issues/96)) ([0981e34](https://github.com/lidofinance/ethereum-validators-monitoring/commit/0981e345109ffe69a823396906b618fc5582f10b)), closes [#86](https://github.com/lidofinance/ethereum-validators-monitoring/issues/86) [#87](https://github.com/lidofinance/ethereum-validators-monitoring/issues/87) [#85](https://github.com/lidofinance/ethereum-validators-monitoring/issues/85) [#89](https://github.com/lidofinance/ethereum-validators-monitoring/issues/89) [#91](https://github.com/lidofinance/ethereum-validators-monitoring/issues/91) [#93](https://github.com/lidofinance/ethereum-validators-monitoring/issues/93) [#95](https://github.com/lidofinance/ethereum-validators-monitoring/issues/95) [#90](https://github.com/lidofinance/ethereum-validators-monitoring/issues/90)



## [4.0.3](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.0.2...4.0.3) (2022-12-08)


### Bug Fixes

* 'operator_balance_24h_difference' metric ([#82](https://github.com/lidofinance/ethereum-validators-monitoring/issues/82)) ([9619376](https://github.com/lidofinance/ethereum-validators-monitoring/commit/961937621ebbd287bec0b4a2ad463522f4392b93))



## [4.0.2](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.0.1...4.0.2) (2022-11-29)


### Bug Fixes

* compose, readme ([1bcfddd](https://github.com/lidofinance/ethereum-validators-monitoring/commit/1bcfddd62b1a52e80d41191064b300b9ac00027c))
* DB_NAME and other DB env vars now make sense ([ca44ece](https://github.com/lidofinance/ethereum-validators-monitoring/commit/ca44ece380730b73e9168054afe1867549e925aa))
* fantom alert ([b6bb128](https://github.com/lidofinance/ethereum-validators-monitoring/commit/b6bb128d75459ee891264f7d8e0cd46c0d902b54))
* health check ([a456793](https://github.com/lidofinance/ethereum-validators-monitoring/commit/a456793faab1d67ed7221524553249dea8bc44a6))



## [4.0.1](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.0.0...4.0.1) (2022-11-22)


### Bug Fixes

* clear cache ([#71](https://github.com/lidofinance/ethereum-validators-monitoring/issues/71)) ([8d38ef3](https://github.com/lidofinance/ethereum-validators-monitoring/commit/8d38ef3ed60f81ee162509bf0a455b4b6e9e903e))



# [4.0.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/3.3.1...4.0.0) (2022-11-21)


### Bug Fixes

* critical alerts ([#63](https://github.com/lidofinance/ethereum-validators-monitoring/issues/63)) ([38f3785](https://github.com/lidofinance/ethereum-validators-monitoring/commit/38f3785b76e9af61c01eebe65973c4ceaa2b2c43))
* fetching possible high reward validators ([#58](https://github.com/lidofinance/ethereum-validators-monitoring/issues/58)) ([a7466a0](https://github.com/lidofinance/ethereum-validators-monitoring/commit/a7466a08fb3e96d46d8f3418b8e4b66bb86e1dce))


### Features

* add fires count to alerts footer ([#60](https://github.com/lidofinance/ethereum-validators-monitoring/issues/60)) ([dc608bc](https://github.com/lidofinance/ethereum-validators-monitoring/commit/dc608bcd13de53ce132318e30f8f0bcd2bbef700))
* add footer to discord alerts ([#59](https://github.com/lidofinance/ethereum-validators-monitoring/issues/59)) ([4ae8f64](https://github.com/lidofinance/ethereum-validators-monitoring/commit/4ae8f640e49114effe5eef23fb122c045db5e971))
* metrics, change panels source ([#61](https://github.com/lidofinance/ethereum-validators-monitoring/issues/61)) ([064fb45](https://github.com/lidofinance/ethereum-validators-monitoring/commit/064fb451b1e627b6f1a46c5b0aaf28fc3b37cabe))
* support telegram alerts ([#57](https://github.com/lidofinance/ethereum-validators-monitoring/issues/57)) ([383adfb](https://github.com/lidofinance/ethereum-validators-monitoring/commit/383adfbc56ca0c171bf8c01acb539c2e26975a78))



