const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Memecoin Discovery System in Development Mode...\n');

// Start backend
console.log('📡 Starting Backend Server...');
const backend = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname
});

// Wait a bit for backend to start, then start frontend
setTimeout(() => {
  console.log('\n🎨 Starting Frontend Dashboard...');
  const frontend = spawn('npm', ['start'], {
    stdio: 'inherit',
    shell: true,
    cwd: path.join(__dirname, 'dashboard')
  });

  frontend.on('close', (code) => {
    console.log(`Frontend exited with code ${code}`);
    backend.kill();
  });
}, 3000);

backend.on('close', (code) => {
  console.log(`Backend exited with code ${code}`);
  process.exit(code);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  backend.kill();
  process.exit(0);
}); 