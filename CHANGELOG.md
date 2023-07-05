# [4.4.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.3...4.4.0) (2023-07-05)


### Bug Fixes

* add label to metric ([#178](https://github.com/lidofinance/ethereum-validators-monitoring/issues/178)) ([e324034](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e324034394d7e81030110d988db8ecbbd9c90c9d))
* unused module init ([#182](https://github.com/lidofinance/ethereum-validators-monitoring/issues/182)) ([#184](https://github.com/lidofinance/ethereum-validators-monitoring/issues/184)) ([f243331](https://github.com/lidofinance/ethereum-validators-monitoring/commit/f2433314502cacbd66a6c06ea348bd97d260f189))


### Features

* keys-api interface ([#177](https://github.com/lidofinance/ethereum-validators-monitoring/issues/177)) ([4815355](https://github.com/lidofinance/ethereum-validators-monitoring/commit/481535586424c2c0fae5ccf1fd75f06f62a87cfe))
* stuck keys ([#170](https://github.com/lidofinance/ethereum-validators-monitoring/issues/170)) ([8a9bd2d](https://github.com/lidofinance/ethereum-validators-monitoring/commit/8a9bd2db6ce9c930d36a7367e71598717fa738ca))
* VALIDATOR_USE_STUCK_KEYS_FILE, readme ([#175](https://github.com/lidofinance/ethereum-validators-monitoring/issues/175)) ([3bd8174](https://github.com/lidofinance/ethereum-validators-monitoring/commit/3bd8174b0e82f73508f57d89ab8c35a2f725bea5))



## [4.3.3](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.2...4.3.3) (2023-04-14)


### Bug Fixes

* critical slashing alert ([#159](https://github.com/lidofinance/ethereum-validators-monitoring/issues/159)) ([006ec38](https://github.com/lidofinance/ethereum-validators-monitoring/commit/006ec380f56446e1c7e1f0770078a89e65bec27b))
* penalty calculation for `active_slashed` ([#160](https://github.com/lidofinance/ethereum-validators-monitoring/issues/160)) ([46be064](https://github.com/lidofinance/ethereum-validators-monitoring/commit/46be064c612debd845337e47ca2be74818497999))



## [4.3.2](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.1...4.3.2) (2023-04-11)


### Bug Fixes

* ignore cache while fetching data from head ([#155](https://github.com/lidofinance/ethereum-validators-monitoring/issues/155)) ([bddfdef](https://github.com/lidofinance/ethereum-validators-monitoring/commit/bddfdefcbb84171ba648f421bc03a7130289b397))



## [4.3.1](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.0...4.3.1) (2023-04-05)


### Bug Fixes

* too wide queries with withdrawals ([#150](https://github.com/lidofinance/ethereum-validators-monitoring/issues/150)) ([d674e03](https://github.com/lidofinance/ethereum-validators-monitoring/commit/d674e03ae201618c6ad970fb2e8c166eb624e3aa))



# [4.3.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.2.2...4.3.0) (2023-04-05)


### Bug Fixes

* double accounting ([#138](https://github.com/lidofinance/ethereum-validators-monitoring/issues/138)) ([e85d73e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e85d73e46ac26c0b5e488825092d9f2945004e79)), closes [#139](https://github.com/lidofinance/ethereum-validators-monitoring/issues/139)
* fix get committees streams ([#143](https://github.com/lidofinance/ethereum-validators-monitoring/issues/143)) ([b0442e9](https://github.com/lidofinance/ethereum-validators-monitoring/commit/b0442e9946d0bf266708f8e326b91adb571872f1))
* remove 'finalized' condition ([#135](https://github.com/lidofinance/ethereum-validators-monitoring/issues/135)) ([ef94603](https://github.com/lidofinance/ethereum-validators-monitoring/commit/ef94603eca5b138287490365b91994e36644011d))
* tune butches size ([#140](https://github.com/lidofinance/ethereum-validators-monitoring/issues/140)) ([06202bb](https://github.com/lidofinance/ethereum-validators-monitoring/commit/06202bb1d0635cce85c2dbc3be4f068e833b2e7c))
* tune chunks size ([#142](https://github.com/lidofinance/ethereum-validators-monitoring/issues/142)) ([e9168ab](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e9168ab57918b04466c14965714e6b66534a49e8))
* tune finalized condition ([#136](https://github.com/lidofinance/ethereum-validators-monitoring/issues/136)) ([353d81d](https://github.com/lidofinance/ethereum-validators-monitoring/commit/353d81dd9c681c7c9ec13aebafc243fbf8f4a278))
* tune getAttestationCommittees ([#141](https://github.com/lidofinance/ethereum-validators-monitoring/issues/141)) ([5caf4e1](https://github.com/lidofinance/ethereum-validators-monitoring/commit/5caf4e119894cfb7aa8dfd402c0edcdf0e7ba5dc))
* withdrawal status ([#147](https://github.com/lidofinance/ethereum-validators-monitoring/issues/147)) ([f6806db](https://github.com/lidofinance/ethereum-validators-monitoring/commit/f6806dbeb514d96fe8349b1da4312bba5e1b854d))


### Features

* change dashboards for withdrawals ([#137](https://github.com/lidofinance/ethereum-validators-monitoring/issues/137)) ([0961ffd](https://github.com/lidofinance/ethereum-validators-monitoring/commit/0961ffd4e279c4afb0ce04050eb7077740fc6638))
* throw last error ([#145](https://github.com/lidofinance/ethereum-validators-monitoring/issues/145)) ([21bf527](https://github.com/lidofinance/ethereum-validators-monitoring/commit/21bf5279d933f88faf85b28f004dc8ca3aec8444))
* withdrawals ([#133](https://github.com/lidofinance/ethereum-validators-monitoring/issues/133)) ([e724d06](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e724d06715646cad8f1ce7b5f46965435a463af4))



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



