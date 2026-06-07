const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const TEST_DB_PATH = path.join(__dirname, '..', 'data', 'courier.test.db');
const TEST_PORT = process.env.TEST_PORT || 3001;
const APP_PATH = path.join(__dirname, '..', 'app.js');

const TESTS_REQUIRE_SERVER = [
  'test_dispatch_plan.js',
  'test_dispatch.js',
  'test_dispatch_boundary.js',
  'test_cod_payment.js',
];

const TESTS_NO_SERVER = [
  'test_appointment_conflict.js',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkServerReady(port, timeout = 30000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://localhost:${port}/`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          if (Date.now() - startTime > timeout) {
            reject(new Error(`服务器在 ${timeout}ms 内未就绪`));
          } else {
            setTimeout(check, 500);
          }
        }
      });
      req.on('error', () => {
        if (Date.now() - startTime > timeout) {
          reject(new Error(`服务器在 ${timeout}ms 内未就绪`));
        } else {
          setTimeout(check, 500);
        }
      });
    };
    check();
  });
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      resolve(code);
    });
    child.on('error', reject);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', [APP_PATH], {
      env: {
        ...process.env,
        DB_PATH: TEST_DB_PATH,
        PORT: TEST_PORT,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let serverOutput = '';
    serverProcess.stdout.on('data', (data) => {
      const str = data.toString();
      serverOutput += str;
      process.stdout.write(`[server] ${str}`);
    });
    serverProcess.stderr.on('data', (data) => {
      process.stderr.write(`[server] ${data.toString()}`);
    });

    serverProcess.on('error', reject);

    checkServerReady(TEST_PORT)
      .then(() => resolve(serverProcess))
      .catch((err) => {
        serverProcess.kill();
        reject(err);
      });
  });
}

function runTestScript(testFile, useServer = false) {
  const testPath = path.join(__dirname, '..', testFile);
  const env = {
    DB_PATH: TEST_DB_PATH,
  };
  if (useServer) {
    env.PORT = TEST_PORT;
    env.BASE_URL = 'localhost';
  }
  return runCommand('node', [testPath], env);
}

function requiresServer(testFile) {
  return TESTS_REQUIRE_SERVER.includes(path.basename(testFile));
}

async function main() {
  const args = process.argv.slice(2);
  const testFiles = args.length > 0 ? args : null;

  let testsToRun;
  if (testFiles) {
    testsToRun = testFiles.map(f => {
      if (!f.endsWith('.js')) f += '.js';
      if (!fs.existsSync(path.join(__dirname, '..', f))) {
        console.error(`❌ 测试文件不存在: ${f}`);
        process.exit(1);
      }
      return f;
    });
  } else {
    testsToRun = [...TESTS_REQUIRE_SERVER, ...TESTS_NO_SERVER];
  }

  console.log('='.repeat(70));
  console.log('🧪 快递小哥派送系统 - 测试运行器');
  console.log('='.repeat(70));
  console.log(`测试数据库: ${TEST_DB_PATH}`);
  console.log(`测试端口: ${TEST_PORT}`);
  console.log(`待运行测试: ${testsToRun.join(', ')}`);
  console.log('='.repeat(70));

  if (fs.existsSync(TEST_DB_PATH)) {
    console.log('\n🧹 清理旧的测试数据库...');
    fs.unlinkSync(TEST_DB_PATH);
  }

  console.log('\n🔧 初始化测试数据库...');
  const setupCode = await runCommand('node', [path.join(__dirname, 'setup.js')], {
    DB_PATH: TEST_DB_PATH,
  });
  if (setupCode !== 0) {
    console.error('❌ 测试数据库初始化失败');
    process.exit(1);
  }

  let serverProcess = null;
  let overallExitCode = 0;

  try {
    const needServer = testsToRun.some(f => requiresServer(f));
    if (needServer) {
      console.log('\n🚀 启动测试服务...');
      serverProcess = await startServer();
      console.log('✅ 测试服务已启动');
      await sleep(500);
    }

    for (const testFile of testsToRun) {
      const useServer = requiresServer(testFile);
      console.log(`\n${'='.repeat(70)}`);
      console.log(`▶️  运行测试: ${testFile} ${useServer ? '(API模式)' : '(服务层模式)'}`);
      console.log('='.repeat(70));

      const exitCode = await runTestScript(testFile, useServer);
      if (exitCode !== 0) {
        overallExitCode = 1;
        console.log(`❌ 测试失败: ${testFile}`);
      } else {
        console.log(`✅ 测试通过: ${testFile}`);
      }
    }
  } catch (err) {
    console.error('\n💥 测试运行出错:', err.message);
    overallExitCode = 1;
  } finally {
    if (serverProcess) {
      console.log('\n🛑 关闭测试服务...');
      serverProcess.kill();
      await sleep(500);
      console.log('✅ 测试服务已关闭');
    }

    console.log('\n🧹 清理测试数据库...');
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
        console.log('✅ 测试数据库已清理');
      } catch (err) {
        console.error('❌ 清理测试数据库失败:', err.message);
      }
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  if (overallExitCode === 0) {
    console.log('🎉 所有测试通过！');
  } else {
    console.log('❌ 部分测试失败');
  }
  console.log('='.repeat(70));

  process.exit(overallExitCode);
}

main().catch((err) => {
  console.error('💥 测试运行器异常:', err);
  process.exit(1);
});
