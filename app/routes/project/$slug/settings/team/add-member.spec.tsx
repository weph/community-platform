import type { User } from "@supabase/supabase-js";
import * as authServerModule from "~/auth.server";
import { createRequestWithFormData } from "~/lib/utils/tests";
import { prismaClient } from "~/prisma.server";
import { action } from "./add-member";

// @ts-ignore
const expect = global.expect as jest.Expect;

const getSessionUserOrThrow = jest.spyOn(
  authServerModule,
  "getSessionUserOrThrow"
);

jest.mock("~/prisma.server", () => {
  return {
    prismaClient: {
      project: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      teamMemberOfProject: {
        create: jest.fn(),
      },
      profile: {
        findUnique: jest.fn(),
      },
    },
  };
});

jest.mock("~/lib/utils/application", () => {
  return {
    checkFeatureAbilitiesOrThrow: jest.fn(),
  };
});

describe("/project/$slug/settings/team/add-member", () => {
  test("anon user", async () => {
    const request = createRequestWithFormData({});

    expect.assertions(2);

    try {
      await action({
        request,
        context: {},
        params: { slug: "some-project-slug" },
      });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.message).toBe("No session or session user found");
    }
  });

  test("authenticated but not admin user", async () => {
    const request = createRequestWithFormData({});

    expect.assertions(1);

    getSessionUserOrThrow.mockResolvedValueOnce({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockResolvedValueOnce(null);

    try {
      await action({
        request,
        context: {},
        params: { slug: "some-project-slug" },
      });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(403);
    }
  });

  test("profile not found", async () => {
    const request = createRequestWithFormData({
      profileId: "some-user-id",
    });

    expect.assertions(4);

    getSessionUserOrThrow.mockResolvedValueOnce({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "some-project-id",
    });

    (prismaClient.profile.findUnique as jest.Mock).mockResolvedValueOnce(null);

    const response = await action({
      request,
      context: {},
      params: { slug: "some-project-slug" },
    });
    const responseBody = await response.json();
    expect(responseBody.success).toBe(false);
    expect(responseBody.errors).toBeDefined();
    expect(responseBody.errors).not.toBeNull();
    expect(responseBody.errors.profileId).toStrictEqual([
      "Es existiert noch kein Profil unter diesem Namen.",
    ]);
  });

  test("already member", async () => {
    expect.assertions(2);

    const request = createRequestWithFormData({
      profileId: "some-user-id",
    });

    getSessionUserOrThrow.mockResolvedValueOnce({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "some-project-id",
    });

    (prismaClient.profile.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "some-user-id",
      teamMemberOfProjects: [
        {
          project: {
            slug: "some-project-slug",
          },
        },
      ],
    });

    const response = await action({
      request,
      context: {},
      params: { slug: "some-project-slug" },
    });
    const responseBody = await response.json();

    expect(responseBody.success).toBe(false);
    expect(responseBody.errors.profileId).toContain(
      "Das Profil unter diesem Namen ist bereits Mitglied Eures Projekts."
    );
  });

  test("project not found", async () => {
    expect.assertions(1);

    const request = createRequestWithFormData({
      profileId: "some-user-id",
    });

    getSessionUserOrThrow.mockResolvedValueOnce({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "some-project-id",
    });

    (prismaClient.profile.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "some-user-id",
      teamMemberOfProjects: [],
    });

    (prismaClient.project.findUnique as jest.Mock).mockResolvedValueOnce(null);

    try {
      await action({
        request,
        context: {},
        params: { slug: "some-project-slug" },
      });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(404);
    }
  });

  test("add project team member", async () => {
    expect.assertions(2);

    const request = createRequestWithFormData({
      profileId: "another-user-id",
    });

    getSessionUserOrThrow.mockResolvedValueOnce({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockResolvedValueOnce({
      id: "some-project-id",
    });

    (prismaClient.profile.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "another-profile-id",
      firstName: "another-user-firstname",
      lastName: "another-user-lastname",
      teamMemberOfProjects: [
        {
          project: {
            slug: "another-project-slug",
          },
        },
      ],
    });

    (prismaClient.project.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "some-project-id",
    });

    const response = await action({
      request,
      context: {},
      params: { slug: "some-project-slug" },
    });
    const responseBody = await response.json();
    expect(prismaClient.teamMemberOfProject.create).toHaveBeenLastCalledWith({
      data: {
        projectId: "some-project-id",
        profileId: "another-user-id",
      },
    });
    expect(responseBody.message).toBe(
      'Ein neues Teammitglied mit dem Namen "another-user-firstname another-user-lastname" wurde hinzugefügt.'
    );
  });
});
