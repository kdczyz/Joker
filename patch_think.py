import os

path = '/Users/a1412/Desktop/Rcode/Rcode/src/adapters/model/cloudcode-openai-adapter.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

injection = """  if (input.reasoning_effort && input.reasoning_effort !== 'off') {
    system.push('Before taking action or responding, please think step-by-step and wrap your thinking process strictly inside <think> and </think> tags. Do not skip this step.');
  }"""

content = content.replace(
    "  const toolNameById = new Map<string, string>()",
    injection + "\n\n  const toolNameById = new Map<string, string>()"
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
