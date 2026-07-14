// PM2 process file — same pattern as the Bezant api on this VPS.
// Usage: pm2 start deploy/ecosystem.config.cjs && pm2 save

module.exports = {
  apps: [
    {
      name: 'owed-asp',
      cwd: __dirname + '/..',
      script: 'node_modules/.bin/tsx',
      args: 'src/server/index.ts',
      env: { NODE_ENV: 'production' },
      // .env is loaded by the shell profile or pass env_file via pm2-dotenv;
      // simplest: `export $(grep -v '^#' .env | xargs)` before pm2 start, or
      // put the vars in this block on the VPS (never commit them).
      max_memory_restart: '400M',
      autorestart: true,
      out_file: 'data/logs/owed-out.log',
      error_file: 'data/logs/owed-err.log',
      time: true,
    },
  ],
};
