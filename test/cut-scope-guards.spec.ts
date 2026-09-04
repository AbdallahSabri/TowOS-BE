import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserRole } from '../src/modules/identity/roles/user-role.enum.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * BE-SPEC §13: "Write these as tests or lint rules in Phase 0, before there
 * is anything to catch." The import-based guards (no scheduler package, no
 * notification SDK) live in .dependency-cruiser.js; the bare-setInterval
 * guard lives in eslint.config.mjs (no-restricted-globals) - neither is an
 * import-graph or AST concern in the way this file's checks are: these scan
 * migration column names, TS identifier names, and package.json itself,
 * none of which dependency-cruiser or a single eslint rule can express.
 *
 * Word matching is segment-based (split on snake_case/camelCase boundaries,
 * then exact-match each segment), not substring search - a substring check
 * for "rate" would false-positive on "operate", and "total" would
 * false-positive inside "subtotal" joined without a separator. This is
 * deliberately a heuristic over identifier names, not a semantic analysis:
 * broad enough to catch the obvious cases without being so broad it flags
 * unrelated code and gets disabled out of frustration.
 */

function normalizedSegments(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function findForbiddenWord(identifier: string, words: string[]): string | null {
  const segments = normalizedSegments(identifier);
  for (const word of words) {
    const wordSegments = word.toLowerCase().split('_');
    for (let i = 0; i <= segments.length - wordSegments.length; i++) {
      if (wordSegments.every((w, j) => segments[i + j] === w)) {
        return word;
      }
    }
  }
  return null;
}

function findForbiddenPrefix(identifier: string, prefixes: string[]): string | null {
  const [first] = normalizedSegments(identifier);
  return prefixes.find((p) => p.toLowerCase() === first) ?? null;
}

function listFiles(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full, extension));
    } else if (entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

// One line per column in our established migration style: two-plus-space
// indent, then "column_name type" (see any existing migration).
function extractSqlColumnNames(sql: string): string[] {
  const names: string[] = [];
  for (const line of sql.split('\n')) {
    const match = /^\s{2,}([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
    if (match) {
      names.push(match[1]);
    }
  }
  return names;
}

// Deliberately broad: matches any "identifier: Type" or "identifier?: Type"
// shape, which covers class/interface fields *and* function parameters -
// a parameter named `amount` is exactly as much a scope signal as a field.
function extractTsIdentifiers(source: string): string[] {
  const names: string[] = [];
  const pattern = /(?:^|[(,{]\s*)(?:readonly\s+)?([a-zA-Z_$][\w$]*)\s*\??\s*:\s*\S/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    names.push(match[1]);
  }
  return names;
}

const MONEY_WORDS = ['price', 'amount', 'total', 'invoice', 'payment', 'rate'];
const AI_WORDS = ['score', 'rank', 'confidence', 'risk_level', 'model_version'];
const AI_PREFIXES = ['predicted'];

const migrationFiles = listFiles(join(repoRoot, 'src/database/migrations'), '.sql');
const sourceFiles = listFiles(join(repoRoot, 'src'), '.ts').filter((f) => !f.endsWith('.spec.ts'));

describe('Cut-scope guards (BE-SPEC §13)', () => {
  describe('No money', () => {
    it('no migration uses the Postgres money type', () => {
      for (const file of migrationFiles) {
        const sql = readFileSync(file, 'utf-8');
        expect({ file, hasMoneyType: /\bmoney\b/i.test(sql) }).toEqual({
          file,
          hasMoneyType: false,
        });
      }
    });

    it('no migration column name matches price/amount/total/invoice/payment/rate', () => {
      for (const file of migrationFiles) {
        const sql = readFileSync(file, 'utf-8');
        for (const column of extractSqlColumnNames(sql)) {
          const hit = findForbiddenWord(column, MONEY_WORDS);
          expect({ file, column, hit }).toEqual({ file, column, hit: null });
        }
      }
    });

    it('no TS identifier matches price/amount/total/invoice/payment/rate', () => {
      for (const file of sourceFiles) {
        const source = readFileSync(file, 'utf-8');
        for (const identifier of extractTsIdentifiers(source)) {
          const hit = findForbiddenWord(identifier, MONEY_WORDS);
          expect({ file, identifier, hit }).toEqual({ file, identifier, hit: null });
        }
      }
    });
  });

  describe('No AI', () => {
    it('no migration column name matches the AI word list', () => {
      for (const file of migrationFiles) {
        const sql = readFileSync(file, 'utf-8');
        for (const column of extractSqlColumnNames(sql)) {
          const hit =
            findForbiddenWord(column, AI_WORDS) ?? findForbiddenPrefix(column, AI_PREFIXES);
          expect({ file, column, hit }).toEqual({ file, column, hit: null });
        }
      }
    });

    it('no TS identifier matches score/rank/confidence/risk_level/model_version/predicted_*', () => {
      for (const file of sourceFiles) {
        const source = readFileSync(file, 'utf-8');
        for (const identifier of extractTsIdentifiers(source)) {
          const hit =
            findForbiddenWord(identifier, AI_WORDS) ??
            findForbiddenPrefix(identifier, AI_PREFIXES);
          expect({ file, identifier, hit }).toEqual({ file, identifier, hit: null });
        }
      }
    });
  });

  describe('No driver role', () => {
    it('migration 002 defines user_role as exactly admin and dispatcher', () => {
      const sql = readFileSync(
        join(repoRoot, 'src/database/migrations/002_users_and_sessions.sql'),
        'utf-8',
      );
      const match = /CREATE TYPE user_role AS ENUM \(([^)]+)\)/.exec(sql);
      expect(match).not.toBeNull();
      const values = (match as RegExpExecArray)[1]
        .split(',')
        .map((v) => v.trim().replace(/'/g, ''))
        .sort();
      expect(values).toEqual(['admin', 'dispatcher']);
    });

    it('no other migration alters the user_role enum', () => {
      for (const file of migrationFiles) {
        if (file.endsWith('002_users_and_sessions.sql')) {
          continue;
        }
        const sql = readFileSync(file, 'utf-8');
        expect({ file, altersEnum: /ALTER TYPE\s+user_role/i.test(sql) }).toEqual({
          file,
          altersEnum: false,
        });
      }
    });

    it('the application UserRole enum matches the database enum exactly', () => {
      expect(Object.values(UserRole).sort()).toEqual(['admin', 'dispatcher']);
    });
  });

  describe('No notifications', () => {
    it('package.json declares no SMS/email/push SDK dependency', () => {
      const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const forbidden = [
        /^twilio$/,
        /^nexmo$/,
        /^@vonage\//,
        /^plivo$/,
        /^messagebird$/,
        /^nodemailer$/,
        /^@sendgrid\//,
        /^mailgun/,
        /^postmark$/,
        /^@aws-sdk\/client-ses$/,
        /^@aws-sdk\/client-sns$/,
        /^firebase-admin$/,
        /^web-push$/,
        /^onesignal/,
        /^expo-server-sdk$/,
        /^apn$/,
        /^node-pushnotifications$/,
      ];
      for (const name of allDeps) {
        const hit = forbidden.find((re) => re.test(name));
        expect({ name, hit: hit?.toString() ?? null }).toEqual({ name, hit: null });
      }
    });
  });

  describe('No scheduler', () => {
    it('package.json declares no scheduler dependency', () => {
      const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const forbidden = ['@nestjs/schedule', 'node-cron', 'node-schedule', 'cron', 'agenda'];
      for (const name of forbidden) {
        expect({ name, declared: allDeps.includes(name) }).toEqual({ name, declared: false });
      }
    });

    it('no source file calls setInterval directly (also enforced by eslint)', () => {
      for (const file of sourceFiles) {
        const source = readFileSync(file, 'utf-8');
        expect({ file, callsSetInterval: /\bsetInterval\s*\(/.test(source) }).toEqual({
          file,
          callsSetInterval: false,
        });
      }
    });
  });
});
