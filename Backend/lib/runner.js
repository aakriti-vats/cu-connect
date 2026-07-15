// Runs user code with the locally-installed toolchains. This is a demo-grade
// runner: it enforces a wall-clock timeout and caps output, but does NOT
// sandbox execution — it runs on the app host. Fine for a local single-user
// demo; a production IDE must use isolated containers (Judge0/Docker).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 10000;
const MAX_OUTPUT = 20000; // characters

function cap(str) {
  if (str.length <= MAX_OUTPUT) return str;
  return str.slice(0, MAX_OUTPUT) + '\n…[output truncated]';
}

// Spawn a shell command line, feed stdin, resolve with { stdout, stderr, timedOut }.
// The command line is built from values we control (fixed verbs + temp paths we
// generated), never from user input, so shell:true is safe here.
function spawnWithInput(commandLine, cwd, stdin) {
  return new Promise((resolve) => {
    const child = spawn(commandLine, { cwd, shell: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, spawnError: err });
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

// Format SQLite SELECT rows as a simple text table.
function formatRows(rows) {
  if (!rows.length) return '(0 rows)';
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => cells.map((v, i) => String(v).padEnd(widths[i])).join('  ');
  const header = line(cols);
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((r) => line(cols.map((c) => r[c] ?? '')));
  return [header, sep, ...body].join('\n');
}

// SQL runs in-process against a fresh in-memory SQLite DB.
function runSql(code) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const out = [];
  try {
    const statements = code.split(';').map((s) => s.trim()).filter(Boolean);
    if (!statements.length) return { output: '(no SQL statements)', ok: true };
    for (const stmt of statements) {
      if (/^\s*(select|pragma|with)/i.test(stmt)) {
        out.push(formatRows(db.prepare(stmt).all()));
      } else {
        db.exec(stmt);
        out.push('OK');
      }
    }
    return { output: cap(out.join('\n\n')), ok: true };
  } catch (err) {
    return { output: 'SQL error: ' + err.message, ok: false };
  } finally {
    db.close();
  }
}

const NOT_INSTALLED = {
  c: 'C compiler (gcc) is not installed on this machine, so C cannot run here.\nInstall a C/C++ toolchain (e.g. MinGW-w64) and it will work automatically.',
  cpp: 'C++ compiler (g++) is not installed on this machine, so C++ cannot run here.\nInstall a C/C++ toolchain (e.g. MinGW-w64) and it will work automatically.',
};

// Main entry. Returns { output, ok }.
async function runCode({ language, code, stdin }) {
  language = (language || '').toLowerCase();
  code = code || '';
  stdin = stdin || '';

  if (language === 'sql') return runSql(code);
  if (NOT_INSTALLED[language]) return { output: NOT_INSTALLED[language], ok: false };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuide-'));
  try {
    let result;
    if (language === 'javascript' || language === 'js') {
      const file = path.join(dir, 'main.js');
      fs.writeFileSync(file, code);
      result = await spawnWithInput(`node "${file}"`, dir, stdin);
    } else if (language === 'python') {
      const file = path.join(dir, 'main.py');
      fs.writeFileSync(file, code);
      result = await spawnWithInput(`python "${file}"`, dir, stdin);
    } else if (language === 'java') {
      const file = path.join(dir, 'Main.java');
      fs.writeFileSync(file, code);
      const compile = await spawnWithInput('javac Main.java', dir, '');
      if (compile.spawnError || compile.stderr) {
        return { output: cap(compile.stderr || 'Java compiler not available.'), ok: false };
      }
      result = await spawnWithInput('java -cp . Main', dir, stdin);
    } else {
      return { output: 'Unsupported language: ' + language, ok: false };
    }

    if (result.spawnError) {
      return {
        output: `Could not run ${language}: ${result.spawnError.code === 'ENOENT'
          ? 'the interpreter/compiler was not found on this machine.'
          : result.spawnError.message}`,
        ok: false,
      };
    }
    if (result.timedOut) {
      return { output: cap((result.stdout || '') + '\n[Timed out after 10s]'), ok: false };
    }
    const combined = result.stdout + (result.stderr ? (result.stdout ? '\n' : '') + result.stderr : '');
    return { output: cap(combined || '(no output)'), ok: !result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { runCode };
