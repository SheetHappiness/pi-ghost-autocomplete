# Third-party notices

This plugin contains modified MIT-licensed OMP code from can1357/oh-my-pi, commit
45c35e40c46166dc726ccc52f5d27f40f2449f99. Original copyright and full terms are in
licenses/OMP-MIT.txt. File-specific changes are recorded in vendor/omp/PROVENANCE.md.

SmolLM2-135M by HuggingFaceTB and its QuantFactory Q8_0 conversion are licensed
under Apache-2.0. Weights are downloaded separately, never bundled here.
licenses/SmolLM2-APACHE-2.0.txt retains the license; pinned model cards, source URLs,
and their content digests are retained in licenses/model-provenance.json.

Platform packages contain the Rust dependency inventory and corresponding license
files under licenses/rust/. Pi is a host-provided peer and is not redistributed
inside this package. Native source is in native/ in the source distribution.

# English frequency dictionary

The adapted `src/dictionary/common-en.json` asset comes from wordfreq 3.1.1
by Robyn Speer and is licensed CC BY-SA 4.0. See
`src/dictionary/PROVENANCE.md`, `src/dictionary/provenance.json`,
`licenses/wordfreq-NOTICE.md`, and `licenses/wordfreq-CC-BY-SA-4.0.txt`.
This data license is separate from the plugin code license.
