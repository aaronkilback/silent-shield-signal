import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

function jobBlock(source: string, jobKey: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobKey}:`);
  if (start === -1) throw new Error(`job "${jobKey}" not found`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

function stepBlock(source: string, stepName: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  if (start === -1) throw new Error(`step "${stepName}" not found`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {6}- /.test(lines[i]) || /^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join('\n');
}

const requiredEnvKeys = [
  'CI',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'TEST_INVARIANT_USER_A_EMAIL',
  'TEST_INVARIANT_USER_A_PASSWORD',
  'TEST_INVARIANT_USER_B_EMAIL',
  'TEST_INVARIANT_USER_B_PASSWORD',
] as const;

describe('staging CI workflow validity', () => {
  it('keeps the unit-tests step to exactly one env block with the required invariant inputs', () => {
    const unitTestsJob = jobBlock(workflow, 'unit-tests');
    const vitestStep = stepBlock(unitTestsJob, 'Run Vitest unit tests');

    const envBlocks = vitestStep.match(/^ {8}env:\s*$/gm) ?? [];
    expect(envBlocks).toHaveLength(1);

    for (const key of requiredEnvKeys) {
      expect(vitestStep).toMatch(new RegExp(`^ {10}${key}:`, 'm'));
    }
  });
});
