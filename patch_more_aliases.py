import os
import re

files = [
    '/Users/a1412/Desktop/Rcode/Rcode/src/adapters/model/compat-request-codecs.ts',
    '/Users/a1412/Desktop/Rcode/Rcode/src/adapters/model/cloudcode-openai-adapter.ts'
]

additions = """  'gemini-2.5-pro': 'gemini-pro-agent',
  'gemini-2.5-flash': 'gemini-3-flash',"""

for path in files:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    content = content.replace(
        "  'gemini-3-pro': 'gemini-pro-agent',",
        f"  'gemini-3-pro': 'gemini-pro-agent',\n{additions}"
    )
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

print("Done")
