import { prismaClient } from "~/prisma";

export async function getProfileById(id: string) {
  const profile = await prismaClient.profile.findFirst({
    where: {
      id,
    },
    select: {
      username: true,
    },
  });
  return profile;
}