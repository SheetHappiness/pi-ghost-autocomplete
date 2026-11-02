"""Build the bundled asset from pinned wheels. Build-time only; no runtime Python."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import zipfile

root = Path(__file__).resolve().parent.parent
wheel = root / 'artifacts/wordfreq-3.1.1-py3-none-any.whl'
assert hashlib.sha256(wheel.read_bytes()).hexdigest() == '4b1c6ecffc6198be3396d5cf871c4423ca71c907c231348d352dd54d62b97473', 'Unexpected wordfreq wheel digest'
decoder = next((root / 'artifacts').glob('msgpack-*.whl'))
modules = root / 'artifacts/dictionary-build-modules'
with zipfile.ZipFile(decoder) as z:
    z.extractall(modules)
sys.path.insert(0, str(modules))
import msgpack

with zipfile.ZipFile(wheel) as z:
    raw = z.read('wordfreq/data/large_en.msgpack.gz')
bins = msgpack.unpackb(gzip.decompress(raw), raw=False)
assert bins[0] == {'format': 'cB', 'version': 1}
words = {}
for cb, bucket in enumerate(bins[1:]):
    for raw_word in bucket:
        word = unicodedata.normalize('NFC', raw_word).replace('’', "'").lower()
        # English asset: ASCII words and internal apostrophes; personal layer is Unicode.
        if re.fullmatch("[a-z]+(?:'[a-z]+)*", word) and 2 <= len(word) <= 64:
            words.setdefault(word, float(format(10 ** (-cb / 100), '.8g')))
        if len(words) >= 20000:
            break
    if len(words) >= 20000:
        break
target = root / 'src/dictionary/common-en.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(sorted(words.items()), ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
provenance = {
    'source': 'https://pypi.org/project/wordfreq/3.1.1/',
    'author': 'Robyn Speer', 'version': '3.1.1',
    'wheelSha256': hashlib.sha256(wheel.read_bytes()).hexdigest(),
    'input': 'wordfreq/data/large_en.msgpack.gz',
    'inputSha256': hashlib.sha256(raw).hexdigest(),
    'outputSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    'words': len(words), 'license': 'CC-BY-SA-4.0',
}
(root / 'src/dictionary/provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
print(json.dumps(provenance, indent=2))
