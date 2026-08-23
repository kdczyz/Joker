import os

path1 = '/Users/a1412/Desktop/Rcode/Rcode/src/adapters/model/compat-request-codecs.ts'
path2 = '/Users/a1412/Desktop/Rcode/Rcode/src/adapters/model/cloudcode-openai-adapter.ts'

with open(path1, 'r', encoding='utf-8') as f:
    c1 = f.read()

import re
match = re.search(r'const CLOUDCODE_MODEL_ALIASES: Record<string, string> = \{([\s\S]*?)\n\}', c1)
if not match:
    print("Not found in path1")
    exit(1)
aliases_block = match.group(0)

with open(path2, 'r', encoding='utf-8') as f:
    c2 = f.read()

c2 = re.sub(
    r'const CLOUDCODE_MODEL_ALIASES: Record<string, string> = \{([\s\S]*?)\n\}',
    aliases_block,
    c2
)

with open(path2, 'w', encoding='utf-8') as f:
    f.write(c2)
print("Done")
