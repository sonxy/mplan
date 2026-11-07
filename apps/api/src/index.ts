import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { attachAuth } from './lib/auth.js';
import { registerAuthRoutes } from './routes.auth.js';
import { registerRoutes } from './routes.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  },
});

await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') ?? true,
  credentials: true,
});

app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _req, reply) => {
  const status = error.statusCode ?? 500;
  const code = error.code;
  if (code === 'ER_DUP_ENTRY') {
    reply.code(409).send({ error: '这个编号已经被占用了，换一个吧' });
    return;
  }
  if (status >= 500) app.log.error(error);
  reply.code(status).send({ error: error.message });
});

// 先挂鉴权钩子：读接口放行，写接口必须登录（登录/初始化/退出除外）
attachAuth(app);

await app.register(registerAuthRoutes);
await app.register(registerRoutes);

const port = Number(process.env.PORT ?? 8787);
// 本机开发默认监听所有网卡；生产环境放在 nginx 后面时可用 HOST=127.0.0.1
const host = process.env.HOST ?? '0.0.0.0';
await app.listen({ port, host });
app.log.info(`mplan api → http://${host}:${port}`);