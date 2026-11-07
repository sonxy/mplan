import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/auth.js';
import { db } from './client.js';
import { users } from './schema.js';

/**
 * 生产环境创建初始管理员（不写任何演示数据）。
 * 用法：MPLAN_ADMIN_PASSWORD=... pnpm --filter @mplan/api admin:create
 * 账号已存在时只提示，不会重置密码，保证重复部署安全。
 */
async function main(): Promise<void> {
  const username = (process.env.MPLAN_ADMIN_USER ?? 'admin').trim().toLowerCase();
  const password = process.env.MPLAN_ADMIN_PASSWORD ?? '';
  const displayName = (process.env.MPLAN_ADMIN_NAME ?? '管理员').trim() || username;

  if (!username || password.length < 6) {
    throw new Error('请设置 MPLAN_ADMIN_USER 和 MPLAN_ADMIN_PASSWORD（密码至少 6 位）');
  }

  const [existing] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing) {
    console.log(`管理员账号 ${username} 已存在，跳过创建（不会重置密码）`);
    return;
  }

  await db.insert(users).values({
    id: randomUUID(),
    username,
    displayName,
    passwordHash: await hashPassword(password),
    role: 'admin',
    active: true,
  });
  console.log(`管理员账号已创建：${username}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
