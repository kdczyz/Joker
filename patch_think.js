const fs = require('fs');
const path = '/Users/a1412/Desktop/Rcode/Rcode/src/adapters/model/cloudcode-openai-adapter.ts';
let content = fs.readFileSync(path, 'utf8');

const injection = `
  if (input.reasoning_effort && input.reasoning_effort !== 'off') {
    system.push('Before taking action or responding, please think step-by-step and wrap your thinking process strictly inside <think> and </think> tags.');
  }
`;

content = content.replace(
  "  const toolNameById = new Map<string, string>()",
  injection.trim() + "\n\n  const toolNameById = new Map<string, string>()"
);

fs.writeFileSync(path, content, 'utf8');
