# English common dictionary

`common-en.json` is an adapted frequency asset from **wordfreq 3.1.1**, by
**Robyn Speer**. The asset is licensed **CC BY-SA 4.0**, separately from the
MIT-licensed plugin code. It is a filtered, normalized, truncated selection
of 20,000 English entries with corpus frequencies; it is not the complete
wordfreq dataset. The source data reflects usage through approximately 2021.

Source: https://pypi.org/project/wordfreq/3.1.1/
Upstream: https://github.com/rspeer/wordfreq
License: https://creativecommons.org/licenses/by-sa/4.0/

See `provenance.json` for input/output SHA-256 hashes. Rebuild using
`python -m pip download wordfreq==3.1.1 msgpack --no-deps --dest artifacts`,
then `python scripts/build-dictionary.py`. Python/msgpack are build tools only.

The upstream attribution notice is preserved in `licenses/wordfreq-NOTICE.md`;
the full data license is in `licenses/wordfreq-CC-BY-SA-4.0.txt`. The notice was
retrieved from upstream master on 2026-10-28 because there is no v3.1.1 Git tag.
Credit includes Google Books Ngrams, Wikipedia, ParaCrawl, Leeds Internet Corpus,
OpenSubtitles, and the freely available SUBTLEX datasets by Marc Brysbaert et al.
See the upstream notice for their links and complete terms.
