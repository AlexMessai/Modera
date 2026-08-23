import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { createAdminSession } from "@/server/auth/session";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200)
});

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Проверьте электронную почту и пароль." } },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase().trim();
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  // A Telegram-only self-registered account (scope: CHAT) has no
  // passwordHash at all -- must not reach bcrypt.compare(null), which throws.
  const passwordOk = admin?.isActive && admin.passwordHash && (await bcrypt.compare(parsed.data.password, admin.passwordHash));

  if (!admin || !passwordOk) {
    return Response.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Неверная электронная почта или пароль." } },
      { status: 401 }
    );
  }

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() }
  });

  await createAdminSession({
    adminId: admin.id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent")
  });

  return Response.json({ data: { id: admin.id, displayName: admin.displayName, role: admin.role } });
}
