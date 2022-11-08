import { User } from "@supabase/supabase-js";
import * as authServerModule from "~/auth.server";
import { prismaClient } from "~/prisma";
import { loader } from "./team";

// @ts-ignore
const expect = global.expect as jest.Expect;

const getUserByRequest = jest.spyOn(authServerModule, "getUserByRequest");

const slug = "slug-test";

jest.mock("~/prisma", () => {
  return {
    prismaClient: {
      project: {
        findFirst: jest.fn(),
      },
      teamMemberOfProject: {
        findFirst: jest.fn(),
      },
    },
  };
});

describe("/project/$slug/settings/team", () => {
  beforeAll(() => {
    process.env.FEATURES = "projects";
  });

  test("no params", async () => {
    expect.assertions(2);

    const request = new Request("");
    try {
      await loader({ request, context: {}, params: {} });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.message).toBe('"slug" missing');
    }
  });

  test("project not found", async () => {
    expect.assertions(2);

    (prismaClient.project.findFirst as jest.Mock).mockResolvedValue(null);

    getUserByRequest.mockResolvedValue({ id: "some-user-id" } as User);

    const request = new Request("");
    try {
      await loader({ request, context: {}, params: { slug } });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(404);

      const json = await response.json();
      expect(json.message).toBe("Project not found");
    }
  });

  test("anon user", async () => {
    expect.assertions(2);

    getUserByRequest.mockResolvedValue(null);

    try {
      await loader({
        request: new Request(""),
        context: {},
        params: { slug },
      });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.message).toBe("No session or session user found");
    }
  });

  test("authenticated user", async () => {
    expect.assertions(2);

    getUserByRequest.mockResolvedValue({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockImplementationOnce(() => {
      return { slug };
    });
    (
      prismaClient.teamMemberOfProject.findFirst as jest.Mock
    ).mockImplementationOnce(() => {
      return null;
    });

    try {
      await loader({
        request: new Request(""),
        context: {},
        params: { slug },
      });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.message).toBe("Not privileged");
    }
  });

  test("not privileged user", async () => {
    expect.assertions(2);

    getUserByRequest.mockResolvedValue({ id: "some-user-id" } as User);

    (prismaClient.project.findFirst as jest.Mock).mockImplementationOnce(() => {
      return { slug };
    });
    (
      prismaClient.teamMemberOfProject.findFirst as jest.Mock
    ).mockImplementationOnce(() => {
      return null;
    });

    try {
      await loader({
        request: new Request(""),
        context: {},
        params: { slug },
      });
    } catch (error) {
      const response = error as Response;
      expect(response.status).toBe(401);

      const json = await response.json();
      expect(json.message).toBe("Not privileged");
    }
  });

  test("privileged user", async () => {
    getUserByRequest.mockResolvedValue({ id: "some-user-id" } as User);

    (
      prismaClient.teamMemberOfProject.findFirst as jest.Mock
    ).mockImplementationOnce(() => {
      return { isPrivileged: true };
    });
    (prismaClient.project.findFirst as jest.Mock).mockImplementationOnce(() => {
      return {
        slug,
        teamMembers: [
          {
            isPrivileged: true,
            profile: {
              id: "some-user-id",
              firstName: "Some",
              lastName: "User",
              username: "someuser",
            },
          },
          {
            isPrivileged: true,
            profile: {
              id: "another-user-id",
              firstName: "Another",
              lastName: "User",
              username: "anotheruser",
            },
          },
          {
            isPrivileged: false,
            profile: {
              id: "yet-another-user-id",
              firstName: "Yet Another",
              lastName: "User",
              username: "yetanotheruser",
            },
          },
        ],
      };
    });

    const response = await loader({
      request: new Request(""),
      context: {},
      params: { slug },
    });

    expect(response.teamMembers.length).toBe(3);
    expect(response.teamMembers).toEqual(
      expect.arrayContaining([
        {
          id: "some-user-id",
          firstName: "Some",
          lastName: "User",
          username: "someuser",
          isPrivileged: true,
          isCurrentUser: true,
        },
        expect.objectContaining({
          id: "yet-another-user-id",
          isPrivileged: false,
          isCurrentUser: false,
        }),
      ])
    );
  });

  afterAll(() => {
    delete process.env.FEATURES;
  });
});