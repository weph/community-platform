import { type SupabaseClient } from "@supabase/supabase-js";
import { GravityType } from "imgproxy/dist/types";
import { getImageURL } from "~/images.server";
import { prismaClient } from "~/prisma.server";
import { getPublicURL } from "~/storage.server";

export async function getMembersOfOrganization(
  authClient: SupabaseClient,
  organizationId: string
) {
  const members = await prismaClient.memberOfOrganization.findMany({
    select: {
      profile: {
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          avatar: true,
          position: true,
        },
      },
    },
    where: {
      organizationId: organizationId,
    },
    orderBy: {
      profile: {
        firstName: "asc",
      },
    },
  });

  const enhancedMembers = members.map((item) => {
    if (item.profile.avatar !== null) {
      const publicURL = getPublicURL(authClient, item.profile.avatar);
      if (publicURL !== null) {
        const avatar = getImageURL(publicURL, {
          resize: { type: "fill", width: 64, height: 64 },
          gravity: GravityType.center,
        });
        return {
          ...item,
          profile: { ...item.profile, avatar },
        };
      }
    }
    return item;
  });

  return enhancedMembers;
}

export async function getOrganizationBySlug(slug: string) {
  return await prismaClient.organization.findUnique({
    select: {
      id: true,
    },
    where: {
      slug,
    },
  });
}
