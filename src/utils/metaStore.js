export function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function writeMeta(prisma, { userId = null, action, type = 'state', detail, status = 'INFO' }) {
  return prisma.auditLog.create({
    data: {
      userId,
      action,
      type,
      status,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail ?? null),
    },
  });
}

export async function readLatestMeta(prisma, { userId = null, action, since = null }) {
  const where = { action };
  if (userId !== undefined) where.userId = userId;
  if (since) where.createdAt = { gte: since };
  const record = await prisma.auditLog.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return record ? safeJsonParse(record.detail, null) : null;
}

export async function readAllMeta(prisma, { userId = null, action, since = null }) {
  const where = { action };
  if (userId !== undefined) where.userId = userId;
  if (since) where.createdAt = { gte: since };
  const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map((row) => ({ ...row, payload: safeJsonParse(row.detail, null) }));
}
