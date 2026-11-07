import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { changeLog } from '../db/schema.js';

export type LogAction = 'create' | 'update' | 'delete' | 'postpone' | 'import';

export interface LogEntry {
  projectId: string;
  taskId?: string | null;
  taskName: string;
  action: LogAction;
  field?: string | null;
  before?: string | null;
  after?: string | null;
}

/** 操作人来自登录会话，前端无法伪造（写接口本身也要求登录） */
export function actorOf(req: FastifyRequest): string | null {
  const user = req.currentUser;
  if (!user) return null;
  return (user.displayName || user.username).slice(0, 60);
}

export async function writeLog(entries: LogEntry[], actor: string | null): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(changeLog).values(
    entries.map((e) => ({
      id: randomUUID(),
      projectId: e.projectId,
      taskId: e.taskId ?? null,
      taskName: e.taskName.slice(0, 200),
      action: e.action,
      field: e.field ?? null,
      beforeValue: e.before?.slice(0, 255) ?? null,
      afterValue: e.after?.slice(0, 255) ?? null,
      actor,
    })),
  );
}
